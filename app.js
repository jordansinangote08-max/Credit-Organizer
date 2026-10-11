const KEY='sahodplan.v1';
// Starting data: only the installments. Everything else starts empty.
// rev marks the data upgrades below as already applied, so they don't add creditors or cards back.
const DEFAULTS={ver:2,salary:0,payday:24,thirteenth:0,efund:5000,buffer:2000,income:[],sources:[],accounts:[],rev:7,items:[
 {name:'UnionBank Loan A',kind:'loan',amount:4384.71,day:24,left:6,total:12,rate:2.49},
 {name:'UnionBank Loan B',kind:'loan',amount:3897.52,day:26,left:9,total:12,rate:2.49},
 {name:'Mari Loan',kind:'loan',amount:7256.67,day:26,left:3,rate:2.95,addon:true}
]};
const SRC_DEFAULT=[];
// iOS-style icons for the edit and remove buttons; each button carries its own label for screen readers
const IC={
  edit:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15.2 5.2l3.6 3.6M4 20l1-4.6L15.6 4.8a2 2 0 012.8 0l.8.8a2 2 0 010 2.8L8.6 19 4 20z"/></svg>',
  trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  undo:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/></svg>',
  spark:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.7 1.8L21.5 17.5l-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z"/></svg>',
  bad:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 4.3L2.6 18a2 2 0 001.7 3h15.4a2 2 0 001.7-3L13.7 4.3a2 2 0 00-3.4 0z"/><path d="M12 9.5v4"/><path d="M12 17.2h.01"/></svg>',
  warn:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.3h.01"/></svg>',
  ok:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.2 12.4l2.6 2.6 5-5.2"/></svg>',
  chev:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 6l6 6-6 6"/></svg>'
};
const editBtn=(attr,name)=>`<button class="ghost ib" ${attr} aria-label="Edit ${esc(name)}" title="Edit">${IC.edit}</button>`;
const paidBtn=(attr,name)=>`<button class="paidbtn ib" ${attr} aria-label="Mark ${esc(name)} paid" title="Paid">${IC.check}</button>`;
const undoBtn=(attr,name)=>`<button class="ghost ib" ${attr} aria-label="Undo paid for ${esc(name)}" title="Undo">${IC.undo}</button>`;
const delBtn=(attr,label)=>`<button class="danger ib" ${attr} aria-label="${esc(label)}" title="${esc(label)}">${IC.trash}</button>`;
const clone=o=>JSON.parse(JSON.stringify(o));
const $=s=>document.querySelector(s);
const num=v=>{const n=parseFloat(v);return isFinite(n)?n:0};
const cents=x=>Math.round(num(x)*100)/100;
const peso=n=>{const v=Math.round(n*100)/100;return (v<0?'−₱':'₱')+Math.abs(v).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WD=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const fmtD=d=>MON[d.getMonth()]+' '+d.getDate();
const iso=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const parseD=s=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||'');return m?new Date(+m[1],+m[2]-1,+m[3]):null};

let uid=1,S=clone(DEFAULTS);
// Everything lives in Supabase. Earlier versions kept data in this browser: it moves to the
// account on its first sign-in (if the account is still empty) and is then deleted here.
const LEGACY_KEYS=[KEY,KEY+'.tab',KEY+'.billbuddy'];
let legacy=null;
try{
  const old=JSON.parse(localStorage.getItem(KEY)),bb=JSON.parse(localStorage.getItem(KEY+'.billbuddy'));
  if(old&&Array.isArray(old.items)&&old.ver===DEFAULTS.ver)legacy=old;
  if(bb&&bb.url&&bb.key){legacy=legacy||clone(DEFAULTS);legacy.bb=bb}
}catch(e){}

// ---------- dates ----------
const clampPd=()=>Math.min(31,Math.max(1,Math.round(num(S.payday))||24));
const dim=(y,m)=>new Date(y,m+1,0).getDate();
// Pay schedule: once a month on `payday`, twice a month on `payday` and `payday2`, or every week on
// `payweekday` (0 = Sunday). A pay cycle runs from one payday to the day before the next.
const payFreq=()=>S.payfreq==='twice'||S.payfreq==='week'?S.payfreq:'month';
const dayNum=(v,d)=>Math.min(31,Math.max(1,Math.round(num(v))||d));
function paysIn(y,m){
  const ds=payFreq()==='twice'?[dayNum(S.payday,15),dayNum(S.payday2,30)]:[clampPd()];
  return [...new Set(ds.map(d=>Math.min(d,dim(y,m))))].sort((a,b)=>a-b).map(d=>new Date(y,m,d));
}
function nextPay(d){
  if(payFreq()==='week'){const r=new Date(d.getFullYear(),d.getMonth(),d.getDate()+1);while(r.getDay()!==num(S.payweekday)%7)r.setDate(r.getDate()+1);return r}
  for(let k=0;k<3;k++){const f=new Date(d.getFullYear(),d.getMonth()+k,1),p=paysIn(f.getFullYear(),f.getMonth()).find(x=>x>d);if(p)return p}
}
function prevPay(d){
  if(payFreq()==='week'){const r=new Date(d.getFullYear(),d.getMonth(),d.getDate()-1);while(r.getDay()!==num(S.payweekday)%7)r.setDate(r.getDate()-1);return r}
  for(let k=0;k<3;k++){const f=new Date(d.getFullYear(),d.getMonth()-k,1),p=paysIn(f.getFullYear(),f.getMonth()).filter(x=>x<d).pop();if(p)return p}
}
// Paydays are worked out once and remembered: every bill, row and chart asks for the same few dates.
// The memo starts over whenever the schedule changes. Callers never change the dates they get back.
let payMemo=new Map(),paySig='';
function payCache(){const sig=[payFreq(),S.payday,S.payday2,S.payweekday].join();if(sig!==paySig||payMemo.size>2000){payMemo=new Map();paySig=sig}return payMemo}
function shiftCycle(start,k){
  const m=payCache(),key=start.getTime()+'|'+k;let d=m.get(key);
  if(!d){d=start;for(let j=k;j>0;j--)d=nextPay(d);for(let j=k;j<0;j++)d=prevPay(d);m.set(key,d)}
  return d;
}
// The cycle you're living in. Paid once a month, it switches to the upcoming cycle in the last 16 days
// before payday so you can plan it; paid more often, it's the current one.
function cycleStart(){
  const t=new Date();t.setHours(0,0,0,0);
  const m=payCache(),key='start|'+t.getTime();if(m.has(key))return m.get(key);
  const v=cycleStartFor(t);m.set(key,v);return v;
}
function cycleStartFor(t){
  const p0=prevPay(new Date(t.getFullYear(),t.getMonth(),t.getDate()+1));
  if(payFreq()!=='month')return p0;
  const p1=nextPay(p0);
  return (p1-t)<=16*86400000?p1:p0;
}
function dueDate(day,start){
  let y=start.getFullYear(),m=start.getMonth();
  if(day<start.getDate()){m++;if(m>11){m=0;y++}}
  return new Date(y,m,Math.min(day,dim(y,m)));
}
const dayOf=i=>Math.min(31,Math.max(1,num(i.day)||1));
// a BillBuddy bill has an exact due date, so it only counts in the pay cycle that date falls in
// A bill repeats every month on its due day, until the month in `until` (empty: forever).
// A one-time bill (`once`) is due on its exact `date`, like a BillBuddy bill.
const ym=d=>d.getFullYear()*100+d.getMonth()+1;
const untilYm=s=>{const m=/^(\d{4})-(\d{2})$/.exec(s||'');return m?+m[1]*100+ +m[2]:null};
const repeats=i=>i.kind!=='loan'&&i.kind!=='card';
const exactDue=i=>parseD(i.bbDue)||(i.once&&repeats(i)?parseD(i.date):null);
const dueOf=(i,start)=>exactDue(i)||dueDate(dayOf(i),start);
const inCycle=(i,start)=>{
  const d=exactDue(i);if(d)return d>=start&&d<shiftCycle(start,1);
  if(i.once&&repeats(i))return false;
  const d2=dueDate(dayOf(i),start);if(d2>=shiftCycle(start,1))return false;
  const u=repeats(i)&&untilYm(i.until);return !u||ym(d2)<=u;
};
// one-time bills whose date has passed and repeating bills past their last month (kept, listed as ended)
const ended=(i,start)=>repeats(i)&&!i.bbDue&&(i.once?(exactDue(i)||start)<start:(untilYm(i.until)||Infinity)<ym(dueDate(dayOf(i),start)));

// ---------- data upgrades ----------
const PATCHES=[
 s=>{const m=s.items.find(i=>/maya/i.test(i.name)&&i.kind==='card');if(m){m.name='Maya Easy Credit';m.rate=5.99}
     if(!s.sources.some(x=>/maya/i.test(x.name)))s.sources.push({id:uid++,name:'Maya Easy Credit (unused limit)',avail:10200,rate:5.99,fee:0,term:1})},
 s=>{let m=s.sources.find(x=>/mari/i.test(x.name));if(!m){m={id:uid++};s.sources.push(m)}
     Object.assign(m,{name:'Mari Loan',avail:10000,rate:2.95,addon:true,fee:0,term:3,terms:'3,6,12'});
     const it=s.items.find(i=>/mari/i.test(i.name)&&i.kind==='loan');if(it)it.rate=2.95},
 s=>{s.items.forEach(i=>{if(i.kind==='loan'&&/unionbank loan [ab]/i.test(i.name)&&!i.total)i.total=12})},
 s=>{s.items.forEach(i=>{if(i.kind==='card')i.min=null})},
 s=>{const it=s.items.find(i=>/mari/i.test(i.name)&&i.kind==='loan');if(it)it.addon=true},
 s=>{if(!s.accounts.length)s.items.filter(i=>i.kind==='card').forEach(i=>{const maya=/maya/i.test(i.name);s.accounts.push({id:uid++,name:i.name,last4:'',limit:maya?15500:null,stmt:maya?15:null,bill:i.name})})},
 s=>{s.accounts.forEach(a=>{if(!a.key)a.key=genKey();if(a.bill!=null){const it=s.items.find(i=>i.kind==='card'&&i.name===a.bill&&!i.acct);if(it)it.acct=a.key;delete a.bill}})}
];
function prepare(){
  S.items.forEach(i=>{i.id=uid++;delete i._undo;delete i.min});
  if(!Array.isArray(S.sources))S.sources=clone(SRC_DEFAULT);
  S.sources.forEach(x=>{x.id=uid++});
  if(!Array.isArray(S.income))S.income=[];
  if(num(S.extra)>0)S.income.push({label:'Other income',amount:num(S.extra),date:iso(cycleStart())});
  delete S.extra;
  S.income.forEach(x=>{x.id=uid++});
  if(!Array.isArray(S.accounts))S.accounts=[];
  S.accounts.forEach(a=>{a.id=uid++});
  if(S.buffer==null)S.buffer=2000;
  for(let k=Number(S.rev)||0;k<PATCHES.length;k++)PATCHES[k](S);
  S.rev=PATCHES.length;
  ensureLinks();
}
function genKey(){return Math.random().toString(36).slice(2,10)}
// every credit card bill has one account in Accounts, joined by a stable key
function ensureLinks(){
  S.accounts.forEach(a=>{if(!a.key)a.key=genKey()});
  S.items.forEach(i=>{
    if(i.kind!=='card'||i.noAcct)return;
    if(i.acct&&S.accounts.some(a=>a.key===i.acct))return;
    const a={id:uid++,key:genKey(),name:i.name,last4:'',limit:null,stmt:null};S.accounts.push(a);i.acct=a.key;
  });
  ensureCats();
}
// ---------- categories ----------
// Bills are grouped into your own categories. Each one has a color and counts as one of the
// kinds above, which decides how its bills are treated (paid first, installments, cards…).
const COLORS=['green','blue','orange','amber','purple','pink','teal','slate'];
const KIND_OPTS=[['bill','Bills you must pay'],['essential','Essentials (rent, food)'],['loan','Installments'],['card','Credit cards'],['flex','Can be cut']];
const CAT_DEFAULTS=[['loan','Installments','orange'],['card','Credit cards','blue'],['essential','Rent, food & allowance','green'],['bill','Utilities & bills','amber'],['flex','Can be cut','purple']];
const catOf=i=>S.cats.find(c=>c.key===i.cat)||S.cats.find(c=>c.kind===i.kind);
function newCat(kind){const d=CAT_DEFAULTS.find(x=>x[0]===kind)||[kind,'Bills','slate'];const c={key:genKey(),name:d[1],color:d[2],kind};S.cats.push(c);return c}
// every bill sits in a category whose kind matches its own
function ensureCats(){
  if(!Array.isArray(S.cats)||!S.cats.length)S.cats=CAT_DEFAULTS.map(([kind,name,color])=>({key:genKey(),name,color,kind}));
  S.items.forEach(i=>{
    const c=S.cats.find(x=>x.key===i.cat);if(c&&c.kind===i.kind)return;
    i.cat=(S.cats.find(x=>x.kind===i.kind)||newCat(i.kind)).key;
  });
}
const billOf=a=>S.items.find(i=>i.acct===a.key);
const acctOf=i=>i.acct?S.accounts.find(a=>a.key===i.acct):null;
// a card's last 4 digits live on its account, other bills keep them on the bill
const last4Of=i=>(i.kind==='card'&&acctOf(i)?.last4)||i.bbLast4||'';

// ---------- saving ----------
// Saved to Supabase only (see the cloud section at the end); nothing is kept in the browser.
let sb=null,cloudUser=null,cloudAt=null,cloudTimer=null,cloudReady=false,pushing=false,noWriter=false,draft=null; // draft: see the end
function setSync(cls,txt){const el=$('#syncState');el.className='sync '+cls;el.textContent=txt}
const snapshot=()=>JSON.stringify(S,(k,v)=>k==='id'?undefined:v);
function save(){
  if(!cloudReady)return;
  if(draft){setSync('draft','Draft · nothing is saved');return}
  clearTimeout(cloudTimer);setSync('busy','Saving…');
  cloudTimer=setTimeout(pushCloud,700);
}

// ---------- paid tracking ----------
const DAY=86400000;
const cycleKey=()=>{const d=cycleStart();return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate()};
const isPaid=i=>i.paidCycle===cycleKey();
const isHiddenPaid=i=>isPaid(i)&&Date.now()-num(i.paidAt)>=DAY;
function markPaid(i){i.paidAt=Date.now();i.paidCycle=cycleKey();if(i.kind==='loan'){i.prevLeft=num(i.left);i.left=Math.max(0,num(i.left)-1)}
  if(i.bbRef)S.items.filter(y=>y.inBill===i.bbRef&&!isPaid(y)).forEach(markPaid)}
function undoPaid(i){if(i.kind==='loan'&&i.prevLeft!=null)i.left=i.prevLeft;delete i.paidAt;delete i.paidCycle;delete i.prevLeft
  if(i.bbRef)S.items.filter(y=>y.inBill===i.bbRef&&isPaid(y)).forEach(undoPaid)}
function rollover(){
  const key=cycleKey();let changed=false;
  S.items=S.items.filter(i=>{
    if(!i.paidCycle||i.paidCycle===key)return true;
    changed=true;delete i.paidAt;delete i.paidCycle;delete i.prevLeft;
    if(i.kind==='card')i.amount=null;
    return !(i.kind==='loan'&&num(i.left)<=0);
  });
  return changed;
}

// ---------- the numbers ----------
function compute(){
  const start=cycleStart(),next=shiftCycle(start,1);
  const end=new Date(next.getFullYear(),next.getMonth(),next.getDate()-1);
  const inc=S.income.filter(x=>num(x.amount)>0).map(x=>({x,d:parseD(x.date)})).filter(o=>o.d&&o.d>=start&&o.d<next);
  const other=inc.reduce((s,o)=>s+num(o.x.amount),0);
  const avail=num(S.salary)+other;
  const lines=S.items.filter(i=>!billed(i)&&num(i.amount)>0&&inCycle(i,start)).map(i=>{
    const tier=i.kind==='essential'||i.kind==='bill'?1:i.kind==='loan'?2:i.kind==='card'?3:5;
    return {i,tier,date:dueOf(i,start),need:num(i.amount)};
  }).sort((a,b)=>a.tier-b.tier||a.date-b.date);
  let left=avail;lines.forEach(l=>{l.got=Math.max(0,Math.min(l.need,left));left-=l.got});
  const required=lines.filter(l=>l.tier<=3).reduce((s,l)=>s+l.need,0);
  const total=lines.reduce((s,l)=>s+l.need,0);
  const paidAmt=lines.filter(l=>isPaid(l.i)).reduce((s,l)=>s+l.need,0);
  return {start,next,end,inc,other,avail,lines,required,total,paidAmt,gap:required-avail,surplus:avail-total};
}

// ---------- hero ----------
function renderStatus(C){
  const el=$('#status');
  const flow=`<div class="flow"><span>Money in <b>${peso(C.avail)}</b></span><span>Bills <b>${peso(C.total)}</b></span>${C.paidAmt>0?`<span>Paid so far <b>${peso(C.paidAmt)}</b></span>`:''}</div>`;
  if(C.gap>0.004){el.className='status bad';el.innerHTML=`<span class="label">Short this cycle</span><span class="big">${peso(C.gap)}</span>${flow}`}
  else{el.className='status ok';el.innerHTML=`<span class="label">${C.surplus>0.004?'Extra after all bills':'Everything is covered'}</span><span class="big">${peso(Math.max(0,C.surplus))}</span>${flow}`}
}

