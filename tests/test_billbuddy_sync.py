from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
from threading import Thread
import unittest
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class SyncTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(
            QuietHandler, directory=str(Path(__file__).parents[1])))
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(
            executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), args=['--no-sandbox'])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        # A device outside Manila must still expire on Manila's calendar.
        self.context = self.browser.new_context(timezone_id='America/New_York')
        self.context.route('**/*', lambda route: route.continue_() if
                           urlsplit(route.request.url).hostname == '127.0.0.1' else route.abort())
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.clock.install(time=datetime(2026, 10, 14, 16, 0, tzinfo=timezone.utc))
        self.page.goto(f'http://127.0.0.1:{self.server.server_port}/')
        self.page.wait_for_function("typeof applyBB === 'function'")
        self.page.evaluate("S=clone(DEFAULTS); S.items=[]; S.accounts=[]; prepare()")

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [])

    def test_statement_expiry_keeps_accounts_manual_bills_and_future_plans(self):
        self.page.evaluate('''() => {
          S.items.push({id:uid++,name:'Rent',kind:'bill',amount:50,day:14});
          applyBB([{bank:'BPI',type:'credit_card',account_key:'bpi-1234',last4:'1234',
            amount:1000,due_date:'2026-10-14',installments:[{label:'Laptop',term:3,of:12,amount:100}]}]);
        }''')
        self.assertEqual(self.page.evaluate("S.items.filter(i=>i.bbDue).length"), 1)
        self.assertEqual(self.page.evaluate("bbCutoff()"), '2026-10-14')
        self.page.clock.set_system_time(datetime(2026, 10, 15, 16, 0, tzinfo=timezone.utc))
        self.assertTrue(self.page.evaluate('pruneExpiredBB()'))
        self.assertEqual(self.page.evaluate("S.items.filter(i=>i.bbDue).length"), 0)
        self.assertEqual(self.page.evaluate('S.accounts.length'), 1)
        self.assertEqual(self.page.evaluate("S.items.find(i=>i.name==='Rent').amount"), 50)
        self.assertEqual(self.page.evaluate('S.items.find(i=>i.bbInst).left'), 10)
        # Old responses and late AI retries cannot resurrect an expired bill.
        self.page.evaluate("applyBB([{bank:'BPI',type:'credit_card',account_key:'bpi-1234',amount:1000,due_date:'2026-10-14'}])")
        self.assertEqual(self.page.evaluate("S.items.filter(i=>i.bbDue).length"), 0)
        # The next statement reuses the retained account, without duplicating it.
        self.page.evaluate("applyBB([{bank:'BPI',type:'credit_card',account_key:'bpi-1234',last4:'1234',amount:800,due_date:'2026-11-14'}])")
        self.assertEqual(self.page.evaluate('S.accounts.length'), 1)
        self.assertEqual(self.page.evaluate("S.items.find(i=>i.bbDue).amount"), 800)

    def test_account_load_saves_expiry_back_to_planner_storage(self):
        self.page.evaluate('''() => {
          cloudReady=true;cloudUser={id:'fixture-user'};
          sb={from:()=>({upsert:row=>{
            window.savedPlanner=row;
            return {select:()=>({single:async()=>({data:{updated_at:'2026-10-15T00:00:00Z'},error:null})})};
          }})};
          const next=clone(S);
          next.items=[{name:'Expired utility',kind:'bill',amount:100,bbDue:'2026-10-13'},
                      {name:'Manual rent',kind:'bill',amount:50,day:14}];
          adopt(next);
        }''')
        self.page.clock.run_for(750)
        self.assertEqual(self.page.evaluate('savedPlanner.user_id'), 'fixture-user')
        self.assertEqual(self.page.evaluate('savedPlanner.state.items.length'), 1)
        self.assertEqual(self.page.evaluate('savedPlanner.state.items[0].name'), 'Manual rent')

    def test_next_card_statement_reuses_account_without_last_four(self):
        self.page.evaluate("applyBB([{bank:'BPI',type:'credit_card',account_key:'known-card',amount:100,due_date:'2026-10-14'}])")
        original = self.page.evaluate('S.accounts[0].key')
        self.page.clock.set_system_time(datetime(2026, 10, 15, 16, 0, tzinfo=timezone.utc))
        self.page.evaluate("pruneExpiredBB();applyBB([{bank:'BPI',type:'credit_card',account_key:'known-card',amount:200,due_date:'2026-11-14'}])")
        self.assertEqual(self.page.evaluate('S.accounts.length'), 1)
        self.assertEqual(self.page.evaluate('S.items[0].acct'), original)

    def test_expired_loan_detaches_future_schedule(self):
        self.page.evaluate('''() => {
          S.items=[{id:1,kind:'loan',bbDue:'2026-10-13',bbRef:'parent',amount:200},
                   {id:2,kind:'loan',inBill:'parent',bbInst:'Lparent|loan|12',amount:100,left:6}];
          pruneExpiredBB();
        }''')
        self.assertEqual(self.page.evaluate('S.items.length'), 1)
        self.assertFalse(self.page.evaluate("'inBill' in S.items[0]"))
        self.assertEqual(self.page.evaluate('S.items[0].left'), 6)

    def test_old_response_is_ignored_after_state_switch(self):
        self.page.evaluate('''async () => {
          cloudReady=true;S.bb={url:'https://fixture.invalid/api/bills',key:'test-only'};
          let release;window.fetch=()=>new Promise(resolve=>release=resolve);
          const request=syncBillBuddy();
          S=clone(S);S.items=[];
          release({status:200,ok:true,json:async()=>({ok:true,bills:[{bank:'BPI',amount:100,due_date:'2026-10-20'}]})});
          await request;
        }''')
        self.assertEqual(self.page.evaluate('S.items.length'), 0)
        self.assertFalse(self.page.evaluate('bbBusy'))

    def test_invalid_feed_does_not_apply_or_clear_statements(self):
        self.page.evaluate('''async () => {
          S.items=[{id:1,name:'BPI',kind:'card',amount:100,bbDue:'2026-10-20'}];
          cloudReady=true;S.bb={url:'https://fixture.invalid/api/bills',key:'test-only'};
          window.fetch=async()=>({status:200,ok:true,json:async()=>({ok:true})});
          await syncBillBuddy();
        }''')
        self.assertEqual(self.page.evaluate('S.items.length'), 1)
        self.assertEqual(self.page.evaluate('S.items[0].amount'), 100)


if __name__ == '__main__':
    unittest.main()
