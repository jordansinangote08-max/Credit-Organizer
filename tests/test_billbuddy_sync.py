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
        self.page.clock.install(time=datetime(2026, 10, 13, 16, 0, tzinfo=timezone.utc))
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
        self.page.clock.set_system_time(datetime(2026, 10, 15, 16, 0, tzinfo=timezone.utc))
        self.assertFalse(self.page.evaluate('pruneExpiredBB()'))   # past due, but its pay cycle runs to Oct 23
        self.page.clock.set_system_time(datetime(2026, 10, 24, 16, 0, tzinfo=timezone.utc))
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
          next.items=[{name:'Expired utility',kind:'bill',amount:100,bbDue:'2026-09-20'},
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
          S.items=[{id:1,kind:'loan',bbDue:'2026-09-20',bbRef:'parent',amount:200},
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
        self.assertEqual(before, 'rgb(196, 39, 30)')
        self.page.evaluate("selectTab('bills');renderItems()")
        self.page.locator('[data-paid]').click()
        self.page.evaluate("selectTab('inst');renderInst()")
        self.assertEqual(self.page.locator('#instList .bar.is-paid').count(), 2)
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbInst).map(i=>i.left)'), [9, 6])
        self.assertEqual(self.page.locator('#instList .bar i').first.evaluate('(el)=>getComputedStyle(el).backgroundColor'), 'rgb(30, 127, 69)')
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
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbDue).length'), 1)  # kept while its cycle lasts
        self.page.clock.set_system_time(datetime(2026, 11, 24, 16, 0, tzinfo=timezone.utc))
        self.page.evaluate('applyBB([],{reconcile:true})')
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbDue).length'), 0)
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbInst).length'), 2)
        self.assertTrue(self.page.evaluate('S.items.every(i=>i.bbWaiting&&billed(i))'))
        self.assertEqual(self.page.evaluate('compute().total'), 8282.23)   # counted as the expected next statement
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
        self.assertEqual(self.page.evaluate('S.items.length'), 2)  # still this pay cycle
        self.page.clock.set_system_time(datetime(2026, 11, 24, 16, 0, tzinfo=timezone.utc))
        self.page.evaluate('pruneExpiredBB()')
        self.assertEqual(self.page.evaluate('S.items.length'), 1)
        self.assertEqual(self.page.evaluate('S.items[0].left'), 10)
        self.assertTrue(self.page.evaluate('!!S.items[0].bbInst&&billed(S.items[0])'))

    def test_complete_snapshot_keeps_missing_imports_until_the_cycle_ends(self):
        self.page.evaluate('''() => {
          S.items.push({id:uid++,name:'Manual rent',kind:'bill',amount:50,day:26});
          applyBB([{bank:'BPI',account_key:'bpi',amount:100,due_date:'2026-10-26'},
                   {bank:'RCBC',account_key:'rcbc',amount:200,due_date:'2026-10-26'}]);
          applyBB([{bank:'RCBC',account_key:'rcbc',amount:200,due_date:'2026-10-26'}],{reconcile:true});
        }''')
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbDue).map(i=>i.bbKey)'), ['bpi', 'rcbc'])
        self.page.clock.set_system_time(datetime(2026, 11, 24, 16, 0, tzinfo=timezone.utc))
        self.page.evaluate("applyBB([{bank:'RCBC',account_key:'rcbc',amount:300,due_date:'2026-11-26',statement_id:'nov'}],{reconcile:true})")
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbDue).map(i=>i.bbKey+" "+i.bbDue)'), ['rcbc 2026-11-26'])
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

    def test_open_planner_polls_complete_snapshot_and_keeps_bill_this_cycle(self):
        self.page.evaluate('b=>applyBB([b])', self.union_statement())
        self.page.evaluate('''() => {
          cloudReady=true;draft={};S.bb={url:'https://fixture.invalid/api/bills',key:'test-only'};
          window.feedRequests=0;
          window.fetch=async()=>{feedRequests++;return {status:200,ok:true,json:async()=>({ok:true,complete:true,count:0,bills:[]})}};
        }''')
        self.page.clock.run_for(3100)
        self.assertGreaterEqual(self.page.evaluate('feedRequests'), 1)
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbDue).length'), 1)
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbInst).length'), 2)

    def test_incomplete_count_never_removes_existing_bills(self):
        self.page.evaluate('b=>applyBB([b])', self.union_statement())
        self.page.evaluate('''async () => {
          cloudReady=true;draft={};S.bb={url:'https://fixture.invalid/api/bills',key:'test-only'};
          window.fetch=async()=>({status:200,ok:true,json:async()=>({ok:true,complete:true,count:1,bills:[]})});
          await syncBillBuddy();
        }''')
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbDue).length'), 1)

    def test_malformed_complete_feed_never_clears_existing_bills(self):
        self.page.evaluate('b=>applyBB([b])', self.union_statement())
        self.page.evaluate('''async () => {
          cloudReady=true;draft={};S.bb={url:'https://fixture.invalid/api/bills',key:'test-only'};
          window.fetch=async()=>({status:200,ok:true,json:async()=>({ok:true,complete:true,count:1,
            bills:[{bank:'BPI',account_key:'other',amount:'broken',due_date:'2026-10-26'}]})});
          await syncBillBuddy();
        }''')
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbDue).length'), 1)

    def test_zero_balance_statement_replaces_the_previous_amount(self):
        self.page.evaluate('''() => {
          applyBB([{bank:'BPI',account_key:'bpi',amount:100,due_date:'2026-10-26'}]);
          applyBB([{bank:'BPI',account_key:'bpi',amount:0,due_date:'2026-10-26'}],{reconcile:true});
        }''')
        self.assertEqual(self.page.evaluate('S.items.find(i=>i.bbDue).amount'), 0)

    def test_october_15_bill_leaves_when_its_pay_cycle_ends(self):
        self.page.evaluate('''() => {
          cloudReady=true;draft={};
          S.items.push({id:uid++,name:'Manual rent',kind:'bill',amount:50,day:15});
          applyBB([{bank:'EastWest',type:'credit_card',account_key:'eastwest',amount:13274.10,
            due_date:'2026-10-15',installments:[{label:'Laptop',term:3,of:12,amount:100}]}]);
        }''')
        # this device is in New York: the cycle Sep 24 - Oct 23 ends at its midnight, 04:00 UTC
        self.page.clock.set_system_time(datetime(2026, 10, 24, 3, 59, 0, tzinfo=timezone.utc))
        self.page.clock.run_for(1000)
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbDue).length'), 1)
        self.page.clock.run_for(120000)   # the minute check after the cycle changes
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbDue).length'), 0)
        self.assertEqual(self.page.evaluate('S.accounts.length'), 1)
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbInst).length'), 1)
        self.assertTrue(self.page.evaluate("S.items.some(i=>i.name==='Manual rent')"))

    def test_billbuddy_bill_only_lets_name_and_category_change(self):
        self.page.evaluate('''() => {
          S.cats.push({key:'subs',name:'Subscriptions',color:'teal',kind:'bill'});
          applyBB([{bank:'Meralco',type:'utility',account_key:'meralco',amount:2500,due_date:'2026-10-26'}]);
          openBill(S.items.find(i=>i.bbDue).id);
        }''')
        body = self.page.locator('#billBody')
        self.assertEqual(body.locator('[data-k]').evaluate_all('els=>els.map(e=>e.dataset.k)'), ['name', 'cat'])
        self.assertEqual(body.locator('[data-del]').count(), 0)
        self.assertIn('2,500', body.inner_text())
        body.locator('[data-k=name]').fill('Electric')
        body.locator('[data-k=cat]').select_option('subs')
        it = self.page.evaluate("(({name,cat,amount,bbDue})=>({name,cat,amount,bbDue}))(S.items.find(i=>i.bbDue))")
        self.assertEqual(it, {'name': 'Electric', 'cat': 'subs', 'amount': 2500, 'bbDue': '2026-10-26'})
        # an edit to any other field is ignored
        self.page.evaluate('''() => {const f=document.createElement('input');f.dataset.k='amount';f.value='1';
          $('#billBody .form').append(f);f.dispatchEvent(new Event('input',{bubbles:true}))}''')
        self.assertEqual(self.page.evaluate('S.items.find(i=>i.bbDue).amount'), 2500)

    def test_paid_statement_stays_paid_after_billbuddy_drops_it_until_next_cycle(self):
        self.page.evaluate("applyBB([{bank:'Meralco',type:'utility',account_key:'meralco',amount:2500,due_date:'2026-10-28'}]);markPaid(S.items.find(i=>i.bbDue))")
        self.page.clock.set_system_time(datetime(2026, 10, 30, 16, 0, tzinfo=timezone.utc))
        self.page.evaluate('applyBB([],{reconcile:true});pruneExpiredBB()')   # BillBuddy deleted it after the due date
        it = self.page.evaluate("(i=>({amount:i.amount,due:i.bbDue,paid:isPaid(i)}))(S.items.find(i=>i.bbDue))")
        self.assertEqual(it, {'amount': 2500, 'due': '2026-10-28', 'paid': True})
        self.page.clock.set_system_time(datetime(2026, 11, 23, 16, 0, tzinfo=timezone.utc))   # Nov 23: last day of the cycle
        self.page.evaluate('pruneExpiredBB()')
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbDue).length'), 1)
        self.page.clock.set_system_time(datetime(2026, 11, 24, 16, 0, tzinfo=timezone.utc))
        self.page.evaluate('pruneExpiredBB()')
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbDue).length'), 0)

    def test_next_statement_keeps_the_previous_one_as_its_own_record(self):
        self.page.evaluate("""() => {
          applyBB([{bank:'BPI',type:'credit_card',account_key:'bpi',last4:'1234',statement_id:'oct',amount:1000,due_date:'2026-10-28'}]);
          markPaid(S.items.find(i=>i.bbDue));
          applyBB([{bank:'BPI',type:'credit_card',account_key:'bpi',last4:'1234',statement_id:'nov',amount:1500,due_date:'2026-11-28'}],{reconcile:true});
        }""")
        rows = self.page.evaluate("S.items.filter(i=>i.bbDue).map(i=>({due:i.bbDue,amount:i.amount,paid:isPaid(i),old:!!i.bbOld,last4:last4Of(i)})).sort((a,b)=>a.due<b.due?-1:1)")
        self.assertEqual(rows, [{'due': '2026-10-28', 'amount': 1000, 'paid': True, 'old': True, 'last4': '1234'},
                                {'due': '2026-11-28', 'amount': 1500, 'paid': False, 'old': False, 'last4': '1234'}])
        self.assertEqual(self.page.evaluate('S.accounts.length'), 1)
        self.page.evaluate("applyBB([{bank:'BPI',type:'credit_card',account_key:'bpi',last4:'1234',statement_id:'nov',amount:1500,due_date:'2026-11-28'}],{reconcile:true})")
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbDue).length'), 2)   # a repeat sync adds nothing
        self.page.clock.set_system_time(datetime(2026, 11, 24, 16, 0, tzinfo=timezone.utc))
        self.page.evaluate('pruneExpiredBB()')
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbDue).map(i=>i.bbDue)'), ['2026-11-28'])

    def test_finishing_the_cycle_early_keeps_statements_until_the_calendar_cycle_ends(self):
        self.page.evaluate("applyBB([{bank:'Meralco',type:'utility',account_key:'meralco',amount:2500,due_date:'2026-10-28'}])")
        self.page.clock.set_system_time(datetime(2026, 10, 30, 16, 0, tzinfo=timezone.utc))
        self.page.evaluate("S.done=cycleKey();pruneExpiredBB()")
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbDue).length'), 1)

    def test_short_pill_counts_money_already_spent_on_paid_bills(self):
        # a paid "Can be cut" bill due first used to leave its money free for the card in the priority split
        short = self.page.evaluate("""() => {
          S.pay={[keyOf(cycleStart())]:10000};S.items=[{id:uid++,name:'Wala lang',kind:'flex',amount:3000,day:26},
            {id:uid++,name:'EastWest Everyday',kind:'card',amount:15614.61,day:16,noAcct:true}];
          markPaid(S.items[0]);
          const l=compute().lines.find(x=>x.i.name==='EastWest Everyday');return Math.round((l.need-l.got)*100)/100;
        }""")
        self.assertEqual(short, 8614.61)   # 15,614.61 - (10,000 - 3,000), the same gap as the running balance
        self.assertEqual(self.page.evaluate('Math.round(compute().gap*100)/100'), 8614.61)   # the "Short this cycle" headline too
        self.page.evaluate('undoPaid(S.items[0])')
        self.assertEqual(self.page.evaluate('Math.round(compute().gap*100)/100'), 5614.61)   # unpaid, it can still be cut


    def test_new_card_bill_with_known_last4_joins_that_card(self):
        self.page.evaluate("""() => {
          applyBB([{bank:'EastWest',type:'credit_card',account_key:'ew',last4:'3002',amount:15614.61,due_date:'2026-10-28'}]);
          S.accounts[0].name='EastWest Everyday';S.accounts[0].limit=50000;newBill('card');
        }""")
        new_id = self.page.evaluate('editingId')
        self.assertEqual(self.page.evaluate('S.accounts.length'), 2)   # a new card is made as the bill starts
        self.page.fill(f'#n{new_id}', 'EastWest')
        self.page.fill(f'#f4{new_id}', '3002')
        self.page.click('#billDone')
        self.assertEqual(self.page.evaluate('S.accounts.length'), 1)
        it = self.page.evaluate(f"(i=>({{acct:i.acct,name:i.name}}))(S.items.find(i=>i.id=={new_id}))")
        self.assertEqual(it, {'acct': self.page.evaluate('S.accounts[0].key'), 'name': 'EastWest Everyday'})
        self.assertEqual(self.page.evaluate('S.accounts[0].limit'), 50000)

    def test_cancelled_new_card_bill_leaves_no_card_behind(self):
        self.page.evaluate("newBill('card')")
        new_id = self.page.evaluate('editingId')
        self.page.fill(f'#f4{new_id}', '7777')
        self.page.evaluate("$('#billDlg').close()")
        self.page.wait_for_function('editingId===null')
        self.assertEqual(self.page.evaluate('S.accounts.length'), 0)
        self.assertEqual(self.page.evaluate('S.items.length'), 0)

    def test_digits_typed_before_choosing_a_card_category_still_find_the_card(self):
        self.page.evaluate("""() => {
          S.accounts.push({id:uid++,key:'bpi',name:'BPI Gold',last4:'1234',limit:null,stmt:null});newBill('bill');
        }""")
        new_id = self.page.evaluate('editingId')
        self.assertEqual(self.page.locator(f'#f4{new_id}').count(), 0)   # a plain bill has no last-4 field
        self.page.evaluate(f"(i=>{{i.bbLast4='1234'}})(S.items.find(i=>i.id=={new_id}))")
        card = self.page.evaluate("S.cats.find(c=>c.kind==='card').key")
        self.page.select_option(f'#k{new_id}', card)
        self.assertEqual(self.page.evaluate('S.accounts.length'), 1)
        self.assertEqual(self.page.evaluate(f"S.items.find(i=>i.id=={new_id}).acct"), 'bpi')

    def test_add_card_refuses_digits_another_card_has(self):
        self.page.evaluate("S.accounts.push({id:uid++,key:'bpi',name:'BPI Gold',last4:'1234',limit:null,stmt:null});renderAll();$('#acctAdd').click()")
        self.page.fill('#sheetBody [data-k=last4]', '1234')
        self.assertIn('BPI Gold already ends in 1234', self.page.locator('#sheetBody').inner_text())
        self.assertEqual(self.page.evaluate("S.accounts.filter(a=>a.last4==='1234').length"), 1)

    def test_changing_the_pay_schedule_does_not_drop_a_kept_statement(self):
        # due Oct 28 with payday on the 24th: its cycle Oct 24 - Nov 23 ends Nov 24, whatever the schedule says later
        self.page.evaluate("applyBB([{bank:'RCBC',type:'credit_card',account_key:'rcbc-4069',last4:'4069',statement_id:'oct',amount:8263.94,due_date:'2026-10-28'}]);markPaid(S.items.find(i=>i.bbDue))")
        self.page.clock.set_system_time(datetime(2026, 11, 4, 16, 0, tzinfo=timezone.utc))
        self.page.evaluate('applyBB([],{reconcile:true})')   # BillBuddy dropped it; the planner keeps it
        self.assertEqual(self.page.evaluate("S.items.find(i=>i.bbDue).bbKeepTill"), '2026-11-24')
        self.page.evaluate("S.payfreq='twice';S.payday=15;S.payday2=30;payMemo=new Map();pruneExpiredBB();applyBB([],{reconcile:true})")
        self.page.evaluate("S.payfreq='month';S.payday=24;payMemo=new Map()")
        self.page.evaluate("applyBB([{bank:'RCBC',type:'credit_card',account_key:'rcbc-4069',last4:'4069',statement_id:'nov',amount:4114.77,due_date:'2026-12-01'}],{reconcile:true})")
        rows = self.page.evaluate("S.items.filter(i=>i.bbDue).map(i=>i.bbDue+' '+(isPaid(i)?'paid':'unpaid')).sort()")
        self.assertEqual(rows, ['2026-10-28 paid', '2026-12-01 unpaid'])
        self.assertFalse(self.page.evaluate("'bbKeepTill' in S.items.find(i=>i.bbDue==='2026-12-01')"))
        self.page.clock.set_system_time(datetime(2026, 11, 24, 16, 0, tzinfo=timezone.utc))
        self.page.evaluate('pruneExpiredBB()')
        self.assertEqual(self.page.evaluate("S.items.filter(i=>i.bbDue).map(i=>i.bbDue)"), ['2026-12-01'])

    def test_each_pay_cycle_has_its_own_salary(self):
        # payday on the 24th, today Oct 13: the planner shows Oct 24 - Nov 23 (16 days before payday)
        self.page.evaluate("cloudReady=true;S.items=[{id:uid++,name:'Rent',kind:'essential',amount:4000,day:28}];renderAll()")
        self.assertEqual(self.page.evaluate("$('#salary').value"), '')          # a new cycle starts at 0
        self.assertEqual(self.page.evaluate('compute().salary'), 0)
        self.page.evaluate("v=>{const e=$('#salary');e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))}", '38730')
        here = self.page.evaluate('cycleKey()')
        self.assertEqual(self.page.evaluate('S.pay'), {here: 38730})
        self.assertEqual(self.page.evaluate('compute().avail'), 38730)
        # every bill paid: the planner moves on to the next cycle, whose salary is 0, with the leftover carried over
        self.page.evaluate("markPaid(S.items[0]);render()")
        self.assertNotEqual(self.page.evaluate('cycleKey()'), here)
        self.assertEqual(self.page.evaluate("$('#salary').value"), '')
        self.assertEqual(self.page.evaluate('compute().salary'), 0)
        self.assertEqual(self.page.evaluate('compute().carry'), 34730)
        self.page.evaluate("v=>{const e=$('#salary');e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))}", '40000')
        self.assertEqual(self.page.evaluate(f"S.pay['{here}']"), 38730)        # last cycle keeps its own
        # going back to the finished cycle shows its own salary again
        self.page.evaluate('reopenClosed()')
        self.assertEqual(self.page.evaluate("$('#salary').value"), '38730')

    def test_an_old_single_salary_becomes_this_cycles(self):
        self.page.evaluate("(()=>{const s=clone(DEFAULTS);s.salary=38730;delete s.pay;S=s;prepare()})()")
        self.assertEqual(self.page.evaluate('Object.values(S.pay)'), [38730])
        self.assertEqual(self.page.evaluate('salaryOf(shiftCycle(cycleStart(),3),true)'), 38730)   # forecasts estimate
        self.assertEqual(self.page.evaluate('salaryOf(shiftCycle(cycleStart(),3))'), 0)

    def test_finished_installment_is_not_due_in_the_next_cycle(self):
        self.page.evaluate("S.items=[{id:uid++,name:'Maya Credit',kind:'loan',amount:7317.39,day:30,left:1,total:null}];markPaid(S.items[0])")
        here = self.page.evaluate('cycleStart().getTime()')
        self.assertEqual(self.page.evaluate("compute().lines.map(l=>l.i.name)"), ['Maya Credit'])   # paid, in its own cycle
        self.assertEqual(self.page.evaluate("S.items[0].left"), 0)
        self.assertFalse(self.page.evaluate(f"inCycle(S.items[0],shiftCycle(new Date({here}),1))"))
        self.page.evaluate("renderInst()")
        self.assertIn('Maya Credit', self.page.locator('#instList').inner_text())    # paid, this cycle
        self.page.evaluate("S.done=cycleKey();renderInst()")                      # every bill paid: next cycle
        self.assertNotIn('Maya Credit', self.page.locator('#instList').inner_text())
        self.page.evaluate("delete S.done;renderInst()")                          # Go back: it's there again
        self.assertIn('Maya Credit', self.page.locator('#instList').inner_text())

    def test_installments_waiting_for_their_statement_show_as_expected(self):
        statement = self.union_statement()
        self.page.evaluate('b=>{applyBB([b]);markPaid(S.items.find(i=>i.bbDue))}', statement)
        self.page.clock.set_system_time(datetime(2026, 11, 24, 16, 0, tzinfo=timezone.utc))
        self.page.evaluate('applyBB([],{reconcile:true})')          # the October statement's cycle is over
        self.assertEqual(self.page.evaluate('S.items.filter(i=>i.bbDue).length'), 0)
        lines = self.page.evaluate("compute().lines.map(l=>[iso(l.date),l.i.name,l.need,!!l.i.expected])")
        self.assertEqual(lines, [['2026-11-26', 'UnionBank Loan', 8282.23, True]])
        self.page.evaluate("selectTab('bills');renderItems()")
        self.assertIn('Expected', self.page.locator('#itemList').inner_text())
        # the real statement replaces it
        self.page.evaluate('b=>applyBB([b],{reconcile:true})', self.union_statement('11', 4, 7, 'november'))
        lines = self.page.evaluate("compute().lines.map(l=>[l.i.name,!!l.i.expected])")
        self.assertEqual(lines, [['UnionBank Loan', False]])

    def test_paying_ahead_after_finishing_a_cycle_keeps_the_finished_cycle_paid(self):
        self.page.evaluate("""() => {cloudReady=true;draft=null;
          S.items=[{id:uid++,name:'Rent',kind:'essential',amount:4000,day:28},{id:uid++,name:'MariBank Loan',kind:'loan',amount:7256.67,day:26,left:3,total:null}];
          S.items.forEach(markPaid);render();}""")
        old = self.page.evaluate('S.closed&&S.closed.key')
        self.assertTrue(old)                                          # every bill paid: moved to the next cycle
        self.assertEqual(self.page.evaluate('S.items[1].left'), 2)
        self.page.evaluate("markPaid(S.items[1]);render()")         # pay next month's MariBank in the new cycle
        self.assertTrue(self.page.evaluate('!!S.closed'))            # still in the new cycle, not sent back
        self.assertNotEqual(self.page.evaluate('cycleKey()'), old)
        self.assertEqual(self.page.evaluate('S.items[1].left'), 1)
        self.assertTrue(self.page.evaluate('isPaid(S.items[1])'))
        self.assertFalse(self.page.evaluate('closedHasUnpaid()'))
        self.page.evaluate("undoPaid(S.items[1]);render()")         # undo only the new payment
        self.assertEqual(self.page.evaluate('S.items[1].left'), 2)
        self.assertTrue(self.page.evaluate('!!S.closed'))
        self.page.evaluate("markPaid(S.items[1]);reopenClosed()")  # Go back: last cycle still shows it paid
        self.assertEqual(self.page.evaluate('cycleKey()'), old)
        self.assertTrue(self.page.evaluate('isPaid(S.items[1])'))

    def test_income_from_an_earlier_cycle_is_not_listed(self):
        self.page.evaluate("""() => {const c=cycleStart(),prev=shiftCycle(c,-1),past=shiftCycle(c,-2);
          S.income=[{id:uid++,label:'Keanu Pay',amount:10836,date:iso(prev)},{id:uid++,label:'Bonus',amount:500,date:iso(c)},
                    {id:uid++,label:'Very old',amount:1,date:iso(new Date(past.getFullYear(),past.getMonth(),past.getDate()+1))}];renderIncome()}""")
        text = self.page.locator('#incList').inner_text()
        self.assertNotIn('Keanu Pay', self.page.evaluate("[...document.querySelectorAll('#incList input[data-k=label]')].map(e=>e.value).join()"))
        self.assertIn('Bonus', self.page.evaluate("[...document.querySelectorAll('#incList input[data-k=label]')].map(e=>e.value).join()"))
        self.page.evaluate('rollover()')
        self.assertEqual(self.page.evaluate('S.income.map(x=>x.label)'), ['Keanu Pay', 'Bonus'])   # last cycle kept for Go back

if __name__ == '__main__':
    unittest.main()