// ---------- this cycle ----------
const realRate=i=>num(i.rate)*(i.addon?1.65:1);
function renderAdvice(C){
  const box=$('#advice');
  if(C.gap>0.004){
    box.innerHTML=`<div class="reco bad"><h3>You're ${peso(C.gap)} short</h3><p class="small">Your money won't cover every bill this cycle.</p><div><button class="btn" data-goto="borrow">See options</button></div></div>`;
    return;
  }
  const buffer=Math.max(0,num(S.buffer)),extra=C.surplus-buffer;
  const bufInput=`<div class="bufrow"><label for="buffer">Buffer</label><span>₱</span><input id="buffer" type="number" min="0" step="100" value="${num(S.buffer)}"></div>`;
  if(C.surplus<=0.004){box.innerHTML='';return}
  if(extra<=0.004){
    box.innerHTML=`<div class="reco ok"><h3>All bills covered</h3><p class="small">${peso(C.surplus)} left, within your buffer.</p>${bufInput}</div>`;
    return;
  }
  // pay-ahead candidates: next cycle's installments (costliest first), then next cycle's fixed bills
  const recs=[];
  S.items.filter(i=>i.kind==='loan'&&!i.inCard&&!hasParts(i)&&num(i.amount)>0).forEach(i=>{
    const after=isPaid(i)?num(i.left):num(i.left)-1;
    if(after>0)recs.push({i,amt:num(i.amount),date:dueDate(dayOf(i),C.next),why:`next installment${i.rate!=null?` · ${num(i.rate)}%${i.addon?' add-on':''}/mo`:''}`,rank:realRate(i)});
  });
  recs.sort((a,b)=>b.rank-a.rank);
  S.items.filter(i=>(i.kind==='essential'||i.kind==='bill')&&num(i.amount)>0&&inCycle(i,C.next)).sort((a,b)=>dueOf(a,C.next)-dueOf(b,C.next))
    .forEach(i=>recs.push({i,amt:num(i.amount),date:dueOf(i,C.next),why:payFreq()==='month'?'next month':'next cycle',rank:0}));
  let pool=extra;const picks=[];
  recs.forEach(r=>{if(pool<=0.004)return;const p=Math.min(pool,r.amt);pool-=p;picks.push({...r,p})});
  box.innerHTML=`<div class="reco ok"><h3>You have ${peso(extra)} extra</h3>
    <p class="small">Pay these ahead to lighten next cycle.</p>
    <ul>${picks.map(r=>`<li><span>${esc(r.i.name)} <span class="muted small">· due ${fmtD(r.date)} · ${r.why}${r.p<r.amt-0.004?` · part of ${peso(r.amt)}`:''}</span></span><span class="a">${peso(r.p)}</span></li>`).join('')}
    ${pool>0.004?`<li><span>Emergency fund <span class="muted small">· nothing left to pay ahead</span></span><span class="a">${peso(pool)}</span></li>`:''}</ul>
    ${bufInput}
    <p class="note">Paying early frees next month; it doesn't cut interest.</p></div>`;
}
function renderTimeline(C){
  $('#cycleLabel').textContent=fmtD(C.start)+' – '+fmtD(C.end)+', '+C.end.getFullYear();
  const ev=[{d:C.start,in:true,name:'Salary',amt:num(S.salary)}];
  C.inc.forEach(o=>ev.push({d:o.d,in:true,name:o.x.label||'Other money',amt:num(o.x.amount)}));
  C.lines.forEach(l=>ev.push({d:l.date,in:false,l}));
  const days={};ev.forEach(e=>{const k=e.d.getTime();(days[k]=days[k]||[]).push(e)});
  let bal=0;
  $('#timeline').innerHTML=Object.keys(days).sort((a,b)=>a-b).map(k=>{
    const d=new Date(+k),es=days[k].sort((a,b)=>b.in-a.in);
    const rows=es.map(e=>{
      if(e.in){bal+=e.amt;return `<div class="ev in"><span class="nm">${esc(e.name)}</span><span class="r"><span class="a">+${peso(e.amt)}</span></span></div>`}
      bal-=e.l.need;const paid=isPaid(e.l.i);
      const pill=paid?'<span class="pill ok">Paid</span>':e.l.got>=e.l.need-0.004?'':e.l.got<0.005?'<span class="pill bad">No funds</span>':`<span class="pill warn">Short ${peso(e.l.need-e.l.got)}</span>`;
      return `<div class="ev${paid?' paid':''}" data-c="${esc(catOf(e.l.i)?.color||'slate')}"><span class="nm"><span class="vh">${esc(catOf(e.l.i)?.name||'')}: </span>${esc(e.l.i.name)}</span><span class="r">${pill}<span class="a">−${peso(e.l.need)}</span></span></div>`;
    }).join('');
    return `<div class="day"><div class="d">${fmtD(d)}<small>${WD[d.getDay()]}</small></div><div>${rows}<div class="bal${bal<0?' neg':''}"><span>${bal<0?'Not enough on hand':'On hand after'}</span><span class="num">${peso(bal)}</span></div></div></div>`;
  }).join('')||'<p class="empty">Nothing scheduled.</p>';
}

// ---------- bills ----------
let editingId=null;
// A day of the month (due day, statement day) is picked on a calendar: the field shows the next date it
// falls on, and picking any date keeps its day. dayFrom() reads it back.
function dayField(id,k,label,date,hint){
  return `<div class="field"><label for="${id}">${label}</label><input id="${id}" data-k="${k}" data-day="1" type="date" value="${date?iso(date):''}">${hint?`<span class="hint">${hint}</span>`:''}</div>`;
}
const dayFrom=el=>{const d=parseD(el.value);return d?d.getDate():null};
const catOptions=sel=>S.cats.map(c=>`<option value="${esc(c.key)}" ${c.key===sel?'selected':''}>${esc(c.name)}</option>`).join('');
function itemForm(i,isNew){
  return `<div class="form flat" data-id="${i.id}">
    <div class="field wide"><label for="n${i.id}">Name</label><input id="n${i.id}" data-k="name" placeholder="${i.kind==='loan'?'e.g. Home Credit':'e.g. Meralco'}" value="${esc(i.name)}"></div>
    <div class="field wide"><label for="k${i.id}">Category</label><select id="k${i.id}" data-k="cat">${catOptions(catOf(i)?.key)}</select></div>
    <div class="field"><label for="a${i.id}">${i.kind==='card'?'Statement amount':repeats(i)&&i.once?'Amount':'Monthly amount'}</label><input id="a${i.id}" data-k="amount" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" value="${i.amount??''}"></div>
    ${repeats(i)&&i.once?`<div class="field"><label for="dt${i.id}">Due date</label><input id="dt${i.id}" data-k="date" type="date" value="${esc(i.date||'')}"></div>`
      :dayField('d'+i.id,'day',i.bbDue?'Due date':'Next due date',i.day||i.bbDue?dueOf(i,cycleStart()):null,i.bbDue?'':'Same day every month.')}
    ${repeats(i)?`<label class="check wide"><input type="checkbox" id="rp${i.id}" data-k="repeat" ${i.once?'':'checked'}><span>Repeats every month</span></label>
    ${i.once?'':`<div class="field wide"><label for="u${i.id}">Stops after</label><input id="u${i.id}" data-k="until" type="month" placeholder="YYYY-MM" pattern="[0-9]{4}-[0-9]{2}" value="${esc(i.until||'')}" aria-describedby="uh${i.id}"><span class="hint" id="uh${i.id}">Leave empty if it never stops.</span></div>`}`:''}
    ${i.kind==='loan'?`<div class="field wide"><label for="lend${i.id}">Lender</label><input id="lend${i.id}" data-k="lender" list="lenders" autocomplete="off" placeholder="${esc(lenderName(i))}" value="${esc(i.lender||'')}"><datalist id="lenders">${[...new Set(S.items.filter(x=>x.kind==='loan'&&x!==i).map(lenderName))].map(n=>`<option value="${esc(n)}">`).join('')}</datalist><span class="hint">Installments from the same lender are grouped.</span></div>`:''}
    ${i.kind==='loan'?`<div class="field"><label for="l${i.id}">Payments left</label><input id="l${i.id}" data-k="left" type="number" inputmode="numeric" min="0" value="${i.left??''}"></div><div class="field"><label for="t${i.id}">Total payments</label><input id="t${i.id}" data-k="total" type="number" inputmode="numeric" min="0" value="${i.total??''}"></div>`:''}
    ${i.kind==='card'||i.kind==='loan'?`<div class="field"><label for="f4${i.id}">Last 4 digits</label><input id="f4${i.id}" data-k="last4" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="1234" autocomplete="off" value="${esc(last4Of(i))}"><span class="hint">Matches BillBuddy bills.</span></div>`:''}
    ${i.kind==='card'||i.kind==='loan'?`<div class="field"><label for="r${i.id}">Interest %/month</label><input id="r${i.id}" data-k="rate" type="number" inputmode="decimal" step="0.01" min="0" value="${i.rate??''}"></div>`:''}
    <div class="acts">${isNew?'<span></span>':delBtn(`data-del="${i.id}"`,"Remove "+(i.name||"this bill"))}<button class="btn" data-done="1">${isNew?'Add':'Done'}</button></div>
  </div>`;
}
function itemRow(i,start){
  const amt=num(i.amount),paid=isPaid(i),meta=[`<span>Due ${fmtD(dueOf(i,start))}</span>`];
  if(repeats(i)&&i.once&&!i.bbDue)meta.push('<span>One-time</span>');
  else if(repeats(i)&&untilYm(i.until)){const u=untilYm(i.until);meta.push(`<span>Until ${MON[u%100-1]} ${Math.floor(u/100)}</span>`)}
  if(i.kind==='loan'&&num(i.left))meta.push(`<span>${num(i.left)} left</span>`);
  if(i.kind!=='card'&&i.bbLast4)meta.push(`<span>•••• ${esc(i.bbLast4)}</span>`);
  if(i.kind==='card'){const a=acctOf(i);if(a&&a.last4)meta.push(`<span>•••• ${esc(a.last4)}</span>`)}
  if(paid)meta.unshift(`<span class="t-ok">Paid · clears in ${Math.max(1,Math.ceil((DAY-(Date.now()-num(i.paidAt)))/3600000))}h</span>`);
  return `<div class="bill${paid?' done':''}"><div><div class="nm">${esc(i.name||'Untitled bill')}</div><div class="mt">${meta.join('')}</div></div>
    <div class="rt">${amt>0?`<span class="amt">${peso(amt)}</span>`:'<span class="pill warn">Add amount</span>'}
    <div class="bt">${paid?undoBtn(`data-unpaid="${i.id}"`,i.name):`${editBtn(`data-edit="${i.id}"`,i.name||"bill")}${amt>0?paidBtn(`data-paid="${i.id}"`,i.name):''}`}</div></div></div>`;
}
function renderItems(){
  ensureCats();
  const start=cycleStart();
  // installments billed with a card are part of its statement, so the Bills tab doesn't list them twice
  const hidden=S.items.filter(i=>!billed(i)&&isHiddenPaid(i)),vis=S.items.filter(i=>!billed(i)&&!isHiddenPaid(i)&&inCycle(i,start));
  const done=S.items.filter(i=>!billed(i)&&ended(i,start));
  const later=S.items.filter(i=>repeats(i)&&i.once&&!i.bbDue&&exactDue(i)>=shiftCycle(start,1)).sort((a,b)=>exactDue(a)-exactDue(b));
  const html=S.cats.map(c=>{
    const its=vis.filter(i=>i.cat===c.key);if(!its.length)return '';
    its.sort((a,b)=>(isPaid(a)-isPaid(b))||dueOf(a,start)-dueOf(b,start));
    const due=its.filter(i=>!isPaid(i)).reduce((s,i)=>s+num(i.amount),0);
    return `<div class="grp" data-c="${esc(c.color)}"><div class="grp-h"><h3>${esc(c.name)}<span>${its.length}</span></h3><span class="sub">${peso(due)}</span></div>${its.map(i=>itemRow(i,start)).join('')}</div>`;
  }).join('');
  const left=vis.filter(i=>!isPaid(i)).reduce((s,i)=>s+num(i.amount),0);
  $('#itemList').innerHTML=(html||'<p class="empty">Nothing left to pay this cycle.</p>')+
    `<div class="tot"><span>Still to pay</span><span>${peso(left)}</span></div>`+
    (hidden.length?`<details class="paidlist"><summary>Paid this cycle (${hidden.length})</summary><ul>${hidden.map(i=>`<li><span>${esc(i.name)}</span><span class="num">${peso(num(i.amount))}</span></li>`).join('')}</ul></details>`:'')+
    (later.length?`<details class="paidlist"><summary>Coming in a later cycle (${later.length})</summary><div class="later">${later.map(i=>
      `<div class="laterrow"><span>${esc(i.name||'Untitled bill')} <span class="muted">· ${fmtD(exactDue(i))}, ${exactDue(i).getFullYear()}</span></span><span class="num">${peso(num(i.amount))}</span>${editBtn(`data-edit="${i.id}"`,i.name||"bill")}</div>`).join('')}</div></details>`:'')+
    (done.length?`<details class="paidlist"><summary>Ended (${done.length})</summary><div class="later">${done.map(i=>
      `<div class="laterrow"><span>${esc(i.name||'Untitled bill')} <span class="muted">· ${i.once?'was due '+fmtD(exactDue(i)):'stopped after '+MON[untilYm(i.until)%100-1]+' '+Math.floor(untilYm(i.until)/100)}</span></span><span class="num">${peso(num(i.amount))}</span>${editBtn(`data-edit="${i.id}"`,i.name||"bill")}</div>`).join('')}</div></details>`:'');
}

// ---------- categories window ----------
// One button opens a small window listing the categories; pick one to edit it, or add a new one.
let catEditing=null,catDeleting=false;
function renderCats(){
  const box=$('#catBody'),c=S.cats.find(x=>x.key===catEditing);
  if(!c){
    $('#catTitle').textContent='Categories';
    box.innerHTML=`<ul class="catlist">${S.cats.map(x=>{const n=S.items.filter(i=>i.cat===x.key).length;
      return `<li data-c="${esc(x.color)}"><button class="catrow" data-catedit="${esc(x.key)}" aria-label="Edit ${esc(x.name)}, ${n} bill${n===1?'':'s'}"><span class="dot"></span><span class="nm">${esc(x.name)}</span><span class="muted small">${n} bill${n===1?'':'s'}</span><span class="go">${IC.chev}</span></button></li>`}).join('')}</ul>
      <div class="dlg-acts"><button class="ghost" data-catnew="1">+ New category</button><button class="btn" data-catclose="1">Done</button></div>`;
    return;
  }
  const n=S.items.filter(i=>i.cat===c.key).length,others=S.cats.filter(x=>x!==c);
  $('#catTitle').textContent=c.name.trim()?'Edit category':'New category';
  box.innerHTML=`<div class="catform" data-cat="${esc(c.key)}">
    <div class="field"><label for="cn">Name</label><input id="cn" data-ck="name" value="${esc(c.name)}" placeholder="e.g. Subscriptions"></div>
    <div class="field"><span id="ccl">Color</span><div class="swatches" role="group" aria-labelledby="ccl">${COLORS.map(k=>`<button class="sw" data-c="${k}" data-sw="${k}" aria-pressed="${k===c.color}" aria-label="${k[0].toUpperCase()+k.slice(1)}"></button>`).join('')}</div></div>
    <div class="field"><label for="ck">Counts as</label><select id="ck" data-ck="kind">${KIND_OPTS.map(([k,v])=>`<option value="${k}" ${k===c.kind?'selected':''}>${v}</option>`).join('')}</select></div>
    ${catDeleting?`<div class="confirm"><label for="cm">Move its ${n} bill${n===1?'':'s'} to</label><select id="cm">${others.map(x=>`<option value="${esc(x.key)}">${esc(x.name)}</option>`).join('')}</select><div class="row"><button class="btn danger-btn" data-catdelyes="1">Move and delete</button><button class="ghost" data-catdelno="1">Cancel</button></div></div>`
      :`<div class="dlg-acts">${others.length?`${delBtn('data-catdel="1"',"Delete category "+c.name)}`:'<span></span>'}<button class="btn" data-catdone="1">Done</button></div>`}
  </div>`;
}
function openCats(){catEditing=null;catDeleting=false;renderCats();$('#catDlg').showModal()}
function closeCatEdit(){const c=S.cats.find(x=>x.key===catEditing);if(c&&!c.name.trim()){c.name='Untitled';save()}catEditing=null;catDeleting=false;renderItems();render();renderCats()}

