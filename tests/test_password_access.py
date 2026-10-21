"""Password access with a synthetic Supabase client; no live account changes."""
from pathlib import Path
import unittest
from urllib.parse import urlsplit
import test_billbuddy_sync as sync_tests

STUB = r'''
window.authCalls=[];
window.fixtureSettings={external:{email:true},mailer_autoconfirm:true,disable_signup:false};
window.supabase={createClient:(url,key,options)=>{
  window.authOptions=options;
  let callback;
  let session=JSON.parse(localStorage.getItem('fixtureSession')||'null');
  const user=email=>({id:email.startsWith('p-')?'new-account':'existing-account',email,user_metadata:{}});
  function persist(next){session=next;if(next)localStorage.setItem('fixtureSession',JSON.stringify(next));else localStorage.removeItem('fixtureSession')}
  function signed(email){const u=user(email);persist({user:u,access_token:'fixture-token'});callback('SIGNED_IN',session);return {data:{user:u,session},error:null}}
  return {
    auth:{
      onAuthStateChange:cb=>{callback=cb;window.authEvent=cb;setTimeout(()=>cb('INITIAL_SESSION',session),0);return {data:{subscription:{unsubscribe(){}}}}},
      signInWithPassword:async input=>{authCalls.push({kind:'signin',email:input.email});if(window.authDeferred)return await new Promise(resolve=>window.finishAuth=()=>resolve(signed(input.email)));
        return input.password==='correct password 123'?signed(input.email):{data:{},error:{message:'Invalid login credentials'}}},
      signUp:async input=>{authCalls.push({kind:'signup',email:input.email});return signed(input.email)},
      updateUser:async input=>{authCalls.push({kind:'password',id:session?.user.id});
        if(window.failPassword)return {data:{},error:{message:'Could not update password'}};
        session.user.user_metadata={...session.user.user_metadata,...input.data};persist(session);callback('USER_UPDATED',session);return {data:{user:session.user},error:null}},
      refreshSession:async()=>{authCalls.push({kind:'refresh'});return window.failRefresh?{data:{session:null},error:{message:'Invalid Refresh Token'}}:{data:{session},error:null}},
      signOut:async options=>{authCalls.push({kind:'signout',scope:options?.scope});persist(null);callback('SIGNED_OUT',null);return {error:null}}
    },
    from:()=>({select:()=>({eq:(key,id)=>({maybeSingle:async()=>({data:id==='existing-account'?{
      state:{ver:2,rev:7,salary:45678,payday:24,buffer:1000,items:[],accounts:[],sources:[],income:[]},updated_at:'2026-10-16T00:00:00Z'}:null,error:null})})}),
      upsert:row=>({select:()=>({single:async()=>{window.upserts=(window.upserts||0)+1;const e=(window.upsertErrors||[]).shift();
        return e?{data:null,error:e}:{data:{updated_at:'2026-10-16T00:00:00Z'},error:null}}})})})
  };
}};
const nativeFetch=window.fetch;
window.fetch=(url,...args)=>String(url).endsWith('/auth/v1/settings')?
  Promise.resolve({ok:true,json:async()=>window.fixtureSettings}):nativeFetch(url,...args);
'''


