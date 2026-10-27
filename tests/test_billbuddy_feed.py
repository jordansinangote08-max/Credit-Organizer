"""Browser integration with the actual sibling BillBuddy Python feed handler.

Run both repositories side by side, or set BILLBUDDY_REPO to its checkout.
All Supabase rows and authentication are synthetic; no external calls are made.
"""
from datetime import datetime, timezone
import importlib.util
from http.server import ThreadingHTTPServer
import os
from pathlib import Path
from threading import Thread
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import test_billbuddy_sync as sync_tests



class FeedIntegrationTest(unittest.TestCase):
    setUpClass = classmethod(sync_tests.SyncTest.setUpClass.__func__)
    tearDownClass = classmethod(sync_tests.SyncTest.tearDownClass.__func__)
    setUp = sync_tests.SyncTest.setUp
    tearDown = sync_tests.SyncTest.tearDown

    def test_live_feed_deletion_removes_and_saves_imports_on_next_poll(self):
        root = Path(os.environ.get('BILLBUDDY_REPO', str(Path(__file__).parents[2] / 'Billbuddy')))
        source = root / 'api/bills.py'
        if not source.is_file():
            self.skipTest('Place BillBuddy alongside Credit-Organizer or set BILLBUDDY_REPO')
        spec = importlib.util.spec_from_file_location('fixture_billbuddy_feed', source)
        feed = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(feed)
        rows = [
            {'message_id': 'eastwest-statement', 'owner': 'fixture-owner', 'account_key': 'eastwest',
             'bank_lender': 'EastWest', 'product_type': 'credit_card', 'last4': '3002',
             'due_date': '2026-10-15', 'total_amount_due': 13274.10,
             'installments': [{'label': 'Laptop', 'term': 3, 'of': 12, 'amount': 100}]},
            {'message_id': 'rcbc-statement', 'owner': 'fixture-owner', 'account_key': 'rcbc',
             'bank_lender': 'RCBC', 'product_type': 'credit_card',
             'due_date': '2026-10-28', 'total_amount_due': 8263.94},
        ]
        queries = []

        def database(path, **kwargs):
            parsed = urlsplit(path)
            self.assertEqual(parsed.path, '/bills')
            query = parse_qs(parsed.query)
            queries.append(query)
            self.assertEqual(query['owner'], ['eq.fixture-owner'])
            offset = int(query['offset'][0])
            # A server-enforced row cap of one must not yield a partial feed.
            return list(rows[offset:offset + 1])

        class QuietFeed(feed.handler):
            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(('127.0.0.1', 0), QuietFeed)
        thread = Thread(target=server.serve_forever, daemon=True)
        with patch.dict(os.environ, {'OWNER_UID': 'fixture-owner', 'BILLS_API_KEY': 'fixture-key',
                                     'SUPABASE_URL': 'https://fixture.invalid', 'SUPABASE_SERVICE_KEY': 'fixture-key'}), \
             patch.object(feed, '_today', return_value='2026-10-15'), \
             patch.object(feed, '_supabase', side_effect=database):
            thread.start()
            try:
                url = f'http://127.0.0.1:{server.server_port}/api/bills'
                self.page.evaluate('''async url => {
                  cloudReady=true;cloudUser={id:'fixture-planner-user'};
                  sb={from:()=>({upsert:row=>{
                    window.savedPlanner=row;
                    return {select:()=>({single:async()=>({data:{updated_at:'2026-10-15T00:00:00Z'},error:null})})};
                  }})};
                  S.bb={url,key:'fixture-key'};
                  S.items.push({id:uid++,name:'Manual rent',kind:'bill',amount:50,day:15});
                  await syncBillBuddy();
                }''', url)
                self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbDue).length'), 2)
                self.assertEqual(self.page.evaluate('S.items.find(i=>i.bbKey==="eastwest").bbStatement'), 'eastwest-statement')
                self.assertEqual(len(queries), 3)
                rows.pop(0)  # Delete EastWest in the BillBuddy source database.
                self.page.clock.run_for(3100)
                self.page.clock.run_for(1000)
                # due Oct 15, in the pay cycle Sep 24 - Oct 23: it stays in the planner until that cycle ends
                self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbDue).map(i=>i.bbKey).sort()'), ['eastwest', 'rcbc'])
                self.page.clock.set_system_time(datetime(2026, 10, 24, 16, 0, tzinfo=timezone.utc))
                self.page.clock.run_for(4100)
                self.page.wait_for_function('S.items.filter(i=>i.bbDue).length===1')
                self.assertEqual(self.page.evaluate('S.items.find(i=>i.bbDue).bbKey'), 'rcbc')
                self.page.clock.run_for(1000)
                self.assertEqual(self.page.evaluate('savedPlanner.state.items.filter(i=>i.bbDue).map(i=>i.bbKey)'), ['rcbc'])
                self.assertTrue(self.page.evaluate('S.items.some(i=>i.name==="Manual rent")'))
                self.assertEqual(self.page.evaluate('S.accounts.length'), 2)
                self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbInst&&i.bbWaiting).length'), 1)
                rows.clear()  # RCBC is due Oct 28, in the cycle that just started, so it stays after BillBuddy drops it
                self.page.clock.run_for(4100)
                self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbDue).map(i=>i.bbKey)'), ['rcbc'])
            finally:
                server.shutdown()
                server.server_close()
                thread.join()


if __name__ == '__main__':
    unittest.main()