// ---------- installments ----------
// Installments are grouped by lender: "UnionBank Loan A" and "UnionBank Loan B" sit under UnionBank Loan as
// Installment 1 and 2. The lender is the Lender field if set (BillBuddy fills it with the bank), otherwise the
// name without a trailing letter or number.
// A plan that is part of another bill's amount: on a card's statement (inCard), or one of several loans on one
// loan statement (inBill, the bill's BillBuddy key). Bills and This cycle show only that bill; the Installments
// tab and the cycle-by-cycle maths count the plans instead, each with its own payments left.
const billed=i=>!!(i.inCard||i.inBill);
const hasParts=i=>!!(i.bbRef&&S.items.some(y=>y.inBill===i.bbRef));
const partOf=i=>i.inBill&&S.items.find(y=>y.bbRef===i.inBill&&!y.inBill);
// An installment the way BillBuddy shows a statement: 3/12 is the payment this bill makes (the 3rd of 12), or the
// one just paid; a plan whose months the statement cut off shows its payment number alone ("6/?").
function planOf(i){
  const total=Math.round(num(i.total)),left=Math.max(0,Math.round(num(i.left)));
  if(total)return Math.min(total,Math.max(1,total-left+(isPaid(i)?0:1)))+'/'+total;
  return i.bbTerm?i.bbTerm+'/?':'';
}
// the statement's name without the payment count it repeats ("(03/12)", "005 OF 006"): the row shows it as 3/12
const planLabel=i=>{const t=String(i.name||'');return planOf(i)?t.replace(/\s*[(\[]?\s*\d{1,3}\s*(?:\/|\bof\b)\s*\d{1,3}\s*[)\]]?/gi,' ').replace(/\s{2,}/g,' ').trim()||t:t};
const lenderName=i=>partOf(i)?lenderName(partOf(i)):i.inCard?(S.accounts.find(a=>a.key===i.inCard)?.name||'Card')+' installments':String(i.lender||'').trim()||String(i.name||'').replace(/\s+(?:[A-Za-z]|#?\d+|\([^)]*\))$/,'').trim()||'Installment';
const lenderKey=i=>lenderName(i).toLowerCase().replace(/[^a-z0-9]/g,'').replace(/loans?$/,'')||'x';
function renderInst(){
  const start=cycleStart(),endOf=i=>{const left=Math.max(0,Math.round(num(i.left)));if(!left)return null;
    const n=dueDate(dayOf(i),start),m=new Date(n.getFullYear(),n.getMonth()+(isPaid(i)?left:left-1),1);return new Date(m.getFullYear(),m.getMonth(),Math.min(dayOf(i),dim(m.getFullYear(),m.getMonth())))};
  const ym=d=>d?MON[d.getMonth()]+' '+d.getFullYear():'—';
  const groups=new Map();
  S.items.filter(i=>i.kind==='loan'&&!hasParts(i)).sort((a,b)=>dayOf(a)-dayOf(b)||num(b.left)-num(a.left)||String(a.name).localeCompare(b.name)).forEach(i=>{const k=lenderKey(i);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(i)});
  let monthly=0,remaining=0,last=null;
  const html=[...groups.values()].map(list=>{
    let gm=0,gr=0,gl=null;
    const rows=list.map((i,n)=>{
      const left=Math.max(0,Math.round(num(i.left))),pay=num(i.amount),total=Math.round(num(i.total))||null,end=endOf(i);
      if(left>0){gm+=pay;gr+=pay*left;if(!gl||end>gl)gl=end}
      const pct=total?Math.round(Math.max(0,total-left)/total*100):null;
      const of=planOf(i);
      const nm=billed(i)||i.bbInst||(i.name&&i.name!==lenderName(i))?planLabel(i):'Installment '+(n+1);
      return `<div class="sub">
        <div class="sub-h"><span class="sub-n">${of?`<span class="plan-of" aria-label="payment ${of.replace('/',' of ')}">${of}</span>`:''}${esc(nm)}${last4Of(i)?`<span class="l4">•••• ${esc(last4Of(i))}</span>`:''}</span><span class="pay">${peso(pay)}<span class="muted small">/mo</span></span></div>
        ${pct!=null?`<div class="bar" role="img" aria-label="${total-left} of ${total} paid"><i style="width:${pct}%"></i></div>`:''}
        <div class="sub-f"><div class="facts">${total?`<span><b>${peso(pay*left)}</b> to go</span><span>Last payment <b>${ym(end)}</b></span>`:i.bbTerm?'<span>Months not on the statement</span>':`<span><b>${left}</b> left</span><span><b>${peso(pay*left)}</b> to go</span><span>Last payment <b>${ym(end)}</b></span>`}</div>
        <div class="acts">${billed(i)?'':`${isPaid(i)?`<span class="pill ok">Paid</span>${!isHiddenPaid(i)?undoBtn(`data-iundo="${i.id}"`,i.name):''}`:''}${last4Of(i)?'':`<button class="pill warn ask4" data-iedit4="${i.id}">Add last 4</button>`}${editBtn(`data-iedit="${i.id}"`,i.name)}${left>0&&!isPaid(i)?paidBtn(`data-ipaid="${i.id}"`,i.name):''}`}${billed(i)?editBtn(`data-iedit="${i.id}"`,i.name):''}</div></div>
      </div>`;
    }).join('');
    monthly+=gm;remaining+=gr;if(gl&&(!last||gl>last))last=gl;
    const r=list[0];
    return `<div class="lgrp"><div class="lgrp-h"><h3>${esc(lenderName(r))}</h3>
      <span class="muted small"><b>${peso(gm)}</b>/mo · <b>${peso(gr)}</b> to go · until ${ym(gl)}${list.length>1?' · '+list.length+' installments':''}${r.inCard?' · billed with the card':r.inBill?' · one bill':''}</span></div>${rows}</div>`;
  }).join('');
  $('#instSum').innerHTML=`<div><span class="label">Per month</span><span class="v">${peso(monthly)}</span></div><div><span class="label">Still to pay</span><span class="v">${peso(remaining)}</span></div><div><span class="label">All done by</span><span class="v">${ym(last)}</span></div>`;
  $('#instList').innerHTML=html||'<p class="empty">No installments yet.</p>';
}

// ---------- other money ----------
function incTag(x){
  const C0=cycleStart(),n1=shiftCycle(C0,1),n2=shiftCycle(C0,2),d=parseD(x.date);
  if(!d)return {t:'Pick the date it arrives',c:''};
  if(d<C0)return {t:'Earlier cycle · not counted',c:''};
  if(d<n1)return {t:'Counts this cycle · arrives '+fmtD(d),c:'now'};
  if(d<n2)return {t:'Counts next cycle ('+fmtD(n1)+' – '+fmtD(new Date(n2.getFullYear(),n2.getMonth(),n2.getDate()-1))+')',c:''};
  return {t:'Counts in a later cycle · '+fmtD(d)+', '+d.getFullYear(),c:''};
}
function renderIncSum(){
  const C0=cycleStart(),n1=shiftCycle(C0,1);
  let now=0,later=0;S.income.forEach(x=>{const d=parseD(x.date);if(!d||d<C0)return;if(d<n1)now+=num(x.amount);else later+=num(x.amount)});
  $('#incSum').innerHTML=`<div><span class="label">This cycle</span><span class="v">${peso(now)}</span></div><div><span class="label">Coming later</span><span class="v">${peso(later)}</span></div>`;
}
function renderIncome(){
  S.income.sort((a,b)=>String(a.date||'9').localeCompare(String(b.date||'9')));
  $('#incList').innerHTML=S.income.map(x=>{const t=incTag(x);return `<div class="inc" data-iid="${x.id}">
    <input data-k="label" aria-label="What is it" placeholder="What is it?" value="${esc(x.label||'')}">
    <input data-k="amount" aria-label="Amount" type="number" inputmode="decimal" step="0.01" min="0" placeholder="₱0.00" value="${x.amount??''}">
    <input data-k="date" aria-label="Date it arrives" type="date" value="${esc(x.date||'')}">
    <button class="x" data-incdel="${x.id}" aria-label="Remove ${esc(x.label||'this money')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    <span class="tag ${t.c}" id="tag${x.id}">${t.t}</span></div>`}).join('')||'<p class="empty">No other money yet. Add one below.</p>';
  renderIncSum();
}

// ---------- borrowing ----------
function pmt(B,r,n){return r<=0?B/n:B*r/(1-Math.pow(1+r,-n))}
function payFor(s,B,n){const r=num(s.rate)/100;return s.addon?B*(1+r*n)/n:pmt(B,r,n)}
function effRate(s,nOver){
  const r=num(s.rate)/100,f=Math.min(0.99,num(s.fee)/100),n=nOver||Math.max(1,Math.round(num(s.term)||1));
  if(f<=0&&!s.addon)return r;
  const P=payFor(s,1,n),N=1-f;let lo=0,hi=1;
  for(let k=0;k<80;k++){const m=(lo+hi)/2;const pv=m===0?P*n:P*(1-Math.pow(1+m,-n))/m;if(pv>N)lo=m;else hi=m}
  return (lo+hi)/2;
}
const altTerms=s=>String(s.terms||'').split(/[^0-9]+/).map(x=>parseInt(x,10)).filter(x=>x>0);
const known=s=>!(s.rate===null||s.rate===''||s.rate===undefined);
// an installment's remaining monthly payment dates (the one already paid this cycle included)
function loanDates(l){
  const d0=dueDate(dayOf(l),cycleStart()),n=Math.max(0,Math.round(num(l.left)))+(isPaid(l)?1:0),out=[];
  for(let k=0;k<Math.min(n,60);k++){const f=new Date(d0.getFullYear(),d0.getMonth()+k,1);out.push(new Date(f.getFullYear(),f.getMonth(),Math.min(dayOf(l),dim(f.getFullYear(),f.getMonth()))))}
  return out;
}
const loansIn=(start,skipPaid)=>{const end=shiftCycle(start,1);return S.items.filter(l=>l.kind==='loan'&&!l.inCard&&!hasParts(l)&&num(l.amount)>0&&!(skipPaid&&isPaid(l)&&inCycle(l,start))).reduce((s,l)=>s+num(l.amount)*loanDates(l).filter(d=>d>=start&&d<end).length,0)};
const fixedIn=start=>S.items.filter(i=>(i.kind==='essential'||i.kind==='bill')&&inCycle(i,start)).reduce((s,i)=>s+num(i.amount),0);
let needOverride=null;
function quote(s,need){
  const f=Math.min(0.99,num(s.fee)/100),n=Math.max(1,Math.round(num(s.term)||1)),avail=num(s.avail);
  let B=need/(1-f),capped=false;if(avail>0&&B>avail){B=avail;capped=true}
  const net=B*(1-f),k=known(s),p=k?payFor(s,B,n):null;
  return {s,B,net,n,p,capped,known:k,limitSet:avail>0,e:k?effRate(s):null,cost:p===null?null:cents(p)*n-net};
}
function renderBorrow(C){
  $('#shortHead').innerHTML=C.gap>0.004
    ?`<h2>Cover ${peso(C.gap)}</h2><p class="muted small" style="margin-top:4px">Cheapest first.</p>`
    :`<h2>You're not short</h2><p class="muted small" style="margin-top:4px">Every bill is covered.</p>`;
  const need=needOverride!==null?needOverride:Math.max(0,C.gap);
  const list=$('#credList'),box=$('#srcPick');
  if(need<=0.004){list.innerHTML='';box.innerHTML='';return}
  if(!S.sources.length){box.innerHTML='';list.innerHTML='<p class="empty">No creditors yet. Open Edit creditors to add one.</p>';return}
  const qs=S.sources.map(s=>quote(s,need)).sort((a,b)=>(a.known?0:1)-(b.known?0:1)||(a.e??0)-(b.e??0)||(b.net-a.net));
  const pct=x=>(x*100).toFixed(2)+'%';
  list.innerHTML=qs.map((q,k)=>{
    if(!q.known)return `<div class="cred"><span class="rank">?</span><div><b>${esc(q.s.name)}</b><div class="meta">Add its interest rate in Edit creditors to see the cost.</div></div><div class="right"><span class="pill warn">No rate</span></div></div>`;
    const bad=q.e>0.03,best=k===0&&!bad;
    const alts=altTerms(q.s).filter(t=>t!==q.n);
    return `<div class="cred"><span class="rank">${k+1}</span><div><b>${esc(q.s.name)}</b>
      <div class="meta"><span>Borrow <b>${peso(q.B)}</b></span>${q.B-q.net>0.004?`<span>Receive <b>${peso(q.net)}</b></span>`:''}<span>${q.n===1?`Repay <b>${peso(q.p)}</b> next month`:`<b>${peso(q.p)}</b> × ${q.n} mo`}</span><span>${pct(q.e)}/mo real cost</span></div>
      ${q.capped?`<div class="meta" style="color:var(--bad)">Limit covers only ${peso(q.net)}.</div>`:''}
      ${alts.length?`<div class="meta">${alts.map(t=>{const p=payFor(q.s,q.B,t);return `${t} mo: <b>${peso(p)}</b>/mo, cost <b>${peso(cents(p)*t-q.net)}</b>`}).join(' · ')}</div>`:''}
    </div><div class="right"><span class="cost">${peso(q.cost)}<small>interest + fees</small></span><span class="pill ${best?'ok':bad?'bad':'warn'}">${best?'Cheapest':bad?'Expensive':'Okay'}</span></div></div>`;
  }).join('');
  let rem=need;const parts=[];
  qs.filter(q=>q.known).forEach(q=>{
    if(rem<=0.004)return;
    const f=Math.min(0.99,num(q.s.fee)/100),avail=num(q.s.avail);
    const net=avail>0?Math.min(rem,avail*(1-f)):rem,B=net/(1-f),p=payFor(q.s,B,q.n);
    parts.push({q,B,p,net,total:cents(p)*q.n});rem-=net;
  });
  if(!parts.length){box.innerHTML='';return}
  // everything you pay back: every payment, so principal, interest and fees together
  const total=parts.reduce((s,x)=>s+x.total,0),cost=total-parts.reduce((s,x)=>s+x.net,0);
  box.innerHTML=`<div class="reco ok"><h3>Best option</h3><ul>${parts.map(x=>`<li><span>${esc(x.q.s.name)} · borrow ${peso(x.B)}</span><span class="a">${x.q.n===1?'repay '+peso(x.p):peso(x.p)+' × '+x.q.n}</span></li>`).join('')}</ul>
    <p class="small">Costs <b class="num">${peso(cost)}</b> in interest and fees.</p>
    <p class="reco-total num">${peso(total)}</p>
    ${rem>0.004?`<p class="small" style="color:var(--bad)">Still ${peso(rem)} short after every creditor.</p>`:''}</div>`;
}
function srcFields(s){return `

    <div class="field wide"><label for="sn${s.id}">Creditor</label><input id="sn${s.id}" data-k="name" placeholder="e.g. SSS Salary Loan" value="${esc(s.name)}"></div>
    <div class="field"><label for="sa${s.id}">Available (₱)</label><input id="sa${s.id}" data-k="avail" type="number" min="0" step="0.01" value="${s.avail??''}"></div>
    <div class="field"><label for="sr${s.id}">Interest %/mo</label><input id="sr${s.id}" data-k="rate" type="number" min="0" step="0.01" value="${s.rate??''}"></div>
    <div class="field"><label for="sy${s.id}">Rate type</label><select id="sy${s.id}" data-k="addon"><option value="0" ${s.addon?'':'selected'}>Diminishing</option><option value="1" ${s.addon?'selected':''}>Add-on</option></select></div>
    <div class="field"><label for="sf${s.id}">Upfront fee %</label><input id="sf${s.id}" data-k="fee" type="number" min="0" step="0.01" value="${s.fee??''}"></div>
    <div class="field"><label for="st${s.id}">Term (months)</label><input id="st${s.id}" data-k="term" type="number" min="1" value="${s.term??''}"></div>
    <div class="field"><label for="sx${s.id}">Other terms</label><input id="sx${s.id}" data-k="terms" placeholder="3,6,12" value="${esc(s.terms||'')}"></div>`}
function renderSrcList(){
  $('#srcList').innerHTML=S.sources.map(s=>`<div class="form" data-sid="${s.id}">${srcFields(s)}
    <div class="acts">${delBtn(`data-sdel="${s.id}"`,"Remove "+(s.name||"creditor"))}</div></div>`).join('');
}

// ---------- plan ahead ----------
function renderAhead(C){
  const salary=num(S.salary);
  const loans=S.items.filter(i=>i.kind==='loan'&&!i.inCard&&!hasParts(i)&&num(i.amount)>0);
  // one row per pay cycle, until a cycle after the last installment
  const last=Math.max(0,...loans.flatMap(l=>loanDates(l)).map(Number));let n=1;
  while(n<36&&shiftCycle(C.start,n-1)<=last)n++;
  const monthly=payFreq()==='month';
  const scale=Math.max(salary,fixedIn(C.start)+loans.reduce((s,l)=>s+num(l.amount),0))||1;
  let rows='';
  for(let m=0;m<n;m++){
    const d=shiftCycle(C.start,m),fixed=fixedIn(d);
    const ln=loansIn(d);
    const free=Math.max(0,salary-ln-fixed),w=v=>(v/scale*100).toFixed(2)+'%';
    rows+=`<div class="mrow"><span>${monthly?MON[d.getMonth()]+' '+String(d.getFullYear()).slice(2):fmtD(d)}</span><div class="track" role="img" aria-label="Installments ${peso(ln)}, rent and bills ${peso(fixed)}, free ${peso(free)}"><div class="seg loan" style="width:${w(ln)}"></div><div class="seg fixed" style="width:${w(fixed)}"></div><div class="seg free" style="width:${w(free)}"></div></div><span class="num" style="text-align:right">${peso(free)}</span></div>`;
  }
  $('#monthList').innerHTML=loans.length?rows:'<p class="empty">No installments listed.</p>';
}

// ---------- accounts ----------
function nextOn(day){
  const t=new Date();t.setHours(0,0,0,0);let y=t.getFullYear(),m=t.getMonth();
  let d=new Date(y,m,Math.min(day,dim(y,m)));if(d<t){m++;d=new Date(new Date(y,m,1).getFullYear(),new Date(y,m,1).getMonth(),Math.min(day,dim(new Date(y,m,1).getFullYear(),new Date(y,m,1).getMonth())))}
  return d;
}
const usedOf=a=>{const b=billOf(a);return b&&b.kind==='card'&&!isPaid(b)?num(b.amount):0};
const ucls=p=>p>50?'bad':p>30?'warn':'';
function acctForm(a,isNew){
  const b=billOf(a);
  return `<div class="form flat" data-aid="${a.id}">
    <div class="field wide"><label for="an${a.id}">Card name</label><input id="an${a.id}" data-k="name" placeholder="e.g. BPI Gold" value="${esc(a.name)}"></div>
    <div class="field"><label for="a4${a.id}">Last 4 digits</label><input id="a4${a.id}" data-k="last4" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="1234" autocomplete="off" value="${esc(a.last4||'')}"><span class="hint">Matches BillBuddy bills.</span></div>
    <div class="field"><label for="al${a.id}">Credit limit (₱)</label><input id="al${a.id}" data-k="limit" type="number" min="0" step="0.01" value="${a.limit??''}"></div>
    ${dayField('as'+a.id,'stmt','Next statement',a.stmt?nextOn(num(a.stmt)):null)}
    ${dayField('ad'+a.id,'due','Next payment due',b&&(b.day||b.bbDue)?dueOf(b,cycleStart()):null)}
    <div class="acts">${isNew?'<span></span>':delBtn(`data-adel="${a.id}"`,"Remove "+(a.name||"card"))}<button class="btn" data-adone="1">${isNew?'Add':'Done'}</button></div>
  </div>`;
}
// The installments inside a card's statement, as BillBuddy lists them: each plan, what they come to, the total
function cardPlans(a,bill){
  const plans=S.items.filter(i=>i.inCard===a.key).sort((x,y)=>String(planOf(x)).localeCompare(planOf(y),undefined,{numeric:true}));
  if(!plans.length)return '';
  const sum=plans.reduce((t,i)=>t+num(i.amount),0),total=num(bill&&bill.amount);
  return `<div class="cplans">${plans.map(i=>`<div class="cplan"><span class="plan-of">${planOf(i)||'—'}</span><span class="cplan-n">${esc(planLabel(i))}</span><span class="num">${peso(num(i.amount))}</span></div>`).join('')}
    <div class="cplan foot"><span>Installments this period</span><span class="num">${peso(sum)}</span></div>
    ${total?`<div class="cplan foot"><span>Rest of the bill</span><span class="num">${peso(Math.max(0,total-sum))}</span></div><div class="cplan tot"><span>Statement total</span><span class="num">${peso(total)}</span></div>`:''}</div>`;
}
function renderAccounts(){
  let lim=0,used=0;
  const html=S.accounts.map(a=>{
    const L=num(a.limit),U=usedOf(a),p=L>0?U/L*100:null;
    if(L>0){lim+=L;used+=U}
    const bill=billOf(a);
    const facts=[];
    if(a.stmt)facts.push(`<span>Statement <b>${fmtD(nextOn(num(a.stmt)))}</b></span>`);
    if(bill)facts.push(`<span>Due <b>${fmtD(dueOf(bill,cycleStart()))}</b></span>`);
    facts.push(`<span>Using <b>${peso(U)}</b>${L>0?` of ${peso(L)}`:''}</span>`);
    if(L>0)facts.push(`<span>Available <b>${peso(Math.max(0,L-U))}</b></span>`);
    return `<div class="acct" data-k="card">
      <div class="acct-h"><h3>${esc(a.name)}${a.last4?`<span class="l4">•••• ${esc(a.last4)}</span>`:`<button class="pill warn ask4" data-aedit4="${a.id}">Add last 4</button>`}</h3>
        <span class="lim">${L>0?peso(L):'—'}<small>credit limit</small></span></div>
      ${p!==null?`<div class="ubar" role="img" aria-label="${p.toFixed(0)}% of limit used"><i class="${ucls(p)}" style="width:${Math.min(100,p).toFixed(1)}%"></i></div>`:''}
      <div class="facts">${p!==null?`<span><b>${p.toFixed(0)}%</b> used</span>`:''}${facts.join('')}</div>
      ${cardPlans(a,bill)}
      <div class="acts">${editBtn(`data-aedit="${a.id}"`,a.name)}</div>
    </div>`;
  }).join('');
  $('#acctList').innerHTML=html||'<p class="empty">No cards yet.</p>';
  const p=lim>0?used/lim*100:null;
  $('#acctSum').innerHTML=`<div><span class="label">Total limit</span><span class="v">${peso(lim)}</span></div><div><span class="label">Total used</span><span class="v">${peso(used)}</span></div><div><span class="label">Overall usage</span><span class="v" style="color:${p===null?'inherit':p>50?'var(--bad)':p>30?'var(--warn)':'var(--ok)'}">${p===null?'—':p.toFixed(0)+'%'}</span></div>`;
}

// ---------- render ----------
// Only the open tab is redrawn as you type; the others are marked and redrawn when you open them.
const JOBS={
  cycle:C=>{renderAdvice(C);renderTimeline(C)}, inst:()=>renderInst(), borrow:C=>renderBorrow(C), ahead:C=>renderAhead(C),
  acct:()=>renderAccounts(), bills:()=>renderItems(), money:()=>renderIncome(), src:()=>renderSrcList(), ai:()=>fillAISrc()
};
const JOB_PANEL={src:'borrow'};
const stale=new Set();
const shown=job=>!$('#panel-'+(JOB_PANEL[job]||job)).hidden;
function runJobs(jobs,C){jobs.forEach(j=>{if(shown(j)){stale.delete(j);JOBS[j](C||compute());paintMon(JOB_PANEL[j]||j)}else stale.add(j)})}
function render(){const C=compute();renderStatus(C);runJobs(['cycle','inst','borrow','ahead','acct'],C)}
function renderAll(){runJobs(['bills','money','src','ai']);render()}
function flushStale(){if(!stale.size)return;const C=compute();[...stale].forEach(j=>{if(shown(j)){stale.delete(j);JOBS[j](C);paintMon(JOB_PANEL[j]||j)}})}
window.addEventListener('beforeprint',()=>{const C=compute();Object.keys(JOBS).forEach(j=>JOBS[j](C));stale.clear()});
const commit=()=>{save();render()};

// ---------- events ----------
['salary','payday','payday2','payweekday'].forEach(k=>{$('#'+k).addEventListener('input',e=>{S[k]=e.target.value===''?(k==='salary'?0:null):num(e.target.value);save();if(k==='salary')render();else renderAll()})});
$('#payfreq').addEventListener('change',e=>{
  const was=payFreq();S.payfreq=e.target.value;
  // monthly and twice-a-month share the payday box: each keeps its own day, so switching back restores it
  if(was==='month')S.paydayMonth=S.payday;
  if(was==='twice')S.paydayTwice=S.payday;
  if(S.payfreq==='month'&&S.paydayMonth!=null)S.payday=S.paydayMonth;
  if(S.payfreq==='twice'){S.payday=S.paydayTwice??15;if(!num(S.payday2))S.payday2=30} // the usual cutoffs, to change as needed
  if(S.payfreq==='week'&&S.payweekday==null)S.payweekday=5;
  save();syncInputs();renderAll();
});
function syncInputs(){
  ['salary','payday','payday2','payweekday'].forEach(k=>{const el=$('#'+k);if(document.activeElement!==el)el.value=S[k]??''});
  const f=payFreq();$('#payfreq').value=f;
  $('#pdDays').hidden=f==='week';$('#pd2').hidden=f!=='twice';$('#pdWeek').hidden=f!=='week';
  $('#salLabel').textContent=f==='month'?'Salary this cycle':'Salary each payday';
}
document.addEventListener('input',e=>{if(e.target.id==='buffer'){S.buffer=num(e.target.value);save();const C=compute();renderStatus(C);
  const pos=e.target.selectionStart;renderAdvice(C);const b=$('#buffer');if(b){b.focus();try{b.setSelectionRange(pos,pos)}catch(_){}}}});
document.addEventListener('click',e=>{const g=e.target.closest('[data-goto]');if(g)selectTab(g.dataset.goto)});

$('#billBody').addEventListener('input',e=>{
  const row=e.target.closest('.form');if(!row)return;const it=S.items.find(i=>i.id==row.dataset.id),k=e.target.dataset.k;if(!it||!k)return;
  if(k==='cat'){const c=S.cats.find(x=>x.key===e.target.value);if(!c)return;it.cat=c.key;setKind(it,c.kind);ensureLinks();commit();refreshBill();const f=$('#k'+it.id);f&&f.focus();return}
  if(k==='repeat'){
    if(e.target.checked){delete it.once;const d=parseD(it.date);if(d){it.day=d.getDate();delete it.date}}
    else{it.once=true;it.date=it.date||iso(dueOf(it,cycleStart()));delete it.until}
    commit();refreshBill();const f=$('#rp'+it.id);f&&f.focus();return}
  if(k==='last4'){const v=e.target.value.replace(/\D/g,'').slice(0,4);if(v!==e.target.value)e.target.value=v;
    const a=it.kind==='card'&&acctOf(it);if(a)a.last4=v;else if(v)it.bbLast4=v;else delete it.bbLast4;commit();renderAccounts();return}
  if(e.target.dataset.day){it.day=dayFrom(e.target);delete it.bbDue;commit();return}
  if(k==='until'||k==='date'){if(e.target.value)it[k]=e.target.value;else delete it[k];commit();return}
  if(k==='lender'){const v=e.target.value.trim();if(v)it.lender=v;else delete it.lender;commit();return}
  it[k]=k==='name'?e.target.value:(e.target.value===''?null:num(e.target.value));
  if(k==='name'){const a=acctOf(it);if(a)a.name=it.name;const f=$('#lend'+it.id);if(f)f.placeholder=lenderName(it)}
  if(k==='day')delete it.bbDue;
  commit();
});
// moving a bill into a category of another kind makes it that kind of bill
function setKind(it,kind){
  if(it.kind===kind)return;
  if(kind==='loan'||kind==='card'){if(it.once){const d=parseD(it.date);if(d)it.day=d.getDate()}delete it.once;delete it.date;delete it.until}
  if(it.kind==='card'&&kind!=='card'){delete it.acct;it.noAcct=true}
  if(kind==='card')delete it.noAcct;
  if(kind==='loan'){if(it.left===undefined)it.left=null;if(it.total===undefined)it.total=null}
  it.kind=kind;
}
$('#itemList').addEventListener('click',e=>{
  const t=e.target.closest('button');if(!t)return;
  if(t.dataset.edit){openBill(+t.dataset.edit);return}
  const id=t.dataset.paid||t.dataset.unpaid;if(!id)return;const it=S.items.find(i=>i.id==id);if(!it)return;
  t.dataset.paid?markPaid(it):undoPaid(it);save();renderItems();render();
});
function deleteCat(c,to){
  if(to){S.items.forEach(i=>{if(i.cat===c.key){i.cat=to.key;setKind(i,to.kind)}})}
  S.cats=S.cats.filter(x=>x!==c);catEditing=null;catDeleting=false;ensureLinks();save();renderAll();renderCats();
}
document.addEventListener('click',e=>{const t=e.target;if(t.matches?.('input[type=date],input[type=month]')&&t.showPicker){try{t.showPicker()}catch(_){}}});
// ---------- the bill window ----------
// Adding or editing a bill opens a small window. Edits save as you type. A new bill is kept only
// when you tap Add; closing the window any other way (×, Esc, tapping outside) leaves it out.
let billNew=false,billKeep=false;
function refreshBill(){const it=S.items.find(i=>i.id===editingId);if(!it)return;
  $('#billTitle').textContent=billNew?(it.kind==='loan'?'New installment':'New bill'):'Edit '+(it.kind==='loan'?'installment':'bill');
  $('#billBody').innerHTML=itemForm(it,billNew)}
function openBill(id,isNew){
  editingId=id;billNew=!!isNew;billKeep=false;refreshBill();
  const d=$('#billDlg');if(!d.open)d.showModal();
  const f=isNew?$('#n'+id):$('#a'+id);f&&(f.focus(),isNew&&f.select());
}
$('#billDlg').addEventListener('close',()=>{
  const it=S.items.find(i=>i.id===editingId);
  if(it&&billNew&&!billKeep)S.items=S.items.filter(i=>i!==it);           // closed without Add
  else if(it&&!String(it.name||'').trim())it.name=it.kind==='loan'?'New installment':'New bill';
  editingId=null;billNew=false;$('#billBody').innerHTML='';ensureLinks();save();renderAll();
});
$('#billDlg').addEventListener('click',e=>{
  if(e.target===e.currentTarget){e.currentTarget.close();return} // tap outside the window
  const t=e.target.closest('button');if(!t)return;
  if(t.dataset.billclose){$('#billDlg').close();return}
  if(t.dataset.done){billKeep=true;$('#billDlg').close();return}
  if(t.dataset.del){const g=S.items.find(i=>i.id==t.dataset.del);S.items=S.items.filter(i=>i!==g&&!(g&&g.bbRef&&i.inBill===g.bbRef));  // with the loans listed on it
    billKeep=true;$('#billDlg').close()}
});
function newBill(kind){
  const c=S.cats.find(x=>x.kind===kind)||S.cats.find(x=>x.kind==='bill')||S.cats[0];
  const it={id:uid++,name:'',kind:c.kind,cat:c.key,amount:null,day:clampPd()};
  if(c.kind==='loan')Object.assign(it,{left:null,total:null,rate:null});
  S.items.push(it);ensureLinks();openBill(it.id,true);
}
$('#addBtn').addEventListener('click',()=>newBill('bill'));
$('#catBtn').addEventListener('click',openCats);
$('#catDlg').addEventListener('close',()=>{closeCatEdit()});
$('#catDlg').addEventListener('click',e=>{
  if(e.target===e.currentTarget){e.currentTarget.close();return} // tap outside the window
  const t=e.target.closest('button');if(!t)return;
  const c=S.cats.find(x=>x.key===catEditing);
  if(t.dataset.catclose){$('#catDlg').close();return}
  if(t.dataset.catedit){catEditing=t.dataset.catedit;catDeleting=false;renderCats();$('#cn').focus();return}
  if(t.dataset.catnew){const used=new Set(S.cats.map(x=>x.color)),n={key:genKey(),name:'',color:COLORS.find(k=>!used.has(k))||'slate',kind:'bill'};
    S.cats.push(n);catEditing=n.key;catDeleting=false;save();renderCats();$('#cn').focus();return}
  if(!c)return;
  if(t.dataset.sw){c.color=t.dataset.sw;save();renderItems();render();renderCats();const b=$(`#catBody [data-sw="${c.color}"]`);b&&b.focus();return}
  if(t.dataset.catdone){closeCatEdit();return}
  if(t.dataset.catdel){if(S.items.some(i=>i.cat===c.key)){catDeleting=true;renderCats();$('#cm').focus()}else deleteCat(c,null);return}
  if(t.dataset.catdelno){catDeleting=false;renderCats();return}
  if(t.dataset.catdelyes){deleteCat(c,S.cats.find(x=>x.key===$('#cm').value));return}
});
$('#catDlg').addEventListener('input',e=>{
  const c=S.cats.find(x=>x.key===catEditing),k=e.target.dataset.ck;if(!c||!k)return;
  if(k==='name'){c.name=e.target.value;save();renderItems();return}
  if(k==='kind'){c.kind=e.target.value;S.items.forEach(i=>{if(i.cat===c.key)setKind(i,c.kind)});ensureLinks();commit();renderItems()}
});


const openEdit=id=>openBill(id);
$('#instList').addEventListener('click',e=>{
  const t=e.target.closest('button');if(!t)return;
  const id=t.dataset.ipaid||t.dataset.iundo||t.dataset.iedit||t.dataset.iedit4,it=S.items.find(i=>i.id==id);if(!it)return;
  if(t.dataset.iedit){openEdit(it.id);return}
  if(t.dataset.iedit4){openEdit(it.id);const f=$('#f4'+it.id);f&&f.focus();return}
  t.dataset.ipaid?markPaid(it):undoPaid(it);save();renderItems();render();
});
$('#instAdd').addEventListener('click',()=>newBill('loan'));

$('#incList').addEventListener('input',e=>{
  const row=e.target.closest('.inc');if(!row)return;const x=S.income.find(o=>o.id==row.dataset.iid),k=e.target.dataset.k;if(!x||!k)return;
  x[k]=k==='amount'?(e.target.value===''?null:num(e.target.value)):e.target.value;
  const t=incTag(x),tag=$('#tag'+x.id);if(tag){tag.textContent=t.t;tag.className='tag '+t.c}
  renderIncSum();commit();
});
$('#incList').addEventListener('click',e=>{const id=e.target.closest('button')?.dataset.incdel;if(!id)return;S.income=S.income.filter(o=>o.id!=id);save();renderIncome();render()});
$('#incAdd').addEventListener('click',()=>{const x={id:uid++,label:'',amount:null,date:iso(new Date())};S.income.push(x);openSheet('inc',x,true,'#il'+x.id)});

function srcInput(e){
  const row=e.target.closest('.form');if(!row)return;const s=S.sources.find(x=>x.id==row.dataset.sid),k=e.target.dataset.k;if(!s||!k)return;
  s[k]=k==='name'||k==='terms'?e.target.value:k==='addon'?e.target.value==='1':(e.target.value===''?null:num(e.target.value));commit();
}
$('#srcList').addEventListener('input',srcInput);
$('#srcList').addEventListener('click',e=>{const id=e.target.closest('button')?.dataset.sdel;if(!id)return;S.sources=S.sources.filter(s=>s.id!=id);save();renderSrcList();render()});
$('#srcAdd').addEventListener('click',()=>{const s={id:uid++,name:'',avail:null,rate:null,fee:0,term:12};S.sources.push(s);openSheet('src',s,true,'#sn'+s.id)});

$('#resetBtn').addEventListener('click',()=>{$('#resetConfirm').hidden=false});
$('#resetNo').addEventListener('click',()=>{$('#resetConfirm').hidden=true});
$('#resetYes').addEventListener('click',()=>{const bb=S.bb;S=clone(DEFAULTS);if(bb)S.bb=bb;prepare();editingId=null;save();syncInputs();$('#resetConfirm').hidden=true;renderAll()});
function acctInput(e){
  const row=e.target.closest('.form');if(!row)return;const a=S.accounts.find(x=>x.id==row.dataset.aid),k=e.target.dataset.k;if(!a||!k)return;
  if(k==='last4'){const v=e.target.value.replace(/\D/g,'').slice(0,4);if(v!==e.target.value)e.target.value=v;a.last4=v}
  else if(k==='due'){const b=billOf(a);if(b){b.day=dayFrom(e.target);delete b.bbDue}}
  else if(k==='stmt')a.stmt=dayFrom(e.target)
  else{a[k]=k==='name'?e.target.value:(e.target.value===''?null:num(e.target.value));if(k==='name'){const b=billOf(a);if(b)b.name=a.name}}
  commit();
}
$('#acctList').addEventListener('click',e=>{
  const t=e.target.closest('button');if(!t)return;
  const a=S.accounts.find(x=>x.id==(t.dataset.aedit||t.dataset.aedit4));if(!a)return;
  openSheet('acct',a,false,t.dataset.aedit4?'#a4'+a.id:'#al'+a.id);
});
// ---------- one window for cards, other money and creditors ----------
// Works like the bill window: edits save as you type, and a new entry is kept only when you tap Add.
let sheet=null;
const SHEET={
  acct:{title:n=>n?'New card':'Edit card',body:(o,n)=>acctForm(o,n),list:()=>S.accounts,
    drop:o=>{S.items=S.items.filter(i=>i.acct!==o.key);S.accounts=S.accounts.filter(x=>x!==o)},
    tidy:o=>{if(!o.name.trim()){o.name='New card';const b=billOf(o);if(b)b.name=o.name}}},
  inc:{title:n=>'Add money',body:(o)=>`<div class="form flat" data-iid="${o.id}">
      <div class="field wide"><label for="il${o.id}">What is it</label><input id="il${o.id}" data-k="label" placeholder="e.g. Freelance job" value="${esc(o.label||'')}"></div>
      <div class="field"><label for="ia${o.id}">Amount (₱)</label><input id="ia${o.id}" data-k="amount" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" value="${o.amount??''}"></div>
      <div class="field"><label for="id${o.id}">Arrives on</label><input id="id${o.id}" data-k="date" type="date" value="${esc(o.date||'')}"></div>
      <div class="acts"><span></span><button class="btn" data-sheetdone="1">Add</button></div></div>`,
    list:()=>S.income,drop:o=>{S.income=S.income.filter(x=>x!==o)},tidy:o=>{if(!o.label.trim())o.label='Other money'}},
  src:{title:n=>'New creditor',body:(o)=>`<div class="form flat" data-sid="${o.id}">${srcFields(o)}<div class="acts"><span></span><button class="btn" data-sheetdone="1">Add</button></div></div>`,
    list:()=>S.sources,drop:o=>{S.sources=S.sources.filter(x=>x!==o)},tidy:o=>{if(!o.name.trim())o.name='Creditor'}}
};
function openSheet(type,obj,isNew,focus){
  sheet={type,obj,isNew,keep:false};
  $('#sheetTitle').textContent=SHEET[type].title(isNew);$('#sheetBody').innerHTML=SHEET[type].body(obj,isNew);
  const d=$('#sheetDlg');if(!d.open)d.showModal();const f=focus&&$(focus);f&&f.focus();
}
$('#sheetBody').addEventListener('input',e=>{
  if(!sheet)return;
  if(sheet.type==='acct')return acctInput(e);
  if(sheet.type==='src')return srcInput(e);
  const x=sheet.obj,k=e.target.dataset.k;if(!k)return;
  x[k]=k==='amount'?(e.target.value===''?null:num(e.target.value)):e.target.value;commit();
});
$('#sheetDlg').addEventListener('click',e=>{
  if(e.target===e.currentTarget){e.currentTarget.close();return}
  const t=e.target.closest('button');if(!t||!sheet)return;
  if(t.dataset.sheetclose){$('#sheetDlg').close();return}
  if(t.dataset.sheetdone||t.dataset.adone){sheet.keep=true;$('#sheetDlg').close();return}
  if(t.dataset.adel){const a=sheet.obj,b=billOf(a);if(b){delete b.acct;b.noAcct=true}S.accounts=S.accounts.filter(x=>x!==a);sheet.keep=true;$('#sheetDlg').close()}
});
$('#sheetDlg').addEventListener('close',()=>{
  if(!sheet)return;const T=SHEET[sheet.type],o=sheet.obj;
  if(sheet.isNew&&!sheet.keep)T.drop(o);else if(T.list().includes(o))T.tidy(o);
  sheet=null;$('#sheetBody').innerHTML='';ensureLinks();save();renderAll();
});
$('#acctAdd').addEventListener('click',()=>{const a={id:uid++,key:genKey(),name:'',last4:'',limit:null,stmt:null};S.accounts.push(a);S.items.push({id:uid++,name:'',kind:'card',amount:null,day:clampPd(),acct:a.key});ensureLinks();openSheet('acct',a,true,'#an'+a.id)});
function selectTab(name){
  document.querySelectorAll('.tab').forEach(x=>{const on=x.dataset.tab===name;x.setAttribute('aria-selected',on);x.tabIndex=on?0:-1;
    if(on&&x.parentElement.scrollWidth>x.parentElement.clientWidth)x.parentElement.scrollTo({left:x.offsetLeft-x.parentElement.clientWidth/2+x.offsetWidth/2,behavior:'smooth'})});
  document.querySelectorAll('[data-panel]').forEach(p=>p.hidden=p.dataset.panel!==name);
  flushStale();
  // when the tab bar is stuck to the top, bring the new panel's start into view
  const bar=$('.tabs'),top=bar.getBoundingClientRect().top;
  if(top<=parseFloat(getComputedStyle(bar).top)+1)bar.parentElement.scrollIntoView({block:'start'});
}
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>selectTab(t.dataset.tab)));
$('.tabs').addEventListener('keydown',e=>{
  const tabs=[...document.querySelectorAll('.tab')],i=tabs.indexOf(document.activeElement);if(i<0)return;
  const j={ArrowRight:i+1,ArrowLeft:i-1,Home:0,End:tabs.length-1}[e.key];if(j==null)return;
  e.preventDefault();const t=tabs[(j+tabs.length)%tabs.length];t.focus();selectTab(t.dataset.tab);
});

