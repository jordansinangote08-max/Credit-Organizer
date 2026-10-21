"""Financial manager with local calculations and mocked GPT responses; no live keys."""
import json
from pathlib import Path
import unittest
import test_billbuddy_sync as sync_tests


class FinancialManagerTest(unittest.TestCase):
    setUpClass = classmethod(sync_tests.SyncTest.setUpClass.__func__)
    tearDownClass = classmethod(sync_tests.SyncTest.tearDownClass.__func__)
    tearDown = sync_tests.SyncTest.tearDown

    def setUp(self):
        sync_tests.SyncTest.setUp(self)
        self.page.evaluate('''() => {
          save=()=>{};cloudUser={id:'finance-fixture',email:'fixture@example.invalid'};cloudReady=true;authKnown=true;
          document.body.classList.remove('locked');
          S.salary=30000;S.buffer=2000;S.items=[{id:1,name:'Rent',kind:'essential',amount:8000,day:24}];
          S.ai={openai:{key:'fixture-private-key'}};S.bb={key:'fixture-billbuddy-secret'};
          S.advisorTurns=[];S.advisorCache=[];S.advisorNotes='Keep medicine money available.';
          syncInputs();renderAuth();renderAll();fillAI();setSync('ok','Saved');selectTab('ai');
        }''')
        self.install_responder()

    def install_responder(self):
        self.page.evaluate('''() => {
          window.requests=[];window.responseMode='ok';
          window.advisorReply={answer:'Keep essentials and the buffer covered before extra debt payments.',
            actions:['Confirm minimum payments and actual balances.'],tradeoffs:['A lower monthly payment can cost more overall.'],
            question:'What are your outstanding balances and effective rates?'};
          window.fetch=async (url,options)=>{
            if(!String(url).endsWith('/chat/completions'))throw new Error('No external request permitted');
            window.requests.push(JSON.parse(options.body));
            return {ok:true,status:200,json:async()=>({model:'gpt-6-luna-confirmed',
              choices:[{finish_reason:window.responseMode==='cutoff'?'length':'stop',message:{content:
                window.responseMode==='invalid'?'not json':JSON.stringify(window.advisorReply)}}],
              usage:{prompt_tokens:110,completion_tokens:47,total_tokens:157}})};
          };
        }''')

    def ask(self, question):
        return self.page.evaluate('question=>askFinancialManager(question)', question)

    def test_natural_language_uses_relevant_facts_bounded_output_and_no_secrets(self):
        self.ask('Paano ko babayaran ang utang habang may sapat para sa bills?')
        body = self.page.evaluate('requests[0]')
        self.assertEqual(body['model'], 'gpt-6-luna')
        self.assertEqual(body['max_completion_tokens'], 700)
        self.assertEqual(body['reasoning_effort'], 'low')
        payload = json.loads(body['messages'][1]['content'])
        self.assertIn('utang', payload['question'])
        self.assertIn('debt', payload['planner']['focus'])
        self.assertIn('Keep medicine money available.', payload['planner']['goals'])
        self.assertNotIn('fixture-private-key', json.dumps(body))
        self.assertNotIn('fixture-billbuddy-secret', json.dumps(body))
        self.assertEqual(self.page.evaluate('aiUsed()'), 157)
        self.assertEqual(self.page.evaluate('S.advisorTurns.length'), 1)

    def test_missing_statement_amounts_stay_unknown(self):
        cards = self.page.evaluate('''() => {
          S.accounts=['missing','unknown','paid','known'].map(key=>({key,name:key,limit:10000}));
          S.items=[{id:1,acct:'unknown',name:'unknown',amount:null},
            {id:2,acct:'paid',name:'paid',amount:1200,paidCycle:cycleKey()},
            {id:3,acct:'known',name:'known',amount:2000,day:24}];
          return advisorFacts('How much do I owe on my card?').cards.rows;
        }''')
        by_name = {card['name']: card for card in cards}
        for name in ['missing', 'unknown']:
            self.assertIsNone(by_name[name]['unpaid_statement'])
            self.assertIsNone(by_name[name]['unpaid_statement_pct'])
            self.assertIsNone(by_name[name]['due'])
        self.assertEqual(by_name['paid']['unpaid_statement'], 0)
        self.assertEqual(by_name['known']['unpaid_statement'], 2000)
        self.assertEqual(by_name['known']['unpaid_statement_pct'], 20)

    def test_local_calculations_need_no_key_or_ai_and_next_payday_is_not_next_planner_cycle(self):
        self.page.evaluate('S.ai={};S.payday=24')
        result = self.ask('When is my next payday?')
        self.assertTrue(result['local'])
        self.assertIn('Oct 24', result['a']['answer'])
        self.assertEqual(self.page.evaluate('requests.length'), 0)
        self.assertTrue(self.ask('What is my buffer?')['local'])

    def test_repeated_question_and_restored_cache_use_no_new_request_or_tokens(self):
        question = 'How can I improve my credit card utilization?'
        self.ask(question)
        self.assertTrue(self.ask(question)['cached'])
        self.assertEqual(self.page.evaluate('requests.length'), 1)
        self.assertEqual(self.page.evaluate('aiUsed()'), 157)
        # Rehydrate an account snapshot with memory caches cleared, as on a fresh page.
        self.page.evaluate('S=JSON.parse(snapshot());S.advisorTurns=[];aiMemo.clear()')
        self.assertTrue(self.ask(question)['cached'])
        self.assertEqual(self.page.evaluate('requests.length'), 1)
        self.page.evaluate('S.salary=25000')
        self.ask(question)
        self.assertEqual(self.page.evaluate('requests.length'), 2)

    def test_small_followups_and_large_planner_are_bounded_with_explicit_omissions(self):
        self.page.evaluate('''() => {
          S.items=Array.from({length:100},(_,i)=>({id:i+1,name:'Debt '+i+' x'.repeat(200),kind:'loan',amount:100,day:24,left:12}));
          S.advisorTurns=Array.from({length:6},(_,i)=>({question:'Prior question '+i+' x'.repeat(1000),result:{a:{answer:'x'.repeat(1000)}}}));
        }''')
        self.ask('How should I plan debt payoff?')
        payload = json.loads(self.page.evaluate('requests[0].messages[1].content'))
        self.assertEqual(payload['planner']['installments']['omitted'], 88)
        self.assertEqual(len(payload['planner']['installments']['rows']), 12)
        self.assertLessEqual(len(payload['recent']), 2)
        self.assertLess(len(json.dumps(payload)), 14000)

    def test_changed_goals_and_provider_invalidate_the_repeated_answer(self):
        question = 'How should I manage my credit?'
        self.ask(question)
        self.page.evaluate("S.advisorNotes='Keep a larger medicine buffer.'")
        self.ask(question)
        self.page.evaluate("S.ai.openai.key='sk-or-fixture-private-key'")
        self.ask(question)
        self.assertEqual(self.page.evaluate('requests.length'), 3)
        self.assertEqual(self.page.evaluate('requests[2].model'), 'openai/gpt-6-luna')

    def test_invalid_or_cutoff_answer_counts_actual_usage_and_does_not_retry(self):
        for mode in ['invalid', 'cutoff']:
            self.page.evaluate('mode=>{responseMode=mode}', mode)
            error = self.page.evaluate("askFinancialManager('Review my budget '+responseMode).catch(e=>e.kind)")
            self.assertEqual(error, 'incomplete')
        self.assertEqual(self.page.evaluate('requests.length'), 2)
        self.assertEqual(self.page.evaluate('aiUsed()'), 314)
        self.assertEqual(self.page.evaluate('S.advisorTurns.length'), 0)

    def test_duplicate_pending_requests_share_one_call_and_budget_is_reserved(self):
        result = self.page.evaluate('''async () => {
          S.aiLimit=2500;
          let release;window.fetch=()=>new Promise(resolve=>release=resolve);
          const job={name:'financial_manager',purpose:'advisor',system:ADVISOR_SYSTEM,schema:ADVISOR_SCHEMA,
            check:checkAdvisor,priority:'high',out:700,user:'one'};
          const first=aiAsk(job),same=aiAsk(job);
          const other=await aiAsk({...job,user:'different'}).then(()=>null,e=>e.kind);
          release({ok:true,status:200,json:async()=>({model:'gpt-6-luna',usage:{total_tokens:157},
            choices:[{finish_reason:'stop',message:{content:JSON.stringify(advisorReply)}}]})});
          const answers=await Promise.all([first,same]);return {other,used:aiUsed(),count:answers.length};
        }''')
        self.assertEqual(result, {'other': 'limit', 'used': 157, 'count': 2})

    def test_new_conversation_does_not_restore_late_answer(self):
        result = self.page.evaluate('''async () => {
          let release;window.fetch=()=>new Promise(resolve=>release=resolve);
          const pending=askFinancialManager('How should I manage debt?').catch(e=>e.kind);
          while(!release)await new Promise(resolve=>setTimeout(resolve,0));
          document.querySelector('#advisorNew').click();
          release({ok:true,status:200,json:async()=>({model:'gpt-6-luna',usage:{total_tokens:157},
            choices:[{finish_reason:'stop',message:{content:JSON.stringify(advisorReply)}}]})});
          return {error:await pending,turns:S.advisorTurns.length,used:aiUsed()};
        }''')
        self.assertEqual(result, {'error': 'context', 'turns': 0, 'used': 157})

    def test_stale_account_response_never_appears_or_charges_the_new_owner(self):
        result = self.page.evaluate('''async () => {
          let release;window.fetch=()=>new Promise(resolve=>release=resolve);
          const pending=askFinancialManager('Help me prioritize debt.').catch(e=>e.kind);
          while(!release)await new Promise(resolve=>setTimeout(resolve,0));
          resetAiSession();cloudUser={id:'another-owner'};S=clone(DEFAULTS);S.advisorTurns=[];
          release({ok:true,status:200,json:async()=>({model:'gpt-6-luna',usage:{total_tokens:157},
            choices:[{finish_reason:'stop',message:{content:JSON.stringify(advisorReply)}}]})});
          return {error:await pending,turns:S.advisorTurns.length,used:aiUsed()};
        }''')
        self.assertEqual(result, {'error': 'context', 'turns': 0, 'used': 0})

    def test_manager_ui_safe_rendering_and_mobile_desktop_layout(self):
        self.page.evaluate("advisorReply.answer='Review <img src=x onerror=alert(1)> safely.'")
        self.page.locator('.ask-more > summary').click()  # typed questions sit under "Ask something specific"
        self.page.locator('#advisorQuestion').fill('What should I prioritize before payday?')
        self.page.locator('#advisorAsk').click()
        self.page.wait_for_function('S.advisorTurns.length===1')
        self.assertEqual(self.page.locator('#advisorConversation img').count(), 0)
        for name,width in [('mobile',390),('desktop',1280)]:
            self.page.set_viewport_size({'width':width,'height':900})
            self.page.add_style_tag(content='.panel{animation:none!important}')
            self.page.locator('#tab-ai').click()
            self.page.evaluate('window.scrollTo(0,0)')
            self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            self.page.screenshot(path=f'/workspace/.cloud-setup/financial-manager-{name}.png',full_page=True)


if __name__ == '__main__':
    unittest.main()
