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
          sb={rpc:async(name,args)=>{
            window.savedPlanner={user_id:cloudUser.id,state:args.p_state};
            return {data:'2026-10-15T00:00:00Z',error:null};
          }};
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

    def test_expired_loan_keeps_schedule_link_without_recreating_bill(self):
        self.page.evaluate('''() => {
          S.items=[{id:1,kind:'loan',bbDue:'2026-10-13',bbRef:'parent',amount:200},
                   {id:2,kind:'loan',inBill:'parent',bbInst:'Lparent|loan|12',amount:100,left:6}];
          pruneExpiredBB();
        }''')
        self.assertEqual(self.page.evaluate('S.items.length'), 1)
        self.assertEqual(self.page.evaluate('S.items[0].inBill'), 'parent')
        self.assertTrue(self.page.evaluate('S.items[0].bbWaiting'))
        self.assertTrue(self.page.evaluate('billed(S.items[0])'))
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

    def union_statement(self, month='10', term=3, second_term=6, statement='october'):
        return {'bank': 'UnionBank', 'type': 'loan', 'account_key': 'unionbank-4474',
                'last4': '4474', 'statement_id': statement, 'amount': 8282.23,
                'due_date': f'2026-{month}-26', 'installments': [
                    {'label': f'UnionBank Personal Loan ({term:02d}/12)', 'term': term, 'of': 12, 'amount': 3897.52},
                    {'label': f'UnionBank Personal Loan ({second_term:02d}/12)', 'term': second_term, 'of': 12, 'amount': 4384.71}]}

    def test_payment_click_turns_both_bars_green_and_undo_turns_them_red(self):
        self.page.evaluate('b=>applyBB([b])', self.union_statement())
        self.page.evaluate("document.body.classList.remove('locked');selectTab('inst');renderInst()")
        self.assertEqual(self.page.locator('#instList .bar.is-unpaid').count(), 2)
        before = self.page.locator('#instList .bar i').first.evaluate('(el)=>getComputedStyle(el).backgroundColor')
        self.assertEqual(before, 'rgb(180, 55, 47)')
        self.page.evaluate("selectTab('bills');renderItems()")
        self.page.locator('[data-paid]').click()
        self.page.evaluate("selectTab('inst');renderInst()")
        self.assertEqual(self.page.locator('#instList .bar.is-paid').count(), 2)
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbInst).map(i=>i.left)'), [9, 6])
        self.assertEqual(self.page.locator('#instList .bar i').first.evaluate('(el)=>getComputedStyle(el).backgroundColor'), 'rgb(27, 122, 80)')
        self.page.evaluate("selectTab('bills');renderItems()")
        self.page.locator('[data-unpaid]').click()
        self.page.evaluate('renderInst()')
        self.assertEqual(self.page.locator('#instList .bar.is-unpaid').count(), 2)
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbInst).map(i=>i.left)'), [10, 7])

    def test_deleted_statement_keeps_plans_and_next_statement_reuses_them(self):
        statement = self.union_statement()
        self.page.evaluate('b=>{applyBB([b]);markPaid(S.items.find(i=>i.bbDue))}', statement)
        keys = self.page.evaluate('S.items.filter(i=>i.bbInst).map(i=>i.bbInst)')
        self.page.evaluate('applyBB([],{reconcile:true})')
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbDue).length'), 0)
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbInst).length'), 2)
        self.assertTrue(self.page.evaluate('S.items.every(i=>i.bbWaiting&&billed(i))'))
        self.assertEqual(self.page.evaluate('compute().total'), 0)
        self.page.evaluate('b=>applyBB([b],{reconcile:true})', self.union_statement('11', 4, 7, 'november'))
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbInst).map(i=>i.bbInst)'), keys)
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbInst).map(planOf)'), ['4/12', '7/12'])
        self.assertTrue(self.page.evaluate('S.items.every(i=>!isPaid(i)&&!i.bbWaiting)'))
        self.page.evaluate('renderInst()')
        self.assertEqual(self.page.locator('#instList .bar.is-unpaid').count(), 2)

    def test_repeated_sync_and_repeated_check_do_not_double_count_payments(self):
        statement = self.union_statement()
        self.page.evaluate('b=>{applyBB([b]);const bill=S.items.find(i=>i.bbDue);markPaid(bill);markPaid(bill);applyBB([b]);applyBB([b])}', statement)
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbInst).map(i=>i.left)'), [9, 6])
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbInst).map(planOf)'), ['3/12', '6/12'])
        self.assertTrue(self.page.evaluate('S.items.every(isPaid)'))

    def test_same_statement_reappearing_keeps_its_paid_progress(self):
        statement = self.union_statement()
        self.page.evaluate('b=>{applyBB([b]);markPaid(S.items.find(i=>i.bbDue));applyBB([],{reconcile:true});applyBB([b],{reconcile:true})}', statement)
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbInst).map(i=>i.left)'), [9, 6])
        self.assertTrue(self.page.evaluate('S.items.every(isPaid)'))

    def test_new_statement_without_deletion_resets_paid_status(self):
        self.page.evaluate('b=>{applyBB([b]);markPaid(S.items.find(i=>i.bbDue))}', self.union_statement())
        self.page.evaluate('b=>applyBB([b])', self.union_statement('11', 4, 7, 'november'))
        self.assertEqual(self.page.evaluate("S.items.find(i=>i.bbDue).bbDue"), '2026-11-26')
        self.assertFalse(self.page.evaluate('isPaid(S.items.find(i=>i.bbDue))'))
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbInst).length'), 2)

    def test_expired_single_loan_retains_its_installment_progress(self):
        statement = self.union_statement()
        statement['installments'] = statement['installments'][:1]
        statement['amount'] = 3897.52
        self.page.evaluate('b=>applyBB([b])', statement)
        self.page.clock.set_system_time(datetime(2026, 10, 27, 16, 0, tzinfo=timezone.utc))
        self.page.evaluate('pruneExpiredBB()')
        self.assertEqual(self.page.evaluate('S.items.length'), 1)
        self.assertEqual(self.page.evaluate('S.items[0].left'), 10)
        self.assertTrue(self.page.evaluate('!!S.items[0].bbInst&&billed(S.items[0])'))

    def test_complete_snapshot_removes_only_missing_imports(self):
        self.page.evaluate('''() => {
          S.items.push({id:uid++,name:'Manual rent',kind:'bill',amount:50,day:26});
          applyBB([{bank:'BPI',account_key:'bpi',amount:100,due_date:'2026-10-26'},
                   {bank:'RCBC',account_key:'rcbc',amount:200,due_date:'2026-10-26'}]);
          applyBB([{bank:'RCBC',account_key:'rcbc',amount:200,due_date:'2026-10-26'}],{reconcile:true});
        }''')
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbDue).map(i=>i.bbKey)'), ['rcbc'])
        self.assertTrue(self.page.evaluate("S.items.some(i=>i.name==='Manual rent')"))

    def test_partial_snapshot_does_not_remove_other_bills(self):
        self.page.evaluate('b=>{applyBB([b]);applyBB([])}', self.union_statement())
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbDue).length'), 1)

    def test_legacy_single_loan_is_migrated_and_reused_by_next_statement(self):
        self.page.evaluate('''() => {
          S.items=[{id:uid++,name:'UnionBank Loan',kind:'loan',bbKey:'unionbank-4474',bbDue:'2026-10-13',
                    amount:3897.52,day:26,total:12,left:10}];
          pruneExpiredBB();
        }''')
        self.assertEqual(self.page.evaluate('S.items.length'), 1)
        statement = self.union_statement('11', 4, 7, 'november')
        statement['installments'] = statement['installments'][:1]
        statement['amount'] = 3897.52
        self.page.evaluate('b=>applyBB([b])', statement)
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbInst).length'), 1)
        self.assertEqual(self.page.evaluate('S.items.find(i=>i.bbInst).left'), 9)

    def test_paid_card_propagates_to_installments_and_deletion_keeps_account(self):
        statement = self.union_statement()
        statement['type'] = 'credit_card'
        self.page.evaluate('b=>{applyBB([b]);markPaid(S.items.find(i=>i.bbDue));applyBB([b])}', statement)
        self.assertTrue(self.page.evaluate('S.items.every(isPaid)'))
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbInst).map(i=>i.left)'), [9, 6])
        self.page.evaluate('applyBB([],{reconcile:true})')
        self.assertEqual(self.page.evaluate('S.accounts.length'), 1)
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbInst).length'), 2)

    def test_duplicate_same_name_loans_use_amount_to_keep_distinct_progress(self):
        statement = self.union_statement()
        for plan in statement['installments']:
            plan['label'] = 'UnionBank Personal Loan'
        self.page.evaluate('b=>{applyBB([b]);applyBB([b])}', statement)
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbInst).length'), 2)
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbInst).map(planOf)'), ['3/12', '6/12'])

    def test_open_planner_polls_complete_snapshot_and_removes_bill(self):
        self.page.evaluate('b=>applyBB([b])', self.union_statement())
        self.page.evaluate('''() => {
          cloudReady=true;draft={};S.bb={url:'https://fixture.invalid/api/bills',key:'test-only'};
          window.feedRequests=0;
          window.fetch=async()=>{feedRequests++;return {status:200,ok:true,json:async()=>({ok:true,complete:true,bills:[]})}};
        }''')
        self.page.clock.run_for(3100)
        self.assertGreaterEqual(self.page.evaluate('feedRequests'), 1)
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbDue).length'), 0)
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbInst).length'), 2)


if __name__ == '__main__':
    unittest.main()