// ---------- boot ----------
function adopt(next){
  if(!next||!Array.isArray(next.items)||next.ver!==DEFAULTS.ver)return;
  S=next;prepare();rollover();editingId=null;syncInputs();renderAll();fillBB();fillAI();
}
prepare();rollover();syncInputs();renderAll();
// ---------- BillBuddy ----------
// Card bills come from BillBuddy: each one fills the matching credit card's
// statement amount and due day here. Matched by bank name ("RCBC" -> "RCBC CC").
// The link and key are saved with the planner in your Supabase account.
const bbConf=()=>S.bb||{};
function fillBB(){const c=bbConf();$('#bbUrl').value=c.url||'';$('#bbKey').value=c.key||'';if(!c.url)bbState('off','Not connected')}
const squash=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const bbState=(cls,txt)=>{const el=$('#bbState');el.className='sync '+cls;el.textContent=txt};
let bbBusy=false,bbAgain=false;
// BillBuddy's bill type -> the planner's. Newer feeds send `type` (credit_card, loan, utility, insurance,
// other) next to a finer `category` (personal_loan, electricity…); feeds with neither are credit cards.
const BB_KIND={credit_card:'card',loan:'loan',utility:'bill',insurance:'bill'};
const bbTyped=b=>!!(b.type||b.product_type||b.category);
function bbKind(b){
  if(!bbTyped(b))return 'card';
  const t=BB_KIND[b.type]||BB_KIND[b.product_type]||BB_KIND[b.category];if(t)return t;
  const c=String(b.category||b.product_type||'').toLowerCase();
  return /credit_?card/.test(c)?'card':/loan|credit_line|bnpl/.test(c)?'loan':'bill';
}
const BB_SUFFIX={card:' CC',loan:' Loan',bill:''};
const near=(a,b)=>Math.abs(num(a)-num(b))<0.01;
// drop a bill's card account unless you filled something in on it
function unlinkAcct(it){const a=acctOf(it);delete it.acct;if(a&&!num(a.limit)&&!num(a.stmt)&&!a.last4&&!S.items.some(x=>x.acct===a.key))S.accounts=S.accounts.filter(x=>x!==a)}
function removeItem(it){S.items=S.items.filter(x=>x!==it);unlinkAcct(it)}
function refile(it,kind,bank){
  if(it.kind==='card'&&kind!=='card')unlinkAcct(it);
  it.kind=kind;it.name=bank+BB_SUFFIX[kind];it.rate=kind==='card'?3:null;
  if(kind==='loan'){if(it.left===undefined)it.left=null;if(it.total===undefined)it.total=null}
}
async function syncBillBuddy(){
  if(!cloudReady)return;
  const {url,key}=bbConf();
  if(!url||!key){bbState('off','Not connected');return}
  if(bbBusy){bbAgain=true;return}bbBusy=true;
  let bills;
  try{
    const r=await fetch(url,{headers:{Authorization:'Bearer '+key},cache:'no-store'});
    if(r.status===401){bbState('off','Wrong API key');return}
    const j=await r.json();if(!j.ok)throw new Error(j.error||'BillBuddy returned an error');bills=j.bills||[];
  }catch(e){console.warn('BillBuddy sync failed',e);bbState('off','Could not reach BillBuddy. Check the link.');return}
  finally{bbBusy=false;if(bbAgain){bbAgain=false;setTimeout(syncBillBuddy,0)}}
  bbLast=bills;applyBB(bills);
}
let bbLast=[];
function applyBB(bills){
  let changed=false;const claimed=new Set();
  bills.forEach(b=>{
    const bank=squash(b.bank),due=parseD(b.due_date),amt=num(b.amount);
    if(!bank||!due||!(amt>0))return;
    const kind=bbKind(b),l4=String(b.last4||'').replace(/\D/g,'').slice(-4),key=b.account_key||null;
    const ofBank=i=>squash(i.name).includes(bank),free=i=>!billed(i)&&!i.bbInst&&!claimed.has(i)&&(!i.bbKey||i.bbKey===key);
    // same account as last time, then same last 4 digits (same type first, then any), then same bank and type
    // (several loans at one bank: the one with this amount, then this due day)
    let it=(key&&S.items.find(i=>i.bbKey===key&&!claimed.has(i)))
      ||(l4&&S.items.find(i=>i.kind===kind&&free(i)&&last4Of(i)===l4))
      ||(l4&&S.items.find(i=>free(i)&&last4Of(i)===l4))
      ||(()=>{const c=S.items.filter(i=>i.kind===kind&&free(i)&&ofBank(i)&&!(l4&&last4Of(i)));
        return c.find(i=>near(i.amount,amt))||c.find(i=>num(i.day)===due.getDate())||(c.length===1?c[0]:null)})();
    // an earlier sync filed this statement under the wrong type (a loan as "UnionBank CC"): fix or drop that copy
    const wrong=S.items.filter(i=>i!==it&&!billed(i)&&i.kind!==kind&&!claimed.has(i)&&i.bbDue===b.due_date&&near(i.amount,amt)&&ofBank(i));
    if(wrong.length){changed=true;if(!it){it=wrong.shift();refile(it,kind,b.bank)}wrong.forEach(removeItem)}
    // the last 4 digits decide which card it is: a card in Accounts with these digits and no bill
    // (its bill was removed, or an older sync gave the card a second account) gets this bill back,
    // under the name you gave the card
    const mine=kind==='card'&&l4?S.accounts.find(a=>a.last4===l4&&!S.items.some(i=>i.acct===a.key)):null;
    if(mine&&it&&it.kind==='card'){
      const dup=acctOf(it);it.acct=mine.key;it.name=mine.name;delete it.noAcct;changed=true;
      if(dup&&!num(dup.limit)&&!num(dup.stmt)&&!S.items.some(i=>i.acct===dup.key))S.accounts=S.accounts.filter(x=>x!==dup);
    }else if(mine&&!it){
      it={id:uid++,name:mine.name,kind,amount:null,day:null,rate:3,acct:mine.key};
      S.items.push(it);ensureLinks();changed=true;
    }
    if(!it){
      it={id:uid++,name:b.bank+BB_SUFFIX[kind],kind,amount:null,day:null,rate:kind==='card'?3:null};
      if(kind==='loan')it.lender=b.bank+' Loan';
      if(kind==='loan')Object.assign(it,{left:null,total:null});
      S.items.push(it);ensureLinks();changed=true;
    }
    claimed.add(it);
    if(key&&it.bbKey!==key){it.bbKey=key;changed=true}
    // the card's last 4 digits go on its account; other bills keep them on the bill
    if(l4){const a=it.kind==='card'&&acctOf(it);
      if(a){if(a.last4!==l4){a.last4=l4;changed=true}}else if(it.bbLast4!==l4){it.bbLast4=l4;changed=true}}
    // everything else the statement says: card limit and statement day, installment breakdown
    if(adoptBB(it,b,due))changed=true;
    // a bill BillBuddy couldn't type ("other") is sorted by the AI once, if one is set up
    const unsure=bbTyped(b)&&!BB_KIND[b.type]&&!BB_KIND[b.product_type]&&!BB_KIND[b.category]&&!/credit_?card|loan|credit_line|bnpl/i.test(String(b.category||b.product_type||''));
    if(unsure&&!it.bbAi&&!it.bbUnsure){it.bbUnsure=true;changed=true}
    // remember the statement you marked paid, so it is not brought back after payday
    if(isPaid(it)){if(it.bbDue&&it.bbPaidDue!==it.bbDue){it.bbPaidDue=it.bbDue;changed=true}return}
    if(it.bbPaidDue===b.due_date)return;
    if(num(it.amount)===amt&&num(it.day)===due.getDate()&&it.bbDue===b.due_date)return;
    it.amount=amt;it.day=due.getDate();it.bbDue=b.due_date;changed=true;
  });
  // copies an older sync made before bill types were sent (e.g. a loan saved as "UnionBank CC"), even from an
  // earlier statement: filled in by BillBuddy, not matched this time, and the same amount as a bill of
  // another type from that bank
  if(bills.some(bbTyped))S.items.filter(i=>!billed(i)&&!claimed.has(i)&&i.bbDue&&!i.bbKey).forEach(i=>{
    if(bills.some(b=>bbTyped(b)&&bbKind(b)!==i.kind&&squash(i.name).includes(squash(b.bank))&&near(i.amount,b.amount))){removeItem(i);changed=true}
  });
  if(changed){ensureLinks();save();if(editingId==null)renderItems();render()}
  aiSortBills();aiPlacePlans();
  const t=new Date();
  const np=bills.reduce((s,b)=>s+bbPlans(b).length,0),fed=bills.some(b=>bbList(b));
  bbState('ok',`Synced ${bills.length} bill${bills.length===1?'':'s'}${np?`, ${np} installment${np===1?'':'s'}`:''} at ${t.getHours()%12||12}:${String(t.getMinutes()).padStart(2,'0')} ${t.getHours()<12?'AM':'PM'}`
    +(bills.length&&!fed?'. BillBuddy sent no installment details: update its /api/bills.':''));
}
// What a BillBuddy bill brings besides its amount and due date. A card fills in its account's credit limit and
// statement day when those are empty, and the installment plans its statement lists become installments
// filed under the card (part of the card's bill, so they never count twice); several loans on one loan
// statement become an installment each under that bill. A plan that is an installment
// you already entered yourself is moved under the card instead of added again (see planHome). A loan's
// breakdown sets its payments left and total. Returns true when anything changed.
// BillBuddy sends each plan as payment `term` of `of` for `amount` (newer feeds repeat these as paid_count,
// term_count, monthly_amount and description); a plan whose term the statement cut off is skipped.
const bbList=b=>{let l=b.installments;if(typeof l==='string')try{l=JSON.parse(l)}catch(e){l=null}return Array.isArray(l)?l:null};
// `total` is 0 when the statement cut the term off (EastWest's "006 OF 01"): a card still lists it, by payment number
const bbPlans=b=>(bbList(b)||[]).map(x=>({desc:String(x.description||x.label||'Installment'),
  paid:Math.round(num(x.paid_count??x.term)),total:Math.round(num(x.term_count??x.of)),amt:Math.round(num(x.monthly_amount??x.amount)*100)/100}))
  .filter(x=>x.amt>0&&x.paid>=1&&(!x.total||x.total>=2&&x.paid<=x.total));
