"""Browser regressions with synthetic state; every nonlocal request is blocked."""
import unittest
import test_billbuddy_sync as harness


class FrontendSafetyTests(unittest.TestCase):
    setUpClass = classmethod(harness.SyncTest.setUpClass.__func__)
    tearDownClass = classmethod(harness.SyncTest.tearDownClass.__func__)
    setUp = harness.SyncTest.setUp
    tearDown = harness.SyncTest.tearDown

    def test_old_account_refresh_cannot_enter_new_account(self):
        result = self.page.evaluate('''async () => {
          cloudReady=true;cloudUser={id:'A'};cloudAt='2020-01-01';S.bb={};
          let release;sb={from:()=>({select:()=>({eq:()=>({maybeSingle:()=>new Promise(r=>release=r)})})})};
          document.dispatchEvent(new Event('visibilitychange'));
          accountEpoch++;cloudUser={id:'B'};S=clone(DEFAULTS);prepare();S.salary=200;
          release({data:{state:{...clone(S),salary:98765},updated_at:'2030-01-01'},error:null});
          await Promise.resolve();await Promise.resolve();return S.salary;
        }''')
        self.assertEqual(result, 200)

    def test_saves_are_serial_and_use_last_acknowledged_version(self):
        self.page.evaluate('''() => {
          cloudReady=true;cloudUser={id:'A'};cloudAt='version-0';window.calls=[];window.releases=[];
          sb={rpc:(name,args)=>{calls.push({name,args});return new Promise(r=>releases.push(r))}};
          S.salary=100;window.first=pushCloud();S.salary=200;window.second=pushCloud();
        }''')
        self.assertEqual(self.page.evaluate('calls.length'), 1)
        self.page.evaluate("async()=>{releases[0]({data:'version-1',error:null});await first;await second}")
        self.page.clock.run_for(1)
        self.assertEqual(self.page.evaluate('calls.length'), 2)
        self.assertEqual(self.page.evaluate('calls[1].args.p_expected_at'), 'version-1')
        self.assertEqual(self.page.evaluate('calls[1].args.p_state.salary'), 200)
        self.page.evaluate("releases[1]({data:'version-2',error:null})")

    def test_version_conflict_requires_an_explicit_choice(self):
        result = self.page.evaluate('''async () => {
          cloudReady=true;cloudUser={id:'A'};S.salary=200;
          sb={rpc:async()=>({error:{code:'40001'}}),from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{state:{...clone(S),salary:100},updated_at:'remote-version'},error:null})})})})};
          await pushCloud();return {salary:S.salary,conflict:!!cloudConflict,open:document.querySelector('#infoDlg').open};
        }''')
        self.assertEqual(result, {'salary': 200, 'conflict': True, 'open': True})
        self.page.locator('[data-cloud-choice=remote]').click()
        self.assertEqual(self.page.evaluate('S.salary'), 100)

    def test_same_last_four_on_different_banks_stay_separate(self):
        result = self.page.evaluate('''() => {
          applyBB([{bank:'BPI',type:'credit_card',account_key:'bpi',last4:'1234',amount:100,due_date:'2026-10-26'}]);
          applyBB([],{reconcile:true});
          applyBB([{bank:'EastWest',type:'credit_card',account_key:'ew',last4:'1234',amount:200,due_date:'2026-11-26'}]);
          return {accounts:S.accounts.length,name:S.items.find(i=>i.bbDue).name};
        }''')
        self.assertEqual(result, {'accounts': 2, 'name': 'EastWest CC'})

    def test_legacy_manual_card_last_four_does_not_match_another_bank(self):
        result = self.page.evaluate('''() => {
          S.items=[{id:uid++,name:'BPI CC',kind:'card',amount:100,day:26}];ensureLinks();S.accounts[0].last4='1234';
          applyBB([{bank:'EastWest',type:'credit_card',account_key:'ew',last4:'1234',amount:200,due_date:'2026-10-26'}]);
          return {accounts:S.accounts.length,manual:S.items.find(i=>!i.bbDue).name,imported:S.items.find(i=>i.bbDue).name};
        }''')
        self.assertEqual(result, {'accounts': 2, 'manual': 'BPI CC', 'imported': 'EastWest CC'})

    def test_identical_installments_keep_separate_progress_across_statements(self):
        result = self.page.evaluate('''() => {
          let b={bank:'BPI',type:'credit_card',account_key:'bpi',amount:200,due_date:'2026-10-26',installments:[
            {label:'SHOP',term:3,of:12,amount:100},{label:'SHOP',term:6,of:12,amount:100}]};
          applyBB([b]);const keys=S.items.filter(i=>i.bbInst).map(i=>i.bbInst);
          applyBB([{...b,statement_id:'nov',due_date:'2026-11-26',installments:[
            {label:'SHOP',term:4,of:12,amount:100},{label:'SHOP',term:7,of:12,amount:100}]}]);
          return {keys,now:S.items.filter(i=>i.bbInst).map(i=>i.bbInst),left:S.items.filter(i=>i.bbInst).map(i=>i.left)};
        }''')
        self.assertEqual(result['keys'], result['now'])
        self.assertEqual(result['left'], [9, 6])

    def test_legacy_plan_identity_migration_preserves_progress(self):
        result = self.page.evaluate('''() => {
          applyBB([{bank:'BPI',type:'credit_card',account_key:'bpi',amount:100,due_date:'2026-10-26',installments:[{label:'Phone',term:3,of:12,amount:100}]}]);
          const item=S.items.find(i=>i.bbInst),id=item.id;item.bbInst=item.inCard+'|phone|12|100.00';
          markPaid(S.items.find(i=>i.bbDue));
          applyBB([{bank:'BPI',type:'credit_card',account_key:'bpi',amount:100,due_date:'2026-10-26',installments:[{label:'Phone',term:3,of:12,amount:100,plan_id:'issuer-99'}]}]);
          return {count:S.items.filter(i=>i.bbInst).length,same:S.items.find(i=>i.bbInst).id===id,left:item.left,paid:isPaid(item)};
        }''')
        self.assertEqual(result, {'count': 1, 'same': True, 'left': 9, 'paid': True})

    def test_loan_analysis_covers_all_sixty_payments_with_weekly_income(self):
        result = self.page.evaluate('''() => {
          S.payfreq='week';S.payweekday=3;S.salary=1000;S.items=[];
          const r=loanCheck({amt:60000,rate:0,type:'inst',term:60,due:new Date(2026,9,21),fee:0});
          return {payments:r.plan.length,checked:r.rows.filter(x=>x.pay>0).length};
        }''')
        self.assertEqual(result, {'payments': 60, 'checked': 60})

    def test_undo_after_rollover_restores_statement_payment_count(self):
        result = self.page.evaluate('''() => {
          applyBB([{bank:'UnionBank',type:'loan',account_key:'ub',amount:100,due_date:'2026-10-26',installments:[{label:'Loan',term:3,of:12,amount:100}]}]);
          const bill=S.items.find(i=>i.bbDue),plan=S.items.find(i=>i.bbInst);markPaid(bill);
          S.items.forEach(i=>i.paidCycle='2000-1-1');rollover();undoPaid(bill);
          return {left:plan.left,paid:isPaid(plan)};
        }''')
        self.assertEqual(result, {'left': 10, 'paid': False})

    def test_finished_loan_is_not_an_unpaid_bill_but_final_payment_is_counted(self):
        result = self.page.evaluate('''() => {
          S.items=[{id:uid++,name:'Loan',kind:'loan',amount:100,day:24,left:0,total:12}];ensureLinks();
          const finished=compute().total;S.items[0].left=1;markPaid(S.items[0]);
          return {finished,finalPaid:compute().paidAmt};
        }''')
        self.assertEqual(result, {'finished': 0, 'finalPaid': 100})

    def test_provisional_bill_and_card_are_not_saved_before_add(self):
        result = self.page.evaluate('''() => {
          newBill('bill');const input=document.querySelector('#billBody [data-k=name]');
          input.value='Unconfirmed';input.dispatchEvent(new Event('input',{bubbles:true}));
          const before=JSON.parse(snapshot()).items.length;
          document.querySelector('#billBody [data-done]').click();
          const after=JSON.parse(snapshot()).items.length;
          document.querySelector('#acctAdd').click();const saved=JSON.parse(snapshot());
          return {before,after,cards:saved.accounts.length,items:saved.items.length};
        }''')
        self.assertEqual(result, {'before': 0, 'after': 1, 'cards': 0, 'items': 1})

    def test_negative_edit_does_not_change_saved_amount(self):
        result = self.page.evaluate('''() => {
          S.items=[{id:uid++,name:'Rent',kind:'bill',amount:100,day:24}];ensureLinks();openBill(S.items[0].id);
          const input=document.querySelector('#billBody [data-k=amount]');input.value='-100';input.dispatchEvent(new Event('input',{bubbles:true}));
          return {amount:S.items[0].amount,invalid:!input.checkValidity(),fixed:fixedIn(cycleStart())};
        }''')
        self.assertEqual(result, {'amount': 100, 'invalid': True, 'fixed': 100})

    def test_stale_ai_is_not_saved_or_charged_to_another_account(self):
        result = self.page.evaluate('''async () => {
          let release;askOpenAI=()=>new Promise(r=>release=r);S.aiLimit=0;
          const pending=aiAsk({name:'fixture',system:'x',user:'x',out:128,priority:'high'}).catch(e=>e.kind);
          accountEpoch++;S=clone(DEFAULTS);prepare();release({tokens:333,a:{}});
          return {result:await pending,used:aiUsed()};
        }''')
        self.assertEqual(result, {'result': 'stale', 'used': 0})

    def test_ai_reserves_budget_for_concurrent_requests(self):
        result = self.page.evaluate('''async () => {
          S.aiLimit=700;let release;askOpenAI=()=>new Promise(r=>release=r);
          const job={name:'fixture',system:'x',user:'x',out:128,priority:'high'};
          const first=aiAsk(job);let blocked;
          try{await aiAsk({...job,user:'y'})}catch(e){blocked=e.kind}
          release({tokens:100,a:{}});await first;return {blocked,used:aiUsed()};
        }''')
        self.assertEqual(result, {'blocked': 'limit', 'used': 100})

    def test_ai_request_output_cap_matches_its_budget_and_private_labels(self):
        result = self.page.evaluate('''async () => {
          let body;window.fetch=async(url,options)=>{body=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{message:{content:'{}'}}],usage:{prompt_tokens:10,completion_tokens:10}})}};
          await askOpenAI(aiConf(),{system:'x',user:'x',out:256,schema:{required:[]},check:a=>a});
          S.ai={openai:{key:'fixture'}};S.items.push({id:uid++,name:'Different',kind:'loan',amount:101,left:9,total:12,day:26});
          let prompt='';aiAsk=async job=>{prompt=job.user;return {a:[]}};
          applyBB([{bank:'BPI',type:'credit_card',last4:'1234',account_key:'bpi',amount:1000,due_date:'2026-10-26',installments:[{label:'Phone',term:3,of:12,amount:100}]}]);
          await Promise.resolve();return {cap:body.max_completion_tokens,hasDigits:prompt.includes('1234'),asked:prompt.includes('Statement plans')};
        }''')
        self.assertEqual(result, {'cap': 256, 'hasDigits': False, 'asked': True})

    def test_ai_timeout_includes_a_stalled_response_body(self):
        self.page.evaluate('''() => {
          window.fetch=async(url,options)=>({ok:true,status:200,json:()=>new Promise((resolve,reject)=>{
            options.signal.addEventListener('abort',()=>reject(new Error('aborted')));
          })});
          window.finished='pending';aiFetch('https://fixture.invalid/model').catch(()=>{finished='timed-out'});
        }''')
        self.page.clock.run_for(30001)
        self.assertEqual(self.page.evaluate('finished'), 'timed-out')

    def test_known_issuer_plan_id_is_retained_when_one_feed_omits_it(self):
        result = self.page.evaluate('''() => {
          const b={bank:'BPI',type:'credit_card',account_key:'bpi',amount:100,due_date:'2026-10-26',installments:[{label:'Phone',term:3,of:12,amount:100,plan_id:'issuer-99'}]};
          applyBB([b]);const id=S.items.find(i=>i.bbInst).id;
          applyBB([{...b,installments:[{label:'Phone',term:3,of:12,amount:100}]}]);
          const plan=S.items.find(i=>i.bbInst);return {count:S.items.filter(i=>i.bbInst).length,id:plan.id===id,source:plan.bbPlanId};
        }''')
        self.assertEqual(result, {'count': 1, 'id': True, 'source': 'issuer-99'})

    def test_source_fields_are_explicitly_read_only_and_refresh_consistently(self):
        result = self.page.evaluate('''() => {
          const b={bank:'BPI',type:'credit_card',account_key:'bpi',amount:200,due_date:'2026-10-26'};applyBB([b]);
          const i=S.items.find(x=>x.bbDue);openBill(i.id);const input=document.querySelector('#billBody [data-k=amount]');
          input.value='300';input.dispatchEvent(new Event('input',{bubbles:true}));
          const unchanged=i.amount;applyBB([{...b,amount:250}]);
          return {unchanged,readOnly:input.readOnly,value:document.querySelector('#billBody [data-k=amount]').value,state:i.amount};
        }''')
        self.assertEqual(result, {'unchanged': 200, 'readOnly': True, 'value': '250', 'state': 250})

    def test_card_removal_preserves_a_valid_retained_plan_relationship(self):
        result = self.page.evaluate('''() => {
          applyBB([{bank:'BPI',type:'credit_card',account_key:'bpi',amount:200,due_date:'2026-10-26',installments:[{label:'Phone',term:3,of:12,amount:100}]}]);
          openSheet('acct',S.accounts[0],false);document.querySelector('#sheetBody [data-adel]').click();
          const plan=S.items.find(x=>x.bbInst);return {linked:S.accounts.some(a=>a.key===plan.inCard),waiting:plan.bbWaiting,left:plan.left,archived:S.accounts[0].archived};
        }''')
        self.assertEqual(result, {'linked': True, 'waiting': True, 'left': 10, 'archived': True})

    def test_archived_card_returns_only_for_a_new_statement(self):
        result = self.page.evaluate('''() => {
          const b={bank:'BPI',type:'credit_card',account_key:'bpi',amount:200,due_date:'2026-10-26',installments:[{label:'Phone',term:3,of:12,amount:100}]};
          applyBB([b]);openSheet('acct',S.accounts[0],false);document.querySelector('#sheetBody [data-adel]').click();
          applyBB([b]);const remainedArchived=S.accounts[0].archived;
          applyBB([{...b,statement_id:'nov',due_date:'2026-11-26',installments:[{label:'Phone',term:4,of:12,amount:100}]}]);
          return {remainedArchived,active:!S.accounts[0].archived,plans:S.items.filter(i=>i.bbInst).length};
        }''')
        self.assertEqual(result, {'remainedArchived': True, 'active': True, 'plans': 1})

    def test_source_sync_does_not_adopt_an_unconfirmed_manual_bill(self):
        result = self.page.evaluate('''() => {
          newBill('loan');const pending=S.items[0];pending.name='UnionBank Loan';pending.amount=100;
          applyBB([{bank:'UnionBank',type:'loan',account_key:'ub',amount:100,due_date:'2026-10-26',installments:[{label:'Loan',term:3,of:12,amount:100}]}]);
          return {stillProvisional:pending._provisional,sourceMatchedPending:!!pending.bbKey,imported:JSON.parse(snapshot()).items.filter(i=>i.bbDue).length};
        }''')
        self.assertEqual(result, {'stillProvisional': True, 'sourceMatchedPending': False, 'imported': 1})

    def test_only_current_statement_plans_contribute_to_period_total(self):
        result = self.page.evaluate('''() => {
          let b={bank:'BPI',type:'credit_card',account_key:'bpi',amount:1000,due_date:'2026-10-26',installments:[{label:'Phone',term:3,of:12,amount:100},{label:'Laptop',term:12,of:12,amount:200}]};
          applyBB([b]);applyBB([{...b,statement_id:'nov',due_date:'2026-11-26',installments:[{label:'Phone',term:4,of:12,amount:100}]}]);renderAccounts();
          return document.querySelector('#acctList .cplan.foot').innerText;
        }''')
        self.assertIn('₱100.00', result)

    def test_unknown_credit_limit_does_not_hide_known_debt(self):
        self.page.evaluate("applyBB([{bank:'BPI',type:'credit_card',account_key:'bpi',amount:1000,due_date:'2026-10-26'}]);renderAccounts()")
        self.assertEqual(self.page.locator('#acctSum .v').nth(1).inner_text(), '₱1,000.00')

    def test_feed_failures_back_off_instead_of_polling_every_three_seconds(self):
        self.page.evaluate('''() => {
          cloudReady=true;S.bb={url:'https://fixture.invalid/api/bills',key:'fixture'};window.calls=0;
          window.fetch=async()=>{calls++;throw new Error('offline')};syncBillBuddy();
        }''')
        self.page.clock.run_for(5999)
        self.assertEqual(self.page.evaluate('calls'), 1)
        self.page.clock.run_for(4000)
        self.assertEqual(self.page.evaluate('calls'), 2)

    def test_wrong_feed_key_pauses_until_the_connection_changes(self):
        self.page.evaluate('''() => {
          cloudReady=true;S.bb={url:'https://fixture.invalid/api/bills',key:'wrong'};window.calls=0;
          window.fetch=async()=>{calls++;return {status:401}};syncBillBuddy();
        }''')
        self.page.clock.run_for(65000)
        self.assertEqual(self.page.evaluate('calls'), 1)
        self.page.evaluate('''() => {
          document.querySelector('#bbUrl').value=S.bb.url;document.querySelector('#bbKey').value='fixed';bbConnect();
        }''')
        self.assertEqual(self.page.evaluate('calls'), 2)

    def test_new_account_saves_are_not_stalled_by_old_pending_requests(self):
        self.page.evaluate('''() => {
          cloudReady=true;cloudUser={id:'A'};cloudAt='a-version';window.releases=[];window.calls=[];
          sb={rpc:(name,args)=>{calls.push({user:cloudUser.id,args});return new Promise(r=>releases.push(r))},
            from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{state:{...clone(DEFAULTS),items:[],accounts:[],salary:200},updated_at:'b-version'},error:null})})})})};
          pushCloud();cloudUser={id:'B'};startCloud(cloudUser);
        }''')
        self.page.evaluate('''async () => {await Promise.resolve();await Promise.resolve();S.salary=300;save()}''')
        self.page.clock.run_for(750)
        self.assertEqual(self.page.evaluate('calls.map(c=>c.user)'), ['A', 'B'])
        self.assertEqual(self.page.evaluate('calls[1].args.p_expected_at'), 'b-version')
        self.page.evaluate("releases[0]({data:'old-a-version',error:null});releases[1]({data:'new-b-version',error:null})")
        self.assertEqual(self.page.evaluate('cloudAt'), 'new-b-version')

    def test_state_reset_during_a_save_uses_the_acknowledged_version(self):
        self.page.evaluate('''() => {
          cloudReady=true;cloudUser={id:'A'};cloudAt='v0';window.releases=[];window.calls=[];
          sb={rpc:(name,args)=>{calls.push(args);return new Promise(r=>releases.push(r))}};
          S.salary=100;window.first=pushCloud();S=clone(S);S.salary=200;window.second=pushCloud();
        }''')
        self.page.evaluate("async()=>{releases[0]({data:'v1',error:null});await first;await second}")
        self.page.clock.run_for(1)
        self.assertEqual(self.page.evaluate('calls[1].p_expected_at'), 'v1')
        self.assertEqual(self.page.evaluate('calls[1].p_state.salary'), 200)
        self.page.evaluate("releases[1]({data:'v2',error:null})")

    def test_old_ai_answer_is_discarded_after_same_account_state_reset(self):
        result = self.page.evaluate('''async () => {
          let release;askOpenAI=()=>new Promise(r=>release=r);
          const pending=aiAsk({name:'fixture',system:'x',user:'x',out:128,priority:'high'}).catch(e=>e.kind);
          S=clone(S);release({tokens:123,a:{}});return {result:await pending,usage:aiUsed()};
        }''')
        self.assertEqual(result, {'result': 'stale', 'usage': 123})

    def test_permanent_save_error_keeps_unsaved_changes_and_blocks_draft(self):
        self.page.evaluate('''async () => {
          cloudReady=true;cloudUser={id:'A'};S.salary=321;
          sb={rpc:async()=>({error:{code:'PGRST202'}})};save();await pushCloud();
          window.draftAttempt=openDraft();
        }''')
        self.page.clock.run_for(10)
        self.assertTrue(self.page.evaluate('cloudDirty'))
        self.assertFalse(self.page.evaluate('!!draft'))
        self.assertEqual(self.page.evaluate('S.salary'), 321)

    def test_iframe_never_initializes_cloud_authentication(self):
        self.page.evaluate('''() => {
          window.frame=document.createElement('iframe');frame.src='/';document.body.append(frame);
        }''')
        iframe = self.page.frames[-1]
        iframe.wait_for_load_state()
        self.assertTrue(iframe.evaluate("typeof sb==='undefined'||sb===null"))


if __name__ == '__main__':
    unittest.main()