class PasswordAccessTest(unittest.TestCase):
    setUpClass = classmethod(sync_tests.SyncTest.setUpClass.__func__)
    tearDownClass = classmethod(sync_tests.SyncTest.tearDownClass.__func__)

    def setUp(self):
        self.context=self.browser.new_context()
        def route(r):
            parsed=urlsplit(r.request.url)
            if parsed.hostname!='127.0.0.1': r.abort()
            elif parsed.path.endswith('/vendor/supabase-2.116.0.js'): r.fulfill(body=STUB,content_type='text/javascript')
            else: r.continue_()
        self.context.route('**/*',route)
        self.page=self.context.new_page()
        self.errors=[]
        self.page.on('pageerror',lambda e:self.errors.append(str(e)))
        self.base=f'http://127.0.0.1:{self.server.server_port}/'
        self.page.goto(self.base)
        self.page.wait_for_function("typeof authMode==='string' && authKnown")
        self.page.wait_for_timeout(30)

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors,[])

    def restore_existing(self):
        self.page.evaluate("localStorage.setItem('fixtureSession',JSON.stringify({user:{id:'existing-account',email:'owner@example.invalid',user_metadata:{}}}))")
        self.page.reload()
        self.page.wait_for_function('cloudReady')

    def test_saved_session_opens_existing_planner_without_a_login_form(self):
        self.restore_existing()
        self.assertEqual(self.page.evaluate('S.salary'),45678)
        self.assertTrue(self.page.locator('#authForm').is_hidden())
        self.assertEqual(self.page.evaluate('authCalls.length'),0)
        self.assertTrue(self.page.evaluate('authOptions.auth.persistSession && authOptions.auth.autoRefreshToken'))
        self.assertEqual(self.page.locator('input[type=email]').count(),0)
        self.assertNotIn('owner@example.invalid',self.page.locator('body').inner_text())

    def test_create_uses_password_without_email_input_and_remembers_session(self):
        self.page.click('#authCreate')
        self.page.fill('#authPassword','correct password 123')
        self.page.fill('#authConfirm','correct password 123')
        self.page.click('#authSend')
        self.page.wait_for_function('cloudReady')
        calls=self.page.evaluate('authCalls')
        self.assertEqual(calls[0]['kind'],'signup')
        self.assertTrue(calls[0]['email'].endswith('@accounts.credit-organizer.invalid'))
        self.assertTrue(self.page.locator('#accountAccess').is_visible())
        self.assertTrue(self.page.locator('#accountCode').input_value().startswith('CO1.'))
        self.assertEqual(self.page.locator('#authPassword').input_value(),'')
        self.assertNotIn('correct password 123',self.page.evaluate('JSON.stringify(localStorage)'))
        self.page.reload()
        self.page.wait_for_function('cloudReady')
        self.assertEqual(self.page.evaluate('authCalls.length'),0)

    def test_confirmation_setting_blocks_unusable_signup_before_account_creation(self):
        self.page.evaluate('fixtureSettings.mailer_autoconfirm=false')
        self.page.click('#authCreate')
        self.page.fill('#authPassword','correct password 123')
        self.page.fill('#authConfirm','correct password 123')
        self.page.click('#authSend')
        self.page.wait_for_function('!authBusy')
        self.assertEqual(self.page.evaluate('authCalls.length'),0)
        self.assertIn('one-time setup',self.page.locator('#authMsg').inner_text())
        self.assertFalse(self.page.evaluate('cloudReady'))

    def test_set_password_keeps_same_user_and_planner_then_signin_needs_only_password(self):
        self.restore_existing()
        self.page.click('#accessBtn')
        self.page.fill('#accountPassword','correct password 123')
        self.page.fill('#accountConfirm','correct password 123')
        self.page.click('#accountSave')
        self.page.wait_for_function("document.querySelector('#accountMsg').textContent.startsWith('Password saved')")
        self.assertEqual(self.page.evaluate('cloudUser.id'),'existing-account')
        self.assertEqual(self.page.evaluate('S.salary'),45678)
        self.assertEqual(self.page.evaluate('authCalls[0].kind'),'password')
        self.page.click('#authBtn')
        self.page.wait_for_function('!cloudUser')
        self.assertEqual(self.page.evaluate("authCalls.find(call=>call.kind==='signout').scope"),'local')
        self.assertTrue(self.page.locator('#authCodeField').is_hidden())
        self.page.fill('#authPassword','correct password 123')
        self.page.click('#authSend')
        self.page.wait_for_function('cloudReady')
        self.assertEqual(self.page.evaluate('S.salary'),45678)
        self.assertNotIn('correct password 123',self.page.evaluate('JSON.stringify(localStorage)'))

    def test_account_code_identifies_existing_planner_on_a_new_device_but_does_not_unlock_it(self):
        code=self.page.evaluate("accountCode('owner@example.invalid')")
        self.page.click('#authExisting')
        self.page.fill('#authCode',code)
        self.page.fill('#authPassword','incorrect password')
        self.page.click('#authSend')
        self.page.wait_for_function('!authBusy')
        self.assertIn('incorrect',self.page.locator('#authMsg').inner_text())
        self.assertFalse(self.page.evaluate('cloudReady'))
        self.page.fill('#authPassword','correct password 123')
        self.page.click('#authSend')
        self.page.wait_for_function('cloudReady')
        self.assertEqual(self.page.evaluate('cloudUser.id'),'existing-account')
        self.assertEqual(self.page.evaluate('S.salary'),45678)

    def test_stale_signed_out_event_cannot_wipe_a_restored_session(self):
        self.page.evaluate("authEvent('SIGNED_OUT',null);authEvent('SIGNED_IN',{user:{id:'existing-account',email:'owner@example.invalid',user_metadata:{}}})")
        self.page.wait_for_function('cloudReady')
        self.assertEqual(self.page.evaluate('S.salary'),45678)

    def test_invalid_code_and_mismatched_passwords_do_not_call_auth(self):
        self.page.click('#authExisting')
        self.page.fill('#authCode','not a code')
        self.page.fill('#authPassword','correct password 123')
        self.page.click('#authSend')
        self.assertEqual(self.page.evaluate('authCalls.length'),0)
        self.page.evaluate("setAuthMode('create')")
        self.page.fill('#authPassword','correct password 123')
        self.page.fill('#authConfirm','different password 123')
        self.page.click('#authSend')
        self.assertEqual(self.page.evaluate('authCalls.length'),0)
        self.assertIn('do not match',self.page.locator('#authMsg').inner_text())

    def test_password_failure_does_not_sign_out_or_create_a_new_planner(self):
        self.restore_existing()
        self.page.evaluate('failPassword=true')
        self.page.click('#accessBtn')
        self.page.fill('#accountPassword','correct password 123')
        self.page.fill('#accountConfirm','correct password 123')
        self.page.click('#accountSave')
        self.page.wait_for_function("document.querySelector('#accountMsg').textContent.includes('not changed')")
        self.assertEqual(self.page.evaluate('cloudUser.id'),'existing-account')
        self.assertEqual(self.page.evaluate('S.salary'),45678)
        self.assertEqual(self.page.evaluate('authCalls.length'),1)

    def test_duplicate_pending_signins_share_one_authentication_attempt(self):
        self.page.evaluate('authDeferred=true')
        self.page.click('#authExisting')
        self.page.fill('#authCode', self.page.evaluate("accountCode('owner@example.invalid')"))
        self.page.fill('#authPassword','correct password 123')
        self.page.click('#authSend')
        self.page.evaluate('() => { submitPasswordAuth(); submitPasswordAuth(); }')
        self.assertEqual(self.page.evaluate('authCalls.length'),1)
        self.page.evaluate('finishAuth()')
        self.page.wait_for_function('cloudReady')
        self.assertEqual(self.page.evaluate('cloudUser.id'),'existing-account')

    def test_old_save_cannot_replace_the_new_accounts_sync_timestamp(self):
        self.restore_existing()
        self.page.evaluate("""() => {
          sb.from=()=>({upsert:row=>{window.oldSaveOwner=row.user_id;return {select:()=>({single:()=>new Promise(resolve=>{
            window.finishSave=()=>resolve({data:{updated_at:'2099-01-01'},error:null});
          })})}}});
          window.pendingSave=pushCloud();
          cloudUser={id:'different-account'};cloudReady=true;cloudAt='2026-10-16';
          finishSave();
        }""")
        self.page.evaluate('pendingSave')
        self.assertEqual(self.page.evaluate('oldSaveOwner'),'existing-account')
        self.assertEqual(self.page.evaluate('cloudAt'),'2026-10-16')

    def test_password_form_works_on_phone_and_desktop(self):
        root=Path('/workspace/.cloud-setup')
        for width in [390,1280]:
            self.page.set_viewport_size({'width':width,'height':900})
            self.page.evaluate("setAuthMode('create')")
            self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),width)
            self.page.screenshot(path=str(root/f'password-access-{width}.png'),full_page=True)
        self.restore_existing()
        self.page.click('#accessBtn')
        for width in [390,1280]:
            self.page.set_viewport_size({'width':width,'height':900})
            self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),width)
            self.page.screenshot(path=str(root/f'password-account-{width}.png'),full_page=True)

    def test_expired_sign_in_is_renewed_and_the_save_goes_through(self):
        self.restore_existing()
        self.page.evaluate("upsertErrors=[{message:'JWT expired',code:'PGRST303'}];upserts=0;S.salary=50000;save()")
        self.page.wait_for_function("upserts===2",timeout=5000)
        self.page.wait_for_function("$('#syncState').textContent==='Saved'",timeout=5000)
        self.assertIn({'kind':'refresh'},self.page.evaluate('authCalls'))

    def test_failed_renewal_and_other_errors_say_why(self):
        self.restore_existing()
        self.page.evaluate("failRefresh=true;upsertErrors=[{message:'JWT expired',code:'PGRST303'}];S.salary=50000;save()")
        self.page.wait_for_function("/sign-in expired/.test($('#syncState').textContent)",timeout=5000)
        self.page.evaluate("clearTimeout(cloudTimer);cloudTimer=null;upsertErrors=[{message:'value too long for type',code:'22001'}];save()")
        self.page.wait_for_function("/value too long/.test($('#syncState').textContent)",timeout=5000)