const planName=x=>x.desc.toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
// payments left counting this statement's, unless it is already paid
const planLeft=(x,paidNow)=>Math.max(0,x.total-x.paid+(paidNow?0:1));
function adoptBB(it,b,due){
  let ch=false;const set=(o,k,v)=>{if(v!=null&&o[k]!==v){o[k]=v;ch=true}};
  let plans=bbPlans(b);
  const paidNow=isPaid(it)||it.bbPaidDue===b.due_date; // this statement is already paid
  if(it.kind==='card'){
    const a=acctOf(it);if(!a)return ch;
    if(!(num(a.limit)>0)&&num(b.credit_limit)>0)set(a,'limit',num(b.credit_limit));
    const sd=parseD(b.statement_date);if(!a.stmt&&sd)set(a,'stmt',sd.getDate());
    if(!bbList(b))return ch;                        // an older feed: leave the card's installments alone
    const seen=new Set();
    plans.forEach(x=>{
      const k=a.key+'|'+squash(x.desc)+'|'+x.total;
      seen.add(k);
      let i=S.items.find(y=>y.bbInst===k);
      if(!i){const home=planHome(k,x,b,null);if(home==='wait')return;   // the AI is being asked where it goes
        if(home){i=home;i.bbInst=k}
        else{i={id:uid++,name:planName(x),kind:'loan',inCard:a.key,bbInst:k,amount:null,day:due.getDate(),left:null,total:null,rate:null};S.items.push(i)}
        ch=true}
      set(i,'inCard',a.key);set(i,'amount',x.amt);set(i,'day',due.getDate());
      if(x.total){set(i,'total',x.total);set(i,'left',planLeft(x,paidNow));if(i.bbTerm){delete i.bbTerm;ch=true}}else set(i,'bbTerm',x.paid);
    });
    // a plan the newest statement no longer lists after its last payment is finished
    const before=S.items.length;
    S.items=S.items.filter(i=>!(i.inCard===a.key&&i.bbInst&&!seen.has(i.bbInst)&&num(i.left)<=1));
    if(S.items.length!==before)ch=true;
  }else if(it.kind==='loan'&&(plans=plans.filter(x=>x.total)).length&&(plans.length>1||hasParts(it))){
    // several loans on one statement (UnionBank's two personal loans): each is its own installment under this
    // bill, or the one you entered yourself (see planHome); the bill stays one bill in Bills and This cycle
    // the bill's own key for its installments: BillBuddy's account key when it sent one, else one of ours
    if(!it.bbRef){it.bbRef=it.bbKey||genKey();ch=true}
    const seen=new Set();let most=0,longest=0;
    plans.forEach(x=>{
      const k='L'+it.bbRef+'|'+squash(x.desc)+'|'+x.total;
      seen.add(k);
      let i=S.items.find(y=>y.bbInst===k);
      if(!i){const home=planHome(k,x,b,null);if(home==='wait')return;
        if(home){i=home;i.bbInst=k}
        else{i={id:uid++,name:planName(x),kind:'loan',inBill:it.bbRef,bbInst:k,amount:null,day:due.getDate(),left:null,total:null,rate:null};S.items.push(i)}
        ch=true}
      const left=planLeft(x,paidNow);most=Math.max(most,left);longest=Math.max(longest,x.total);
      set(i,'inBill',it.bbRef);set(i,'amount',x.amt);set(i,'day',due.getDate());set(i,'total',x.total);set(i,'left',left);
    });
    const before=S.items.length;
    S.items=S.items.filter(i=>!(i.inBill===it.bbRef&&i.bbInst&&!seen.has(i.bbInst)&&num(i.left)<=1));
    if(S.items.length!==before)ch=true;
    if(most)set(it,'left',most);if(longest)set(it,'total',longest);
  }else if(it.kind==='loan'&&plans.length){
    const x=plans.length===1?plans[0]:plans.find(y=>near(y.amt,b.amount)||near(y.amt,it.amount));
    if(x){set(it,'total',x.total);set(it,'left',planLeft(x,paidNow))}
  }
  return ch;
}
// Where a plan on a statement belongs. Usually it's new (null: under the card, or the loan itself). But you may
// have entered that purchase or loan yourself, and then adding it again would count it twice. Installments
// you entered that could be it (a word of its name or bank in common, or about the same monthly amount):
// none, it's new; exactly one with the same amount to the centavo, it's that one; otherwise the AI decides,
// once per plan, all plans in one small request ('wait' until it answers). Without AI it's new.
const PLAN_STOP=new Set(['installment','instalment','instl','inst','loan','loans','personal','payment','amortization','bank','card','credit','plan','the','and','for']);
const planWords=t=>String(t||'').toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>=3&&!/^\d+$/.test(w)&&!PLAN_STOP.has(w));
const placeQ=[],placeBusy=new Set(),placeTried=new Set();
function planCands(x,b,extra){
  const ws=new Set([...planWords(x.desc),...planWords(b.bank)]);
  return S.items.filter(y=>y.kind==='loan'&&!billed(y)&&!y.bbInst&&(y===extra||!y.bbKey)
    &&(Math.abs(num(y.amount)-x.amt)<=Math.max(1,x.amt*0.03)||planWords(y.name+' '+(y.lender||'')).some(w=>ws.has(w))));
}
function planHome(k,x,b,extra){
  if(S.bbHome&&S.bbHome[k])return null;
  if(placeBusy.has(k))return 'wait';
  const c=planCands(x,b,extra);if(!c.length)return null;
  const exact=c.filter(y=>near(y.amount,x.amt));if(exact.length===1)return exact[0];
  if(S.aiSortOff||!aiReady()||placeTried.has(k))return null;
  if(!placeQ.some(q=>q.k===k))placeQ.push({k,x,c,on:b.bank+' '+String(b.category||b.type||'').replace(/_/g,' ')+(b.last4?' ••••'+b.last4:'')});
  return 'wait';
}
async function aiPlacePlans(){
  const q=placeQ.splice(0);if(!q.length)return;
  q.forEach(p=>placeBusy.add(p.k));
  const cands=[...new Set(q.flatMap(p=>p.c))],r2=v=>Math.round(num(v)*100)/100;
  const user='Statement plans:\n'+JSON.stringify(q.map((p,n)=>({plan:'p'+n,statement:p.on,description:p.x.desc,monthly:p.x.amt,payment:p.x.paid+' of '+p.x.total,could_be:p.c.map(y=>'i'+y.id)})))
    +'\nInstallments in the planner:\n'+JSON.stringify(cands.map(y=>({id:'i'+y.id,name:y.name,lender:lenderName(y),monthly:r2(y.amount),payments_left:y.left??null,total_payments:y.total??null})));
  let r=null;
  try{r=await aiAsk({name:'plan_place',purpose:'place',light:true,system:PLACE_SYSTEM,schema:PLACE_SCHEMA,check:checkPlace,priority:'low',out:60+40*q.length,user})}
  catch(e){console.warn('AI placing skipped:',e.kind||e.message)}
  q.forEach(p=>{placeBusy.delete(p.k);placeTried.add(p.k)});
  if(!r)return applyBB(bbLast);                // no answer: each plan is placed as new
  q.forEach((p,n)=>{const home=(r.a.find(x=>x.plan==='p'+n)||{}).home,y=p.c.find(c=>'i'+c.id===home);
    if(y&&!y.bbInst&&!S.items.some(z=>z.bbInst===p.k))y.bbInst=p.k;else S.bbHome={...(S.bbHome||{}),[p.k]:'new'}});
  save();applyBB(bbLast);
}
const PLACE_SYSTEM=`A credit card or loan statement from a bank in the Philippines lists installment plans that are part of its total.
For each plan, decide if it is one of the installments the user already entered in their planner: the same purchase or loan, so a similar name or lender, about the same monthly amount, and payments left that fit.
home: that installment's id, only from the plan's could_be list and never the same id for two plans; or "new" when it is none of them or you are unsure.
Return every plan you were given, once.`;
const PLACE_SCHEMA={type:'object',additionalProperties:false,required:['placed'],properties:{placed:{type:'array',items:{type:'object',additionalProperties:false,required:['plan','home'],
  properties:{plan:{type:'string'},home:{type:'string'}}}}}};
const checkPlace=a=>a&&Array.isArray(a.placed)?a.placed.filter(x=>x&&typeof x.plan==='string'&&typeof x.home==='string'):null;
// The one place the AI helps with BillBuddy: a bill it couldn't type ("other") is sorted into the right kind.
// Only new unclear bills are sent, all in one small request, each at most once; it keeps to the daily budget.
const aiSortTried=new Set();
// Billers whose kind is plain from the name are sorted here for free; only names this list doesn't know reach the AI.
const KNOWN_KIND=[
  ['bill',/\b(meralco|maynilad|manila ?water|prime ?water|veco|davao light|pldt|globe|smart|converge|dito|sky ?(cable|fiber)|cignal|sss|philhealth|pag-?ibig|gsis|bir|insurance|insular|maxicare|intellicare|medicard|sun ?life|axa|pru ?life|manulife|fwd|electric|water district)\b/],
  ['flex',/\b(netflix|spotify|youtube|disney|hbo( max)?|viu|iwant|prime video|amazon prime|apple (music|one|tv)|icloud|google (one|play)|canva|chatgpt|openai|claude|adobe|microsoft 365|xbox|playstation|steam|patreon|gym|fitness|subscription|membership)\b/],
  ['essential',/\b(rent|lease|condo|apartment|dorm|grocer(y|ies)|tuition|school|daycare)\b/],
  ['loan',/\b(loan|home credit|billease|cashalo|atome|ggives|gloan|spaylater|tala|juanhand|digido|aeon|lending|financing)\b/]
];
const knownKind=name=>{const t=String(name||'').toLowerCase();const k=KNOWN_KIND.find(([,re])=>re.test(t));return k?k[0]:null};
async function aiSortBills(){
  let changed=false;
  S.items.filter(i=>i.bbUnsure&&!i.bbAi).forEach(it=>{const kind=knownKind(it.name);if(!kind)return;
    it.bbAi=kind;delete it.bbUnsure;if(it.kind!==kind){setKind(it,kind);delete it.cat}changed=true});
  if(changed){ensureLinks();save();if(editingId==null)renderItems();render()}
  if(S.aiSortOff||!aiReady())return;
  const todo=S.items.filter(i=>i.bbUnsure&&!i.bbAi&&i.bbKey&&!aiSortTried.has(i.bbKey));
  if(!todo.length)return;
  todo.forEach(i=>aiSortTried.add(i.bbKey));
  const user='Sort these bills:\n'+JSON.stringify(todo.map(i=>({key:i.bbKey,name:i.name,amount:Math.round(num(i.amount)*100)/100})));
  try{
    const r=await aiAsk({name:'bill_sort',purpose:'sort',light:true,system:SORT_SYSTEM,schema:SORT_SCHEMA,check:checkSort,priority:'low',out:200,user});
    changed=false;
    r.a.forEach(({key,kind})=>{const it=S.items.find(i=>i.bbKey===key);if(!it)return;it.bbAi=kind;delete it.bbUnsure;
      if(it.kind!==kind){setKind(it,kind);delete it.cat;changed=true}});
    ensureLinks();save();if(changed){if(editingId==null)renderItems();render()}
  }catch(e){console.warn('AI sort skipped:',e.kind||e.message)}
}
const SORT_SYSTEM=`You sort bills from a budget app in the Philippines into one kind each, using the bill name and amount.
bill: utilities, phone, internet, insurance, government contributions or any other must-pay bill. essential: rent, food, groceries, allowance, tuition.
loan: an installment loan repaid monthly. card: a credit card statement. flex: something that could be cut, like a subscription, streaming or membership.
Return every key you were given, once.`;
const SORT_SCHEMA={type:'object',additionalProperties:false,required:['sorted'],properties:{sorted:{type:'array',items:{type:'object',additionalProperties:false,required:['key','kind'],
  properties:{key:{type:'string'},kind:{type:'string',enum:['bill','essential','loan','card','flex']}}}}}};
const checkSort=a=>a&&Array.isArray(a.sorted)?a.sorted.filter(x=>x&&typeof x.key==='string'&&['bill','essential','loan','card','flex'].includes(x.kind)):null;
// connects on its own once both the link and the key are filled in
let bbTimer=null;
function bbConnect(){
  const url=$('#bbUrl').value.trim(),key=$('#bbKey').value.trim(),c=bbConf();
  if(!url&&!key){if(S.bb){delete S.bb;save()}bbState('off','Not connected');return}
  if(!/^https:\/\//i.test(url)){bbState('off','The link must start with https://');return}
  if(!key){bbState('off','Enter the API key');return}
  if(url===c.url&&key===c.key)return;
  S.bb={url,key};save();
  bbState('busy','Syncing…');syncBillBuddy();
}
['bbUrl','bbKey'].forEach(id=>{const el=$('#'+id);
  el.addEventListener('input',()=>{clearTimeout(bbTimer);bbTimer=setTimeout(bbConnect,800)});
  el.addEventListener('change',()=>{clearTimeout(bbTimer);bbConnect()});
});
$('#bbClear').addEventListener('click',()=>{
  clearTimeout(bbTimer);
  if(S.bb){delete S.bb;save()}
  $('#bbUrl').value='';$('#bbKey').value='';bbState('off','Not connected');
});
setInterval(syncBillBuddy,60000);
setInterval(()=>{if(rollover())save();if(editingId==null&&!document.activeElement?.closest?.('.form'))renderItems();render()},60000);

// ---------- AI: should I take this loan? ----------
// The planner does the arithmetic itself: it lays the new loan's payments over the coming pay cycles
// next to everything else you owe, and works out the largest amount that keeps every cycle covered.
// That answer is exact, free and instant. If an Anthropic API key is set (API tab), Claude then reads a
// short summary of those numbers and explains the call; it is told to use them rather than redo them.
const AI_SDK='vendor/anthropic-sdk-0.133.0.js';
const AI_PRICE={'claude-opus-5-5':[4,20],'claude-sonnet-5-5':[2,10],'claude-haiku-5-5':[0.1,0.5]}; // $ per million tokens in / out
// Pick an AI provider in the API tab: Claude (Anthropic), ChatGPT (OpenAI), or any other service that speaks
// OpenAI's chat format at its own address. Each keeps its own key and model.
const AI_PROV={
  anthropic:{name:'Claude',key:'sk-ant-…',help:'Key from console.anthropic.com.',model:'claude-haiku-5-5'},
  openai:{name:'ChatGPT',key:'sk-…',help:'Key from platform.openai.com.',model:'gpt-5-mini'},
  compat:{name:'AI',key:'Your key',help:'Any OpenAI-compatible API that allows browser requests.',model:''}
};
function aiAll(){
  const a=S.ai;
  if(a&&!a.provider&&a.key)S.ai={provider:'anthropic',anthropic:{key:a.key,model:a.model}}; // saved before providers existed
  return S.ai||{provider:'anthropic'};
}
const aiProv=()=>AI_PROV[aiAll().provider]?aiAll().provider:'anthropic';
function aiConf(){const p=aiProv(),c=aiAll()[p]||{};return {provider:p,key:c.key||'',base:c.base||'',model:p==='anthropic'?(AI_PRICE[c.model]?c.model:AI_PROV.anthropic.model):(c.model||AI_PROV[p].model)}}
const aiReady=()=>{const c=aiConf();return !!(c.key&&c.model&&(c.provider!=='compat'||/^https:\/\//i.test(c.base)))};
const aiModel=()=>aiConf().model;
const aiName=()=>{const c=aiConf();return c.provider==='anthropic'?$('#aiModel').selectedOptions[0]?.text.split(' · ')[0]||'Claude':c.provider==='openai'?'ChatGPT ('+c.model+')':c.model||'AI'};
const aiState=(cls,txt)=>{const el=$('#aiState');el.className='sync '+cls;el.textContent=txt};
function aiSet(patch){const a=aiAll(),p=aiProv();S.ai={...a,provider:p,[p]:{...(a[p]||{}),...patch}};save()}
function fillAI(){
  const c=aiConf(),P=AI_PROV[c.provider];$('#aiLimit').value=aiLimit()||'';$('#aiSort').checked=!S.aiSortOff;paintUsage();
  $('#aiProv').value=c.provider;$('#aiKey').value=c.key;$('#aiKey').placeholder=P.key;$('#aiHelp').textContent=P.help;
  $('#aiBaseF').hidden=c.provider!=='compat';$('#aiBase').value=c.base;
  $('#aiModelF').hidden=c.provider!=='anthropic';$('#aiModelTF').hidden=c.provider==='anthropic';
  if(c.provider==='anthropic')$('#aiModel').value=c.model;else{$('#aiModelT').value=c.model;$('#aiModelT').placeholder=c.provider==='openai'?'gpt-5-mini':'e.g. a model name from your provider'}
  aiState(aiReady()?'ok':'off',aiReady()?'Ready':'Not connected');aiNote();setTimeout(paintAllMon,0);
}
function aiNote(){$('#aiNote').textContent=aiReady()?'Then asks '+aiName():'Add a key in API for AI advice'}
$('#aiProv').addEventListener('change',()=>{S.ai={...aiAll(),provider:$('#aiProv').value};save();fillAI()});
$('#aiKey').addEventListener('change',()=>{aiSet({key:$('#aiKey').value.trim()});fillAI()});
$('#aiModel').addEventListener('change',()=>{aiSet({model:$('#aiModel').value});fillAI()});
$('#aiModelT').addEventListener('change',()=>{aiSet({model:$('#aiModelT').value.trim()});fillAI()});
$('#aiBase').addEventListener('change',()=>{aiSet({base:$('#aiBase').value.trim().replace(/\/+$/,'')});fillAI()});
$('#aiClear').addEventListener('click',()=>{const a=aiAll();delete a[aiProv()];S.ai=a;save();fillAI()});
$('#aiSort').addEventListener('change',()=>{if($('#aiSort').checked)delete S.aiSortOff;else S.aiSortOff=true;save();if(!S.aiSortOff)aiSortBills()});
$('#aiLimit').addEventListener('change',()=>{const v=Math.round(num($('#aiLimit').value));if(v>0)S.aiLimit=v;else delete S.aiLimit;$('#aiLimit').value=v>0?v:'';save();paintUsage()});
fillAI();

// the money in, and everything due, in the pay cycle that starts on `start`
const incomeIn=start=>{const end=shiftCycle(start,1);return S.income.reduce((s,x)=>{const d=parseD(x.date);return s+(d&&d>=start&&d<end?num(x.amount):0)},0)};
const dueIn=start=>S.items.filter(i=>i.kind!=='loan'&&num(i.amount)>0&&inCycle(i,start)).reduce((s,i)=>s+num(i.amount),0)+loansIn(start);
function loanPlan(f){
  const r=f.rate/100;
  if(f.type==='once')return [{d:f.due,amt:f.amt*(1+r)}];
  const per=payFor({rate:f.rate,addon:f.addon},f.amt,f.term),out=[];
  for(let k=0;k<f.term;k++){const m=new Date(f.due.getFullYear(),f.due.getMonth()+k,1);out.push({d:new Date(m.getFullYear(),m.getMonth(),Math.min(f.due.getDate(),dim(m.getFullYear(),m.getMonth()))),amt:per})}
  return out;
}
function loanCheck(f){
  const plan=loanPlan(f),last=plan[plan.length-1].d,buffer=Math.max(0,num(S.buffer)),start=cycleStart(),rows=[];
  for(let j=0,c=start;j<40&&(j<3||c<=last);j++,c=shiftCycle(c,1)){
    const end=shiftCycle(c,1),pay=plan.filter(p=>p.d>=c&&p.d<end).reduce((s,p)=>s+p.amt,0);
    const money=num(S.salary)+incomeIn(c),bills=dueIn(c);
    rows.push({start:c,end:new Date(end.getFullYear(),end.getMonth(),end.getDate()-1),money,bills,pay,before:money-bills,after:money-bills-pay});
  }
  // payments grow in step with the amount borrowed, so the safe amount is exact: the tightest cycle decides
  let safe=Infinity;rows.forEach(x=>{if(x.pay>0)safe=Math.min(safe,Math.max(0,(x.before-buffer)/(x.pay/f.amt)))});
  if(!isFinite(safe))safe=f.amt;
  const worst=rows.reduce((a,x)=>x.pay>0&&x.after<a.after?x:a,{after:Infinity});
  const total=plan.reduce((s,p)=>s+p.amt,0),covered=rows.filter(x=>x.pay>0).length;
  const verdict=worst.after<-0.004?'no':worst.after<buffer-0.004?'careful':'yes';
  const fee=Math.min(99,Math.max(0,f.fee||0)),net=f.amt*(1-fee/100);
  const eff=f.type==='inst'||fee>0?effRate({rate:f.type==='inst'?f.rate:0,addon:f.addon,fee,term:f.term})*100:null;
  if(f.avail>0)safe=Math.min(safe,f.avail);                       // a creditor can't lend more than it offers
  return {f,plan,rows,buffer,safe:Math.floor(safe/100)*100,worst,total,interest:total-net,net,fee,overLimit:f.avail>0&&f.amt>f.avail,
    eff:eff!=null&&f.type==='once'&&fee>0?null:eff,verdict,covered,shortNow:rows[0].before<0};
}
function readLoanForm(){
  const amt=num($('#aiAmt').value),type=$('#aiType').value,due=parseD($('#aiDue').value),term=Math.round(num($('#aiTerm').value)),rate=num($('#aiRate').value);
  if(!(amt>0))return 'Enter how much you want to borrow.';
  if(type==='inst'&&!(term>=1&&term<=60))return 'Enter how many months, from 1 to 60.';
  if(!due)return 'Pick the '+(type==='inst'?'first due date':'due date')+'.';
  const src=S.sources.find(x=>String(x.id)===$('#aiSrc').value);
  return {amt,type,due,term:type==='inst'?term:1,rate,addon:$('#aiAddon').value==='1',fee:num($('#aiFee').value),
    src:src?.name||'',avail:num(src?.avail),why:$('#aiWhy').value.trim().slice(0,120)};
}
function syncLoanForm(){const inst=$('#aiType').value==='inst';$('#aiTermF').hidden=!inst;$('#aiAddonF').hidden=!inst;
  $('#aiRateL').textContent=inst?'Interest %/month':'Interest or fee (%)';$('#aiDueL').textContent=inst?'First due date':'Due date'}
$('#aiType').addEventListener('change',syncLoanForm);syncLoanForm();
// pick a creditor from the Borrow tab and its terms fill the form
function fillAISrc(){
  const sel=$('#aiSrc'),v=sel.value;
  sel.innerHTML='<option value="">My own terms</option>'+S.sources.map(x=>`<option value="${x.id}">${esc(x.name||'Creditor')}${known(x)?` · ${num(x.rate)}%`:''}</option>`).join('');
  sel.value=S.sources.some(x=>String(x.id)===v)?v:'';aiSrcHint();
}
function aiSrcHint(){const x=S.sources.find(y=>String(y.id)===$('#aiSrc').value);$('#aiAmtH').textContent=x&&num(x.avail)>0?'Up to '+peso(num(x.avail)):''}
$('#aiSrc').addEventListener('change',()=>{
  const x=S.sources.find(y=>String(y.id)===$('#aiSrc').value);aiSrcHint();if(!x)return;
  const term=Math.max(1,Math.round(num(x.term)||1));
  $('#aiType').value=term>1?'inst':'once';$('#aiTerm').value=term>1?term:'';$('#aiRate').value=x.rate??'';
  $('#aiAddon').value=x.addon?'1':'0';$('#aiFee').value=num(x.fee)||'';
  if(!$('#aiDue').value){const t=new Date();$('#aiDue').value=iso(new Date(t.getFullYear(),t.getMonth()+1,Math.min(t.getDate(),dim(t.getFullYear(),t.getMonth()+1))))}
  syncLoanForm();
});
const VERDICT={yes:['ok','You can afford it'],careful:['warn','Tight, but possible'],no:['bad','Not without falling short']};
function renderLoanCheck(R){
  const [cls,word]=VERDICT[R.verdict],f=R.f,per=f.type==='inst'?R.plan[0].amt:R.total;
  return `<div class="reco ${cls==='bad'?'bad':'ok'} aiv"><div class="aiv-h"><span class="pill ${cls}">${word}</span><span class="muted small">Planner's check</span></div>
    <h3>${f.type==='inst'?`${peso(per)} a month for ${f.term} month${f.term===1?'':'s'}`:`Pay back ${peso(R.total)} on ${fmtD(f.due)}`}</h3>
    ${R.overLimit?`<p class="small t-bad">More than ${esc(f.src)} offers (${peso(f.avail)}).</p>`:''}
    <ul>${R.fee>0?`<li><span>You receive</span><span class="a">${peso(R.net)}</span></li>`:''}<li><span>Interest${R.fee>0?' and fee':''}</span><span class="a">${peso(R.interest)}</span></li>
      ${R.eff!=null?`<li><span>Real rate /mo</span><span class="a">${R.eff.toFixed(2)}%</span></li>`:''}
      <li><span>Tightest cycle${isFinite(R.worst.after)?' ('+fmtD(R.worst.start)+')':''}</span><span class="a">${isFinite(R.worst.after)?peso(R.worst.after)+' left':'—'}</span></li>
      <li><span>Safe to borrow</span><span class="a"><b>${peso(R.safe)}</b></span></li></ul>
    <p class="note">Safe = every cycle keeps your ${peso(R.buffer)} buffer. Card bills are estimated from this cycle.${R.shortNow?' You\'re already short this cycle.':''}</p>
    <details class="paidlist"><summary>By pay cycle</summary><div class="cyc">${R.rows.map(x=>`<div class="cycrow${x.after<0?' neg':''}"><span>${fmtD(x.start)} – ${fmtD(x.end)}</span><span class="num">${peso(x.before)}${x.pay?` − ${peso(x.pay)}`:''}</span><span class="num">${peso(x.after)}</span></div>`).join('')}</div>
    <p class="note">After bills − loan = left</p></details></div>`;
}

// ---------- each tab is monitored ----------
// The planner checks every tab itself as you go (free and instant) and lists what needs attention at the
// top. The ✨ button asks the AI for a short review of that tab: it gets these checks plus a snapshot of the
// whole planner, so its advice rests on the same numbers. Reviews are only asked for when you tap, are kept
// for the day until the numbers change, and stop at 70% of the daily limit (see aiAsk).
var TAB_NAME={cycle:'This cycle',bills:'Bills',inst:'Installments',acct:'Accounts',money:'Income',borrow:'Borrow',ahead:'Plan'};
function moneyRunsOut(C){
  const ev=[{d:C.start,v:num(S.salary)},...C.inc.map(o=>({d:o.d,v:num(o.x.amount)})),...C.lines.map(l=>({d:l.date,v:-l.need}))].sort((a,b)=>a.d-b.d||b.v-a.v);
  let bal=0;for(const e of ev){bal+=e.v;if(bal<-0.004)return e.d}return null;
}
function monitor(tab){
  const C=compute(),out=[],add=(lv,t)=>out.push({lv,t}),t0=new Date();t0.setHours(0,0,0,0);
  const days=d=>Math.round((d-t0)/DAY),plural=(n,w)=>n+' '+w+(n===1?'':'s');
  const late=C.lines.filter(l=>!isPaid(l.i)&&l.date<t0);
  if(tab==='cycle'){
    if(C.gap>0.004)add('bad','Short '+peso(C.gap)+' this cycle');
    const out1=moneyRunsOut(C);if(out1)add('bad','Money runs out '+fmtD(out1));
    if(late.length)add('bad',plural(late.length,'bill')+' past due, not marked paid');
    const extra=C.surplus-Math.max(0,num(S.buffer));if(extra>0.004)add('ok',peso(extra)+' extra to pay ahead');
    if(!out.length)add('ok','Every bill is covered');
  }else if(tab==='bills'){
    const start=C.start,vis=S.items.filter(i=>!isHiddenPaid(i)&&inCycle(i,start));
    late.slice(0,2).forEach(l=>add('bad',l.i.name+' was due '+fmtD(l.date)));
    const noAmt=vis.filter(i=>!(num(i.amount)>0)).length;if(noAmt)add('warn',plural(noAmt,'bill')+' without an amount');
    const soon=C.lines.filter(l=>!isPaid(l.i)&&days(l.date)>=0&&days(l.date)<=3).sort((a,b)=>a.date-b.date);
    if(soon.length)add('warn',soon[0].i.name+' due '+(days(soon[0].date)===0?'today':days(soon[0].date)===1?'tomorrow':'in '+days(soon[0].date)+' days')+(soon.length>1?' (+'+(soon.length-1)+' more)':''));
    const nEnded=S.items.filter(i=>ended(i,start)).length;if(nEnded)add('warn',plural(nEnded,'ended bill')+' to remove or update');
    if(!out.length)add('ok','All set this cycle');
  }else if(tab==='inst'){
    const loans=S.items.filter(i=>i.kind==='loan');
    loans.filter(i=>i.left==null||i.left==='').forEach(i=>add('warn',i.name+': add payments left'));
    const no4=loans.filter(i=>!billed(i)&&!last4Of(i)).length;if(no4)add('warn',plural(no4,'installment')+' missing last 4 digits');
    loans.filter(i=>realRate(i)>3).forEach(i=>add('warn',i.name+' costs about '+realRate(i).toFixed(1)+'%/mo'));
    loans.filter(i=>num(i.left)===1&&!isPaid(i)).forEach(i=>add('ok',i.name+' ends with its next payment'));
    if(!out.length)add('ok',loans.length?'Installments on track':'No installments');
  }else if(tab==='acct'){
    S.accounts.forEach(a=>{const L=num(a.limit);if(L>0){const p=usedOf(a)/L*100;if(p>50)add('bad',a.name+' at '+p.toFixed(0)+'% of its limit');else if(p>30)add('warn',a.name+' at '+p.toFixed(0)+'% of its limit')}});
    const noL=S.accounts.filter(a=>!(num(a.limit)>0)).length;if(noL)add('warn',plural(noL,'card')+' without a limit');
    const no4=S.accounts.filter(a=>!a.last4).length;if(no4)add('warn',plural(no4,'card')+' missing last 4 digits');
    if(!out.length)add('ok',S.accounts.length?'Every card under 30%':'No cards');
  }else if(tab==='money'){
    const C0=C.start,past=S.income.filter(x=>{const d=parseD(x.date);return d&&d<C0}).length,bad=S.income.filter(x=>!(num(x.amount)>0)||!parseD(x.date)).length;
    if(bad)add('warn',bad+' '+(bad===1?'entry needs':'entries need')+' an amount and date');
    if(past)add('warn',past+' from past cycles, not counted');
    if(C.other>0)add('ok',peso(C.other)+' arriving this cycle');
    if(!out.length)add('ok','Nothing extra this cycle');
  }else if(tab==='borrow'){
    const kn=S.sources.filter(known),noRate=S.sources.length-kn.length;
    if(!S.sources.length)add(C.gap>0.004?'warn':'ok',C.gap>0.004?'Add creditors to compare':'No creditors yet');
    if(noRate)add('warn',plural(noRate,'creditor')+' without an interest rate');
    if(kn.length){const c=kn.map(x=>({x,e:effRate(x)})).sort((a,b)=>a.e-b.e)[0];add('ok','Cheapest: '+c.x.name+' ('+(c.e*100).toFixed(2)+'%/mo)')}
  }else if(tab==='ahead'){
    const salary=num(S.salary);let first=null,last=null;
    for(let m=0,d=C.start;m<36;m++,d=shiftCycle(d,1)){const free=salary-loansIn(d)-fixedIn(d);if(free<-0.004&&!first)first=d;if(loansIn(d)>0)last=d}
    if(first)add('bad','Short in the '+fmtD(first)+' cycle');
    if(last)add('ok','Installments done after '+MON[last.getMonth()]+' '+last.getFullYear());
    if(!out.length)add('ok','No installments');
  }
  return out;
}
// a compact picture of the whole planner, for the AI
function aiSnapshot(){
  const C=compute(),r2=x=>Math.round(x*100)/100,d=x=>x?iso(x):undefined;
  const sched=payFreq()==='week'?'every '+WD[num(S.payweekday)%7]:payFreq()==='twice'?`twice a month, days ${dayNum(S.payday,15)} and ${dayNum(S.payday2,30)}`:'monthly, day '+clampPd();
  const next=[];for(let m=0,c=C.start;m<6;m++,c=shiftCycle(c,1)){const money=num(S.salary)+incomeIn(c),bills=dueIn(c);next.push({start:d(c),money_in:r2(money),bills:r2(bills),left:r2(money-bills)})}
  return {today:todayIso(),pay_schedule:sched,salary_per_payday:r2(num(S.salary)),buffer_per_cycle:r2(Math.max(0,num(S.buffer))),
    this_cycle:{start:d(C.start),end:d(C.end),money_in:r2(C.avail),bills:r2(C.total),paid_so_far:r2(C.paidAmt),short_by:C.gap>0?r2(C.gap):0,extra:C.surplus>0?r2(C.surplus):0},
    bills:C.lines.map(l=>({name:l.i.name,category:catOf(l.i)?.name,type:l.i.kind,amount:r2(l.need),due:d(l.date),paid:isPaid(l.i)||undefined})),
    installments:S.items.filter(i=>i.kind==='loan'&&!hasParts(i)).map(i=>({name:i.name,lender:lenderName(i),billed_with_card:i.inCard?true:undefined,monthly:r2(num(i.amount)),payments_left:i.left??null,total_payments:i.total??undefined,rate_pct_month:i.rate??undefined,rate_type:i.addon?'add-on':undefined,due_day:dayOf(i),last4_set:!!last4Of(i)})),
    cards:S.accounts.map(a=>{const b=billOf(a),L=num(a.limit);return {name:a.name,statement:r2(num(b?.amount)),limit:L||undefined,usage_pct:L?r2(usedOf(a)/L*100):undefined,due:b&&(b.day||b.bbDue)?d(dueOf(b,C.start)):undefined,statement_day:a.stmt||undefined,last4_set:!!a.last4}}),
    income:S.income.map(x=>({label:x.label,amount:r2(num(x.amount)),date:x.date||undefined,counts:incTag(x).t})),
    creditors:S.sources.map(x=>({name:x.name,rate_pct_month:known(x)?num(x.rate):undefined,rate_type:x.addon?'add-on':'diminishing',fee_pct:num(x.fee)||undefined,term_months:num(x.term)||undefined,available:num(x.avail)||undefined})),
    next_cycles:next};
}
const REVIEW_SYSTEM=`You review one tab of a person's budget planner in the Philippines. Amounts are in pesos.
The planner has done all the arithmetic and lists its own checks for the tab. Trust its numbers; never recompute them or invent amounts or dates.
Focus on the named tab and use the rest of the snapshot only for context.
status: "good" if nothing needs attention, "watch" if something should be kept an eye on, "act" if something needs action now (a bill past due, money running out, a card above 50% of its limit).
headline: one short sentence. points: up to three short findings naming the specific bills, cards, installments or dates. actions: up to three concrete next steps, most important first. Plain words, short sentences.`;
const REVIEW_SCHEMA={type:'object',additionalProperties:false,required:['status','headline','points','actions'],properties:{
  status:{type:'string',enum:['good','watch','act']},headline:{type:'string'},points:{type:'array',items:{type:'string'}},actions:{type:'array',items:{type:'string'}}}};
const checkReview=a=>a&&['good','watch','act'].includes(a.status)&&typeof a.headline==='string'?{status:a.status,headline:a.headline,points:strList(a.points).slice(0,3),actions:strList(a.actions).slice(0,3)}:null;
const reviewPrompt=(tab,list)=>`Review the "${TAB_NAME[tab]}" tab.\nPlanner checks: ${JSON.stringify(list.map(x=>x.lv+': '+x.t))}\nSnapshot: ${JSON.stringify(aiSnapshot())}`;
const REVIEW_LOOK={good:['ok','Looks good'],watch:['warn','Keep an eye on'],act:['bad','Needs action']};
function reviewHtml(r){const [cls,word]=REVIEW_LOOK[r.a.status];
  return `<div class="aiv-h"><span class="pill ${cls}">${word}</span><span class="muted small">AI review</span></div><p class="aih">${esc(r.a.headline)}</p>
    ${r.a.points.length?`<ul>${r.a.points.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}
    ${r.a.actions.length?`<p class="label">Next</p><ul>${r.a.actions.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}
    <p class="note">${esc(r.model)}${r.cost?' · '+esc(r.cost):''}</p>`}
function paintMon(tab){
  const el=$('#mon-'+tab);if(!el||!TAB_NAME||!TAB_NAME[tab])return; // the first draw at startup runs before this part has loaded
  const list=monitor(tab),worst=list.some(x=>x.lv==='bad')?'bad':list.some(x=>x.lv==='warn')?'warn':'ok',n=list.filter(x=>x.lv!=='ok').length;
  const c=S.aiTab?.[tab],fresh=c&&c.day===todayIso()&&c.h===hashStr(reviewPrompt(tab,list));
  const box=el.querySelector('.mon-ai'),busy=box&&box.dataset.busy;
  el.className='mon '+worst;
  el.innerHTML=`<div class="mon-h">${IC[worst]}<span class="mon-t">${n?n+' to check':'All good'}</span>${aiReady()?`<button class="ghost ib" data-review="${tab}" aria-label="Review ${TAB_NAME[tab]} with AI" title="Review with AI"${busy?' disabled':''}>${IC.spark}</button>`:''}</div>
    <ul class="mon-l">${list.slice(0,4).map(x=>`<li class="${x.lv}">${IC[x.lv]}<span>${esc(x.t)}</span></li>`).join('')}</ul>
    <div class="mon-ai"${busy?' data-busy="1"':''}>${busy?box.innerHTML:fresh?reviewHtml(c):''}</div>`;
}
function paintAllMon(){Object.keys(TAB_NAME).forEach(t=>{if(!$('#panel-'+t).hidden)paintMon(t)});Object.keys(TAB_NAME).forEach(t=>{if($('#panel-'+t).hidden)stale.add(t==='borrow'?'borrow':t)})}
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-review]');if(!b)return;
  const tab=b.dataset.review,list=monitor(tab),user=reviewPrompt(tab,list),box=$('#mon-'+tab+' .mon-ai');
  box.dataset.busy='1';box.innerHTML='<p class="muted small">Reviewing…</p>';b.disabled=true;
  try{
    const r=await aiAsk({name:'tab_review',purpose:'review',system:REVIEW_SYSTEM,schema:REVIEW_SCHEMA,check:checkReview,priority:'low',out:600,user});
    S.aiTab={...(S.aiTab||{}),[tab]:{day:todayIso(),h:hashStr(user),a:r.a,model:r.model,cost:r.cost}};save();
    delete box.dataset.busy;paintMon(tab);
  }catch(err){delete box.dataset.busy;paintMon(tab);$('#mon-'+tab+' .mon-ai').innerHTML=`<p class="t-bad small">${aiError(err)}</p>`}
});

// ---------- asking Claude ----------
let aiSdk=null;const aiMemo=new Map();
function loadAISdk(){return aiSdk||=new Promise((ok,fail)=>{const t=document.createElement('script');t.src=AI_SDK;t.onload=()=>ok(window.AnthropicSDK);t.onerror=()=>{aiSdk=null;fail(new Error('load'))};document.head.appendChild(t)})}
const AI_SYSTEM=`You advise one person in the Philippines on whether to take a loan, using a summary of their own budget planner.
The planner has already done all the arithmetic. Trust its numbers; never recompute them or invent amounts. Amounts are in pesos.
"left_after" is what remains in a pay cycle after every bill and the new loan's payment. The buffer is the cushion they want to keep each cycle.
Decide: "yes" if every cycle stays at or above the buffer, "careful" if a cycle dips below the buffer but stays above zero, "no" if any cycle goes below zero or the loan is very expensive for what it's for.
Write plainly for a non-expert, in short sentences. headline: one sentence. reasons: two to four short points naming the specific cycles, bills or debts that matter. tips: one to three practical suggestions, such as a smaller amount, more months, a cheaper source, or which bill makes it tight. safe_amount: the most they should borrow, normally the planner's figure.`;
const AI_SCHEMA={type:'object',additionalProperties:false,required:['verdict','headline','reasons','safe_amount','tips'],properties:{
  verdict:{type:'string',enum:['yes','careful','no']},headline:{type:'string'},reasons:{type:'array',items:{type:'string'}},
  safe_amount:{type:'number'},tips:{type:'array',items:{type:'string'}}}};
function aiSummary(R){
  const f=R.f,r2=x=>Math.round(x*100)/100,d=x=>iso(x);
  const sched=payFreq()==='week'?'every '+WD[num(S.payweekday)%7]:payFreq()==='twice'?`twice a month, days ${dayNum(S.payday,15)} and ${dayNum(S.payday2,30)}`:'monthly, day '+clampPd();
  return {today:iso(new Date()),pay_schedule:sched,salary_per_payday:r2(num(S.salary)),buffer_per_cycle:r2(R.buffer),
    new_loan:{creditor:f.src||undefined,creditor_limit:f.avail||undefined,upfront_fee_pct:R.fee||undefined,received_after_fee:R.fee?r2(R.net):undefined,amount:r2(f.amt),repayment:f.type==='inst'?'installments':'one-time',months:f.type==='inst'?f.term:undefined,
      interest_pct:f.rate,rate_type:f.type==='inst'?(f.addon?'add-on':'diminishing'):undefined,first_due:d(f.due),purpose:f.why||undefined,
      payment_each:r2(R.plan[0].amt),total_repay:r2(R.total),total_interest:r2(R.interest),real_monthly_rate_pct:R.eff!=null?r2(R.eff):undefined},
    planner_check:{verdict:R.verdict,safe_amount:R.safe,tightest_cycle_left:isFinite(R.worst.after)?r2(R.worst.after):null,already_short_this_cycle:R.shortNow},
    cycles:R.rows.map(x=>({start:d(x.start),money_in:r2(x.money),bills:r2(x.bills),new_loan_payment:r2(x.pay),left_after:r2(x.after)})),
    installments:S.items.filter(i=>i.kind==='loan'&&num(i.amount)>0).map(i=>({name:i.name,monthly:r2(num(i.amount)),payments_left:num(i.left),rate_pct_month:i.rate??undefined})),
    cards:S.accounts.map(a=>{const b=billOf(a);return {name:a.name,statement:r2(num(b?.amount)),limit:num(a.limit)||undefined}}),
    other_bills:S.items.filter(i=>i.kind!=='loan'&&i.kind!=='card'&&num(i.amount)>0).map(i=>({name:i.name,amount:r2(num(i.amount)),type:catOf(i)?.name})),
    creditors:S.sources.filter(x=>known(x)).map(x=>({name:x.name,rate_pct_month:num(x.rate),rate_type:x.addon?'add-on':'diminishing',available:num(x.avail)||undefined}))};
}
// ---------- one way to ask the AI, with a daily budget ----------
// Every question goes through aiAsk: it answers repeats from memory, keeps to the daily token limit set in
// the API tab, and gives loan checks priority: tab reviews stop at 70% of the limit so loan checks keep room.
function todayIso(){return iso(new Date())}
function aiLimit(){return Math.max(0,Math.round(num(S.aiLimit)))} // 0 means no limit
function aiUsed(){return S.aiUse&&S.aiUse.day===todayIso()?num(S.aiUse.tokens):0}
var LOW_SHARE=0.7;
function aiSpend(n,purpose){
  const d=todayIso(),t=Math.max(0,Math.round(n));S.aiUse={day:d,tokens:aiUsed()+t};
  // a short history by day and purpose (loan checks, tab reviews, sorting), shown in the API tab
  const log=S.aiLog&&typeof S.aiLog==='object'?S.aiLog:{},day=log[d]||(log[d]={});day[purpose||'other']=(day[purpose||'other']||0)+t;
  Object.keys(log).sort().slice(0,-7).forEach(k=>delete log[k]);S.aiLog=log;save();paintUsage();
}
var USE_NAME={loan:'Loan checks',review:'Tab reviews',sort:'Sorting bills',place:'Placing installments',other:'Other'};
function paintUsage(){
  const L=aiLimit(),u=aiUsed(),el=$('#aiUsage');if(!el)return;
  const log=S.aiLog||{},today=log[todayIso()]||{},days=Object.keys(log).sort().reverse().filter(d=>d!==todayIso()).slice(0,6);
  const sum=o=>Object.values(o).reduce((s,v)=>s+num(v),0);
  const names=USE_NAME||{};el.innerHTML=`<div class="usage-t"><span>Today</span><span class="num">${u.toLocaleString()}${L?' / '+L.toLocaleString():''} tokens</span></div>`+
    (L?`<div class="ubar" role="img" aria-label="${Math.min(100,u/L*100).toFixed(0)}% of today's limit used"><i class="${u>=L?'bad':u>=L*LOW_SHARE?'warn':''}" style="width:${Math.min(100,u/L*100).toFixed(1)}%"></i></div>`:'')+
    (Object.keys(today).length?`<div class="usage-p">${Object.entries(today).map(([k,v])=>`<span>${names[k]||k} <b class="num">${num(v).toLocaleString()}</b></span>`).join('')}</div>`:'')+
    (days.length?`<details class="paidlist"><summary>Earlier days</summary><ul>${days.map(d=>`<li><span>${fmtD(parseD(d))}</span><span class="num">${sum(log[d]).toLocaleString()} tokens</span></li>`).join('')}</ul></details>`:'');
}
const hashStr=t=>{let h=5381;for(let k=0;k<t.length;k++)h=(h*33^t.charCodeAt(k))>>>0;return h.toString(36)};
// Sorting bills and placing installments are simple matching, so they always use the provider's lightest
// model, whatever the API tab picks for loan checks and reviews.
const AI_LIGHT={anthropic:'claude-haiku-5-5',openai:'gpt-5-nano'};
const aiLightConf=()=>{const c=aiConf();return {...c,model:AI_LIGHT[c.provider]||c.model}};
async function aiAsk(job){
  const c=job.light?aiLightConf():aiConf(),memoKey=[c.provider,c.base,c.model,job.name,job.user].join('|');
  if(aiMemo.has(memoKey))return {...aiMemo.get(memoKey),cached:true}; // the same question twice costs nothing
  const L=aiLimit(),est=Math.ceil((job.system.length+job.user.length)/3.5)+job.out;
  if(L&&aiUsed()+est>(job.priority==='low'?L*LOW_SHARE:L))throw Object.assign(new Error('limit'),{kind:'limit',low:job.priority==='low'});
  const out=c.provider==='anthropic'?await askClaude(c,job):await askOpenAIFormat(c,job).catch(e=>{
    // a key that can't use the light model falls back to the one picked in the API tab
    if(job.light&&e.kind==='http'&&[400,403,404].includes(e.status)&&c.model!==aiConf().model)return askOpenAIFormat(aiConf(),job);throw e});
  aiSpend(out.tokens||est,job.purpose);
  aiMemo.set(memoKey,out);return out;
}
async function askClaude(c,job){
  const SDK=await loadAISdk();
  const client=new SDK.Anthropic({apiKey:c.key,dangerouslyAllowBrowser:true,maxRetries:1});
  const req={model:c.model,max_tokens:4000,output_config:{effort:'low',format:SDK.jsonSchemaOutputFormat(job.schema)},system:job.system,
    messages:[{role:'user',content:job.user}]};
  // Opus and Sonnet can retry a declined request on another model; Haiku has no server-side fallback
  if(c.model!=='claude-haiku-5-5')Object.assign(req,{betas:['server-side-fallback-2026-07-01'],fallbacks:'default'});
  const res=await client.beta.messages.parse(req);
  if(res.stop_reason==='refusal')throw Object.assign(new Error('refusal'),{kind:'refusal'});
  const a=res.stop_reason==='max_tokens'?null:job.check(res.parsed_output);
  if(!a)throw Object.assign(new Error('incomplete'),{kind:'incomplete'});
  const [pin,pout]=AI_PRICE[c.model],u=res.usage||{},tokens=(u.input_tokens||0)+(u.output_tokens||0);
  return {a,model:res.model||c.model,tokens,cost:'~$'+(((u.input_tokens||0)*pin+(u.output_tokens||0)*pout)/1e6).toFixed(4)};
}
// OpenAI's chat completions format: ChatGPT gets a strict JSON schema; other services get plain JSON mode,
// which more of them support, with the shape spelled out in the prompt and checked here
async function askOpenAIFormat(c,job){
  const openai=c.provider==='openai',url=(openai?'https://api.openai.com/v1':c.base)+'/chat/completions';
  const body={model:c.model,messages:[{role:'system',content:job.system+(openai?'':'\nReply with only a JSON object with the keys '+job.schema.required.join(', ')+'.')},
    {role:'user',content:job.user}],
    response_format:openai?{type:'json_schema',json_schema:{name:job.name,strict:true,schema:job.schema}}:{type:'json_object'}};
  if(openai){body.max_completion_tokens=4000;if(/^(gpt-5|o\d)/i.test(c.model))body.reasoning_effort='low'}else body.max_tokens=4000;
  let r;
  try{r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+c.key},body:JSON.stringify(body)})}
  catch(e){throw Object.assign(new Error('network'),{kind:'network'})}
  const j=await r.json().catch(()=>null);
  if(!r.ok)throw Object.assign(new Error(j?.error?.message||'HTTP '+r.status),{kind:'http',status:r.status});
  const ch=j?.choices?.[0],m=ch?.message;
  if(m?.refusal)throw Object.assign(new Error('refusal'),{kind:'refusal'});
  if(ch?.finish_reason==='length')throw Object.assign(new Error('incomplete'),{kind:'incomplete'});
  let a;try{a=job.check(JSON.parse(String(m?.content||'').replace(/^```(?:json)?\s*|\s*```$/g,'')))}catch(e){a=null}
  if(!a)throw Object.assign(new Error('incomplete'),{kind:'incomplete'});
  const u=j.usage||{},tokens=(u.prompt_tokens||0)+(u.completion_tokens||0);
  return {a,model:j.model||c.model,tokens,cost:tokens?tokens.toLocaleString()+' tokens':''};
}
const strList=x=>Array.isArray(x)?x.map(String).filter(Boolean).slice(0,5):[];
const checkLoan=a=>a&&['yes','careful','no'].includes(a.verdict)&&typeof a.headline==='string'?{verdict:a.verdict,headline:a.headline,reasons:strList(a.reasons),safe_amount:num(a.safe_amount),tips:strList(a.tips)}:null;
const askAI=R=>aiAsk({name:'loan_advice',purpose:'loan',system:AI_SYSTEM,schema:AI_SCHEMA,check:checkLoan,priority:'high',out:700,
  user:'Should I take this loan? Planner summary:\n'+JSON.stringify(aiSummary(R))});
function aiError(e){
  const A=window.AnthropicSDK?.Anthropic,who=aiConf().provider==='anthropic'?'Claude':aiConf().provider==='openai'?'ChatGPT':'The AI';
  if(e.message==='load')return 'Could not load the AI library. Check your connection.';
  if(e.kind==='limit')return e.low?'Tab reviews pause at 70% of today\'s AI limit, so loan checks keep room. Resets tomorrow.':'Today\'s AI limit is used up. It resets tomorrow, or raise it in the API tab.';
  if(e.kind==='refusal')return who+' declined to answer this one. The planner\'s check above still applies.';
  if(e.kind==='incomplete')return who+'\'s answer was cut off or unreadable. Try again.';
  if(e.kind==='network')return 'Could not reach '+who+'. Check your connection'+(aiConf().provider==='compat'?', and that this service allows requests from a browser.':'.');
  const st=e.kind==='http'?e.status:A&&e instanceof A.APIError?e.status:null;
  if(A&&e instanceof A.APIConnectionError)return 'Could not reach Anthropic. Check your connection.';
  if(st===401)return 'The API key was not accepted. Check it in the API tab.';
  if(st===403)return 'This API key is not allowed to use that model.';
  if(st===404)return 'That model or address was not found. Check it in the API tab.';
  if(st===429)return 'Too many requests or no credit left on the key. Try again later.';
  if(st===400)return 'The AI could not read the request: '+e.message;
  if(st)return 'The AI service had a problem ('+st+'). Try again.';
  return 'Something went wrong asking the AI.';
}
let aiRun=0;
$('#aiForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const f=readLoanForm(),out=$('#aiOut');
  if(typeof f==='string'){out.innerHTML=`<p class="t-bad small">${f}</p>`;return}
  const R=loanCheck(f),run=++aiRun;
  out.innerHTML=renderLoanCheck(R)+(aiReady()?`<div class="aibox" id="aiAns"><p class="muted small">Asking ${esc(aiName())}…</p></div>`:'');
  if(!aiReady())return;
  const btn=$('#aiGo');btn.disabled=true;
  try{
    const who=AI_PROV[aiConf().provider].name,{a,cost,model}=await askAI(R);if(run!==aiRun)return;
    const [cls,word]=VERDICT[a.verdict]||VERDICT.careful;
    $('#aiAns').innerHTML=`<div class="aiv-h"><span class="pill ${cls}">${word}</span><span class="muted small">${esc(who)}'s view</span></div>
      <p class="aih">${esc(a.headline)}</p>${a.reasons.length?`<ul>${a.reasons.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}
      ${a.tips.length?`<p class="label">Tips</p><ul>${a.tips.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}
      <p class="note">${esc(model)}${cost?' · '+esc(cost):''}</p>`;
  }catch(err){if(run===aiRun)$('#aiAns').innerHTML=`<p class="t-bad small">${aiError(err)}</p>`}
  finally{btn.disabled=false}
});

// ---------- cloud (Supabase) ----------
// One row per user in public.planner_state (see supabase/schema.sql); Row Level Security keeps it private.
// Connection details come from config.js. Without them the planner stays on this device only.
const CFG=window.PLANNER_CONFIG||{};
const EMAIL_KEY=KEY+'.email'; // only the email address, to fill in the sign-in form
// Every save carries a new random `writer`. The database rejects saves that don't (see supabase/schema.sql):
// those come from a copy of the planner loaded before this rule, which would file bills with outdated rules.
const newWriter=()=>Math.random().toString(36).slice(2)+Date.now().toString(36);
async function pushCloud(){
  cloudTimer=null;pushing=true;
  const row={user_id:cloudUser.id,state:JSON.parse(snapshot())};if(!noWriter)row.writer=newWriter();
  let {data,error}=await sb.from('planner_state').upsert(row).select('updated_at').single();
  // the `writer` column isn't there until schema.sql is run again; save without it meanwhile
  if(error&&!noWriter&&/writer/i.test(error.message||'')){noWriter=true;delete row.writer;({data,error}=await sb.from('planner_state').upsert(row).select('updated_at').single())}
  pushing=false;
  if(cloudTimer||!cloudReady)return; // a newer save is queued, or signed out meanwhile
  if(error){console.warn('Supabase save failed',error);setSync('off','Not saved yet. Retrying…');cloudTimer=setTimeout(pushCloud,5000);return}
  cloudAt=data.updated_at;setSync('ok','Saved to your account');
}
async function pullCloud(){
  const {data,error}=await sb.from('planner_state').select('state,updated_at').eq('user_id',cloudUser.id).maybeSingle();
  if(error)throw error;
  return data;
}
async function startCloud(user){
  cloudUser=user;cloudReady=false;renderAuth();setSync('busy','Loading your planner…');
  try{
    const row=await pullCloud();
    if(cloudUser?.id!==user.id)return;
    cloudReady=true;
    if(row&&row.state&&row.state.ver===DEFAULTS.ver){adopt(row.state);cloudAt=row.updated_at;setSync('ok','Saved to your account')}
    else{adopt(legacy||clone(DEFAULTS));save()} // a new account starts from this browser's old data, or the installments
    legacy=null;LEGACY_KEYS.forEach(k=>{try{localStorage.removeItem(k)}catch(e){}});
    renderAuth();syncBillBuddy();
  }catch(e){
    console.warn('Supabase load failed',e);setSync('off','Could not reach your account. Trying again…');
    setTimeout(()=>{if(cloudUser?.id===user.id&&!cloudReady)startCloud(user)},5000);
  }
}
// pick up changes made on another device when you come back to this one
document.addEventListener('visibilitychange',async()=>{
  if(document.hidden)return;
  checkUpdate();
  if(!cloudReady||cloudTimer||pushing||draft)return;
  try{
    const row=await pullCloud();
    // only a copy saved after ours, and only when no save of ours is waiting or on its way
    if(!row||cloudTimer||pushing||row.state?.ver!==DEFAULTS.ver)return;
    if(cloudAt&&!(Date.parse(row.updated_at)>Date.parse(cloudAt)))return;
    if(document.activeElement?.matches?.('input,select'))return;
    adopt(row.state);cloudAt=row.updated_at;
  }catch(e){}
});
// the planner stays hidden until your account's data has loaded
let authKnown=false; // false until Supabase has checked this device for a saved sign-in
function renderAuth(){
  document.body.classList.toggle('locked',!cloudReady);
  const db=$('#draftBtn');db.hidden=!cloudReady;db.textContent=draft?'Close draft':'Draft';db.classList.toggle('on',!!draft);
  db.title=draft?'Close the draft; nothing in it is kept':'Try changes in a copy that is never saved';
  $('#authBtn').hidden=!cloudUser;
  $('#authForm').hidden=!sb||!authKnown||!!cloudUser;
  $('#authWho').textContent=cloudUser?.email||'';$('#authWho').title=cloudUser?.email||'';
}
function signedOut(){
  cloudUser=null;cloudReady=false;clearTimeout(cloudTimer);cloudTimer=null;draft=null;document.body.classList.remove('drafting');
  S=clone(DEFAULTS);prepare();editingId=null;syncInputs();renderAll();fillBB();fillAI();aiMemo.clear();$('#aiOut').innerHTML='';
  setSync('','Sign in to open your planner');renderAuth();
}
function initCloud(){
  if(!CFG.supabaseUrl||!CFG.supabaseAnonKey||!window.supabase){setSync('off','Cloud saving is not set up. Add your Supabase details to config.js.');renderAuth();return}
  // the sign-in is remembered on this device and renewed automatically, so a known device opens straight in
  sb=window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  setSync('busy','Signing you in…');
  try{$('#authEmail').value=localStorage.getItem(EMAIL_KEY)||''}catch(e){}
  sb.auth.onAuthStateChange((ev,session)=>{
    const u=session?.user||null;authKnown=true;
    // claim the user now so a second auth event can't start a second load; load outside the callback
    if(u&&cloudUser?.id!==u.id){cloudUser=u;setTimeout(()=>startCloud(u),0)}
    else if(!u)setTimeout(signedOut,0);
  });
  renderAuth();
}
$('#authBtn').addEventListener('click',()=>{if(cloudUser)sb.auth.signOut()});
$('#authForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const email=$('#authEmail').value.trim(),msg=$('#authMsg'),b=$('#authSend');if(!email)return;
  b.disabled=true;msg.textContent='Sending…';
  try{localStorage.setItem(EMAIL_KEY,email)}catch(e){}
  const {error}=await sb.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin+location.pathname}});
  b.disabled=false;
  msg.textContent=error?'Could not send the link: '+error.message:'Check your email and open the sign-in link on this device.';
});

initCloud();

// ---------- draft ----------
// A testing room: Draft copies the whole planner (every tab, bill, setting and the AI) and you change the copy.
// Nothing in it is saved, other devices' changes aren't pulled in, and closing it brings back the planner as it
// was (the same button, now Close draft). BillBuddy keeps syncing into the draft, so new bills show up there too. AI used in a draft is real, so
// its usage is carried back to the planner's daily count.
async function openDraft(){
  if(!cloudReady||draft)return;
  if(cloudTimer){clearTimeout(cloudTimer);await pushCloud()}   // a change still waiting to save is saved first
  closeDialogs();
  draft={main:clone(S)};
  document.body.classList.add('drafting');renderAuth();
  setSync('draft','Draft · nothing is saved');
}
function closeDraft(){
  if(!draft)return;
  closeDialogs();
  const used=S.aiUse,log=S.aiLog,main=draft.main;draft=null;
  if(used)main.aiUse=used;if(log)main.aiLog=log;
  document.body.classList.remove('drafting');
  adopt(main);renderAuth();
  save();syncBillBuddy();                                       // keeps the AI count, and picks up new bills
}
function closeDialogs(){document.querySelectorAll('dialog[open]').forEach(d=>d.close())}
$('#draftBtn').addEventListener('click',()=>draft?closeDraft():openDraft());

// ---------- updates ----------
// A tab left open keeps running the code it loaded with. When a newer version is published, reload, so an
// old copy never syncs BillBuddy with outdated rules and saves that to the account.
const APP_V=(/[?&]v=(\w+)/.exec(document.currentScript?.getAttribute('src')||'')||[])[1];
async function checkUpdate(){
  if(!APP_V)return;
  try{
    const html=await (await fetch(location.pathname,{cache:'no-store'})).text();
    const v=(/app\.js\?v=(\w+)/.exec(html)||[])[1];
    if(!v||v===APP_V||cloudTimer||pushing||draft||document.activeElement?.matches?.('input,select'))return;
    location.reload();
  }catch(e){}
}
setInterval(checkUpdate,5*60000);
