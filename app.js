const KEY='sahodplan.v1';
// Starting data: only the installments. Everything else starts empty.
// rev marks the data upgrades below as already applied, so they don't add creditors or cards back.
const DEFAULTS={ver:2,salary:0,payday:24,thirteenth:0,efund:5000,buffer:2000,income:[],sources:[],accounts:[],rev:7,items:[
 {name:'UnionBank Loan A',kind:'loan',amount:4384.71,day:24,left:6,total:12,rate:2.49},
 {name:'UnionBank Loan B',kind:'loan',amount:3897.52,day:26,left:9,total:12,rate:2.49},
 {name:'Mari Loan',kind:'loan',amount:7256.67,day:26,left:3,rate:2.95,addon:true}
]};
const SRC_DEFAULT=[];
const SRC_TPL=[
 {name:'SSS Salary Loan',avail:null,rate:0.83,fee:1,term:24},
 {name:'Pag-IBIG Multi-Purpose Loan',avail:null,rate:0.88,fee:0,term:24},
 {name:'Company / coop loan',avail:null,rate:null,fee:0,term:12},
 {name:'Family or friend',avail:null,rate:0,fee:0,term:1},
 {name:'Credit card cash advance',avail:null,rate:3,fee:3,term:3}
];
// iOS-style icons for the edit and remove buttons; each button carries its own label for screen readers
const IC={
  edit:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15.2 5.2l3.6 3.6M4 20l1-4.6L15.6 4.8a2 2 0 012.8 0l.8.8a2 2 0 010 2.8L8.6 19 4 20z"/></svg>',
  trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  undo:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/></svg>',
  chev:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 6l6 6-6 6"/></svg>'
};
const editBtn=(attr,name)=>`<button class="ghost ib" ${attr} aria-label="Edit ${esc(name)}" title="Edit">${IC.edit}</button>`;
const paidBtn=(attr,name)=>`<button class="paidbtn ib" ${attr} aria-label="Mark ${esc(name)} paid" title="Paid">${IC.check}</button>`;
const undoBtn=(attr,name)=>`<button class="ghost ib" ${attr} aria-label="Undo paid for ${esc(name)}" title="Undo">${IC.undo}</button>`;
const delBtn=(attr,label)=>`<button class="danger ib" ${attr} aria-label="${esc(label)}" title="${esc(label)}">${IC.trash}</button>`;
const clone=o=>JSON.parse(JSON.stringify(o));
const $=s=>document.querySelector(s);
const num=v=>{const n=parseFloat(v);return isFinite(n)?n:0};
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
let sb=null,cloudUser=null,cloudAt=null,cloudTimer=null,cloudReady=false,pushing=false,noWriter=false;
function setSync(cls,txt){const el=$('#syncState');el.className='sync '+cls;el.textContent=txt}
const snapshot=()=>JSON.stringify(S,(k,v)=>k==='id'?undefined:v);
function save(){
  if(!cloudReady)return;
  clearTimeout(cloudTimer);setSync('busy','Saving…');
  cloudTimer=setTimeout(pushCloud,700);
}

// ---------- paid tracking ----------
const DAY=86400000;
const cycleKey=()=>{const d=cycleStart();return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate()};
const isPaid=i=>i.paidCycle===cycleKey();
const isHiddenPaid=i=>isPaid(i)&&Date.now()-num(i.paidAt)>=DAY;
function markPaid(i){i.paidAt=Date.now();i.paidCycle=cycleKey();if(i.kind==='loan'){i.prevLeft=num(i.left);i.left=Math.max(0,num(i.left)-1)}}
function undoPaid(i){if(i.kind==='loan'&&i.prevLeft!=null)i.left=i.prevLeft;delete i.paidAt;delete i.paidCycle;delete i.prevLeft}
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
  const lines=S.items.filter(i=>num(i.amount)>0&&inCycle(i,start)).map(i=>{
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
  S.items.filter(i=>i.kind==='loan'&&num(i.amount)>0).forEach(i=>{
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
const catOptions=sel=>S.cats.map(c=>`<option value="${esc(c.key)}" ${c.key===sel?'selected':''}>${esc(c.name)}</option>`).join('');
function itemForm(i){
  return `<div class="form" data-id="${i.id}">
    <div class="field wide"><label for="n${i.id}">Name</label><input id="n${i.id}" data-k="name" placeholder="e.g. Meralco" value="${esc(i.name)}"></div>
    <div class="field wide"><label for="k${i.id}">Category</label><select id="k${i.id}" data-k="cat">${catOptions(catOf(i)?.key)}</select></div>
    <div class="field"><label for="a${i.id}">${i.kind==='card'?'Statement amount':repeats(i)&&i.once?'Amount':'Monthly amount'}</label><input id="a${i.id}" data-k="amount" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" value="${i.amount??''}"></div>
    ${repeats(i)&&i.once?`<div class="field"><label for="dt${i.id}">Due date</label><input id="dt${i.id}" data-k="date" type="date" value="${esc(i.date||'')}"></div>`
      :`<div class="field"><label for="d${i.id}">Due day</label><input id="d${i.id}" data-k="day" type="number" inputmode="numeric" min="1" max="31" value="${i.day??''}"></div>`}
    ${repeats(i)?`<label class="check wide"><input type="checkbox" id="rp${i.id}" data-k="repeat" ${i.once?'':'checked'}><span>Repeats every month</span></label>
    ${i.once?'':`<div class="field wide"><label for="u${i.id}">Stops after</label><input id="u${i.id}" data-k="until" type="month" placeholder="YYYY-MM" pattern="[0-9]{4}-[0-9]{2}" value="${esc(i.until||'')}" aria-describedby="uh${i.id}"><span class="hint" id="uh${i.id}">Leave empty if it never stops.</span></div>`}`:''}
    ${i.kind==='loan'?`<div class="field"><label for="l${i.id}">Payments left</label><input id="l${i.id}" data-k="left" type="number" inputmode="numeric" min="0" value="${i.left??''}"></div><div class="field"><label for="t${i.id}">Total payments</label><input id="t${i.id}" data-k="total" type="number" inputmode="numeric" min="0" value="${i.total??''}"></div>`:''}
    ${i.kind==='card'||i.kind==='loan'?`<div class="field"><label for="f4${i.id}">Last 4 digits</label><input id="f4${i.id}" data-k="last4" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="1234" autocomplete="off" value="${esc(last4Of(i))}"><span class="hint">Matches BillBuddy bills.</span></div>`:''}
    ${i.kind==='card'||i.kind==='loan'?`<div class="field"><label for="r${i.id}">Interest %/month</label><input id="r${i.id}" data-k="rate" type="number" inputmode="decimal" step="0.01" min="0" value="${i.rate??''}"></div>`:''}
    <div class="acts">${delBtn(`data-del="${i.id}"`,"Remove "+(i.name||"this bill"))}<button class="btn" data-done="1">Done</button></div>
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
  const hidden=S.items.filter(isHiddenPaid),vis=S.items.filter(i=>!isHiddenPaid(i)&&inCycle(i,start));
  const done=S.items.filter(i=>ended(i,start));
  const later=S.items.filter(i=>repeats(i)&&i.once&&!i.bbDue&&exactDue(i)>=shiftCycle(start,1)).sort((a,b)=>exactDue(a)-exactDue(b));
  const html=S.cats.map(c=>{
    const its=vis.filter(i=>i.cat===c.key);if(!its.length)return '';
    its.sort((a,b)=>(isPaid(a)-isPaid(b))||dueOf(a,start)-dueOf(b,start));
    const due=its.filter(i=>!isPaid(i)).reduce((s,i)=>s+num(i.amount),0);
    return `<div class="grp" data-c="${esc(c.color)}"><div class="grp-h"><h3>${esc(c.name)}<span>${its.length}</span></h3><span class="sub">${peso(due)}</span></div>${its.map(i=>i.id===editingId?itemForm(i):itemRow(i,start)).join('')}</div>`;
  }).join('');
  const left=vis.filter(i=>!isPaid(i)).reduce((s,i)=>s+num(i.amount),0);
  $('#itemList').innerHTML=(html||'<p class="empty">Nothing left to pay this cycle.</p>')+
    `<div class="tot"><span>Still to pay</span><span>${peso(left)}</span></div>`+
    (hidden.length?`<details class="paidlist"><summary>Paid this cycle (${hidden.length})</summary><ul>${hidden.map(i=>`<li><span>${esc(i.name)}</span><span class="num">${peso(num(i.amount))}</span></li>`).join('')}</ul></details>`:'')+
    (later.length?`<details class="paidlist"${later.some(i=>i.id===editingId)?' open':''}><summary>Coming in a later cycle (${later.length})</summary><div class="later">${later.map(i=>i.id===editingId?itemForm(i):
      `<div class="laterrow"><span>${esc(i.name||'Untitled bill')} <span class="muted">· ${fmtD(exactDue(i))}, ${exactDue(i).getFullYear()}</span></span><span class="num">${peso(num(i.amount))}</span>${editBtn(`data-edit="${i.id}"`,i.name||"bill")}</div>`).join('')}</div></details>`:'')+
    (done.length?`<details class="paidlist"${done.some(i=>i.id===editingId)?' open':''}><summary>Ended (${done.length})</summary><div class="later">${done.map(i=>i.id===editingId?itemForm(i):
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
const ord=n=>{if(!n)return '?';const v=n%100;return n+((v>=11&&v<=13)?'th':({1:'st',2:'nd',3:'rd'}[n%10]||'th'))};
function renderInst(){
  const start=cycleStart();
  const loans=S.items.filter(i=>i.kind==='loan');
  const addM=(d,m)=>new Date(d.getFullYear(),d.getMonth()+m,Math.min(d.getDate(),dim(new Date(d.getFullYear(),d.getMonth()+m,1).getFullYear(),new Date(d.getFullYear(),d.getMonth()+m,1).getMonth())));
  let monthly=0,remaining=0,last=null;
  const html=loans.map(i=>{
    const left=Math.max(0,Math.round(num(i.left))),pay=num(i.amount),total=Math.round(num(i.total))||null;
    const next=dueDate(dayOf(i),start),end=left>0?addM(next,isPaid(i)?left:left-1):null;
    if(left>0){monthly+=pay;remaining+=pay*left;if(!last||end>last)last=end}
    const done=total?Math.max(0,total-left):null;
    return `<div class="loan">
      <div class="loan-h"><div><h3>${esc(i.name)}${last4Of(i)?`<span class="l4">•••• ${esc(last4Of(i))}</span>`:''}</h3><span class="muted small">${i.rate!=null&&i.rate!==''?num(i.rate)+'%'+(i.addon?' add-on':'')+'/mo · ':''}due every ${ord(num(i.day))}</span></div><span class="pay">${peso(pay)}<span class="muted small">/mo</span></span></div>
      ${total?`<div class="bar" role="img" aria-label="${done} of ${total} paid"><i style="width:${Math.round(done/total*100)}%"></i></div>`:''}
      <div class="facts">${total?`<span><b>${done}/${total}</b> paid</span>`:''}<span><b>${left}</b> left</span><span><b>${peso(pay*left)}</b> to go</span><span>Ends <b>${end?MON[end.getMonth()]+' '+end.getFullYear():'—'}</b></span></div>
      <div class="acts">${isPaid(i)?`<span class="pill ok">Paid</span>${!isHiddenPaid(i)?undoBtn(`data-iundo="${i.id}"`,i.name):''}`:''}${last4Of(i)?'':`<button class="pill warn ask4" data-iedit4="${i.id}">Add last 4</button>`}${editBtn(`data-iedit="${i.id}"`,i.name)}${left>0&&!isPaid(i)?paidBtn(`data-ipaid="${i.id}"`,i.name):''}</div>
    </div>`;
  }).join('');
  $('#instSum').innerHTML=`<div><span class="label">Per month</span><span class="v">${peso(monthly)}</span></div><div><span class="label">Still to pay</span><span class="v">${peso(remaining)}</span></div><div><span class="label">All done by</span><span class="v">${last?MON[last.getMonth()]+' '+last.getFullYear():'—'}</span></div>`;
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
const loansIn=(start,skipPaid)=>{const end=shiftCycle(start,1);return S.items.filter(l=>l.kind==='loan'&&num(l.amount)>0&&!(skipPaid&&isPaid(l)&&inCycle(l,start))).reduce((s,l)=>s+num(l.amount)*loanDates(l).filter(d=>d>=start&&d<end).length,0)};
const fixedIn=start=>S.items.filter(i=>(i.kind==='essential'||i.kind==='bill')&&inCycle(i,start)).reduce((s,i)=>s+num(i.amount),0);
function nextFree(){
  const next=shiftCycle(cycleStart(),1);
  return num(S.salary)-fixedIn(next)-loansIn(next);
}
let needOverride=null;
function quote(s,need){
  const f=Math.min(0.99,num(s.fee)/100),n=Math.max(1,Math.round(num(s.term)||1)),avail=num(s.avail);
  let B=need/(1-f),capped=false;if(avail>0&&B>avail){B=avail;capped=true}
  const net=B*(1-f),k=known(s),p=k?payFor(s,B,n):null;
  return {s,B,net,n,p,capped,known:k,limitSet:avail>0,e:k?effRate(s):null,cost:p===null?null:p*n-net};
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
      ${alts.length?`<div class="meta">${alts.map(t=>{const p=payFor(q.s,q.B,t);return `${t} mo: <b>${peso(p)}</b>/mo, cost <b>${peso(p*t-q.net)}</b>`}).join(' · ')}</div>`:''}
    </div><div class="right"><span class="cost">${peso(q.cost)}<small>interest + fees</small></span><span class="pill ${best?'ok':bad?'bad':'warn'}">${best?'Cheapest':bad?'Expensive':'Okay'}</span></div></div>`;
  }).join('');
  let rem=need;const parts=[];
  qs.filter(q=>q.known).forEach(q=>{
    if(rem<=0.004)return;
    const f=Math.min(0.99,num(q.s.fee)/100),avail=num(q.s.avail);
    const net=avail>0?Math.min(rem,avail*(1-f)):rem,B=net/(1-f),p=payFor(q.s,B,q.n);
    parts.push({q,B,p,cost:p*q.n-net});rem-=net;
  });
  if(!parts.length){box.innerHTML='';return}
  const newMonthly=parts.reduce((s,x)=>s+(x.q.n>1?x.p:0),0),nf=nextFree();
  box.innerHTML=`<div class="reco ok"><h3>Best option</h3><ul>${parts.map(x=>`<li><span>${esc(x.q.s.name)} · borrow ${peso(x.B)}</span><span class="a">${x.q.n===1?'repay '+peso(x.p):peso(x.p)+' × '+x.q.n}</span></li>`).join('')}</ul>
    <p class="small">Costs <b class="num">${peso(parts.reduce((s,x)=>s+x.cost,0))}</b> in interest and fees.${newMonthly>0?` Adds ${peso(newMonthly)} a month; ${newMonthly>nf?'<b style="color:var(--bad)">next month would be short too.</b>':'next month should still fit.'}`:''}</p>
    ${rem>0.004?`<p class="small" style="color:var(--bad)">Still ${peso(rem)} short after every creditor.</p>`:''}</div>`;
}
function renderSrcList(){
  $('#srcList').innerHTML=S.sources.map(s=>`<div class="form" data-sid="${s.id}">
    <div class="field wide"><label for="sn${s.id}">Creditor</label><input id="sn${s.id}" data-k="name" value="${esc(s.name)}"></div>
    <div class="field"><label for="sa${s.id}">Available (₱)</label><input id="sa${s.id}" data-k="avail" type="number" min="0" step="0.01" value="${s.avail??''}"></div>
    <div class="field"><label for="sr${s.id}">Interest %/mo</label><input id="sr${s.id}" data-k="rate" type="number" min="0" step="0.01" value="${s.rate??''}"></div>
    <div class="field"><label for="sy${s.id}">Rate type</label><select id="sy${s.id}" data-k="addon"><option value="0" ${s.addon?'':'selected'}>Diminishing</option><option value="1" ${s.addon?'selected':''}>Add-on</option></select></div>
    <div class="field"><label for="sf${s.id}">Upfront fee %</label><input id="sf${s.id}" data-k="fee" type="number" min="0" step="0.01" value="${s.fee??''}"></div>
    <div class="field"><label for="st${s.id}">Term (months)</label><input id="st${s.id}" data-k="term" type="number" min="1" value="${s.term??''}"></div>
    <div class="field"><label for="sx${s.id}">Other terms</label><input id="sx${s.id}" data-k="terms" placeholder="3,6,12" value="${esc(s.terms||'')}"></div>
    <div class="acts">${delBtn(`data-sdel="${s.id}"`,"Remove "+(s.name||"creditor"))}</div></div>`).join('');
}

// ---------- plan ahead ----------
function renderAhead(C){
  const salary=num(S.salary);
  const loans=S.items.filter(i=>i.kind==='loan'&&num(i.amount)>0);
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
let acctEditing=null;
function nextOn(day){
  const t=new Date();t.setHours(0,0,0,0);let y=t.getFullYear(),m=t.getMonth();
  let d=new Date(y,m,Math.min(day,dim(y,m)));if(d<t){m++;d=new Date(new Date(y,m,1).getFullYear(),new Date(y,m,1).getMonth(),Math.min(day,dim(new Date(y,m,1).getFullYear(),new Date(y,m,1).getMonth())))}
  return d;
}
const usedOf=a=>{const b=billOf(a);return b&&b.kind==='card'&&!isPaid(b)?num(b.amount):0};
const ucls=p=>p>50?'bad':p>30?'warn':'';
function acctForm(a){
  return `<div class="form" data-aid="${a.id}">
    <div class="field wide"><label for="an${a.id}">Card name</label><input id="an${a.id}" data-k="name" value="${esc(a.name)}"></div>
    <div class="field"><label for="a4${a.id}">Last 4 digits</label><input id="a4${a.id}" data-k="last4" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="1234" autocomplete="off" value="${esc(a.last4||'')}"><span class="hint">Matches BillBuddy bills.</span></div>
    <div class="field"><label for="al${a.id}">Credit limit (₱)</label><input id="al${a.id}" data-k="limit" type="number" min="0" step="0.01" value="${a.limit??''}"></div>
    <div class="field"><label for="as${a.id}">Statement day</label><input id="as${a.id}" data-k="stmt" type="number" min="1" max="31" value="${a.stmt??''}"></div>
    <div class="field"><label for="ad${a.id}">Payment due day</label><input id="ad${a.id}" data-k="due" type="number" min="1" max="31" value="${billOf(a)?.day??''}"></div>
    <div class="acts">${delBtn(`data-adel="${a.id}"`,"Remove "+(a.name||"card"))}<button class="btn" data-adone="1">Done</button></div>
  </div>`;
}
function renderAccounts(){
  let lim=0,used=0;
  const html=S.accounts.map(a=>{
    if(a.id===acctEditing)return acctForm(a);
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
  acct:()=>{if(acctEditing==null)renderAccounts()}, bills:()=>renderItems(), money:()=>renderIncome(), src:()=>renderSrcList()
};
const JOB_PANEL={src:'borrow'};
const stale=new Set();
const shown=job=>!$('#panel-'+(JOB_PANEL[job]||job)).hidden;
function runJobs(jobs,C){jobs.forEach(j=>{if(shown(j)){stale.delete(j);JOBS[j](C||compute())}else stale.add(j)})}
function render(){const C=compute();renderStatus(C);runJobs(['cycle','inst','borrow','ahead','acct'],C)}
function renderAll(){runJobs(['bills','money','src']);render()}
function flushStale(){if(!stale.size)return;const C=compute();[...stale].forEach(j=>{if(shown(j)){stale.delete(j);JOBS[j](C)}})}
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

$('#itemList').addEventListener('input',e=>{
  const row=e.target.closest('.form');if(!row)return;const it=S.items.find(i=>i.id==row.dataset.id),k=e.target.dataset.k;if(!it||!k)return;
  if(k==='cat'){const c=S.cats.find(x=>x.key===e.target.value);if(!c)return;it.cat=c.key;setKind(it,c.kind);ensureLinks();commit();renderItems();const f=$('#k'+it.id);f&&f.focus();return}
  if(k==='repeat'){
    if(e.target.checked){delete it.once;const d=parseD(it.date);if(d){it.day=d.getDate();delete it.date}}
    else{it.once=true;it.date=it.date||iso(dueOf(it,cycleStart()));delete it.until}
    commit();renderItems();const f=$('#rp'+it.id);f&&f.focus();return}
  if(k==='last4'){const v=e.target.value.replace(/\D/g,'').slice(0,4);if(v!==e.target.value)e.target.value=v;
    const a=it.kind==='card'&&acctOf(it);if(a)a.last4=v;else if(v)it.bbLast4=v;else delete it.bbLast4;commit();renderAccounts();return}
  if(k==='until'||k==='date'){if(e.target.value)it[k]=e.target.value;else delete it[k];commit();return}
  it[k]=k==='name'?e.target.value:(e.target.value===''?null:num(e.target.value));
  if(k==='name'){const a=acctOf(it);if(a)a.name=it.name}
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
  if(t.dataset.del){S.items=S.items.filter(i=>i.id!=t.dataset.del);editingId=null;save();renderAll();return}
  if(t.dataset.edit){editingId=+t.dataset.edit;renderItems();const f=$('#a'+editingId);f&&f.focus();return}
  if(t.dataset.done){const it=S.items.find(i=>i.id===editingId);if(it&&!it.name.trim()){it.name='New bill';save()}editingId=null;renderItems();render();return}
  const id=t.dataset.paid||t.dataset.unpaid;if(!id)return;const it=S.items.find(i=>i.id==id);if(!it)return;
  t.dataset.paid?markPaid(it):undoPaid(it);save();renderItems();render();
});
function deleteCat(c,to){
  if(to){S.items.forEach(i=>{if(i.cat===c.key){i.cat=to.key;setKind(i,to.kind)}})}
  S.cats=S.cats.filter(x=>x!==c);catEditing=null;catDeleting=false;ensureLinks();save();renderAll();renderCats();
}
$('#addBtn').addEventListener('click',()=>{
  const c=S.cats.find(x=>x.kind==='bill')||S.cats[0];
  const it={id:uid++,name:'New bill',kind:c.kind,cat:c.key,amount:null,day:clampPd()};
  if(c.kind==='loan')Object.assign(it,{left:null,total:null,rate:null});
  S.items.push(it);ensureLinks();editingId=it.id;save();renderItems();render();const f=$('#n'+it.id);f&&(f.focus(),f.select());
});
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


function openEdit(id){editingId=id;selectTab('bills');renderItems();const f=$('#n'+id);f&&f.focus()}
$('#instList').addEventListener('click',e=>{
  const t=e.target.closest('button');if(!t)return;
  const id=t.dataset.ipaid||t.dataset.iundo||t.dataset.iedit||t.dataset.iedit4,it=S.items.find(i=>i.id==id);if(!it)return;
  if(t.dataset.iedit){openEdit(it.id);return}
  if(t.dataset.iedit4){openEdit(it.id);const f=$('#f4'+it.id);f&&f.focus();return}
  t.dataset.ipaid?markPaid(it):undoPaid(it);save();renderItems();render();
});
$('#instAdd').addEventListener('click',()=>{const it={id:uid++,name:'New installment',kind:'loan',amount:null,day:clampPd(),left:null,total:null,rate:null};S.items.push(it);save();render();openEdit(it.id)});

$('#incList').addEventListener('input',e=>{
  const row=e.target.closest('.inc');if(!row)return;const x=S.income.find(o=>o.id==row.dataset.iid),k=e.target.dataset.k;if(!x||!k)return;
  x[k]=k==='amount'?(e.target.value===''?null:num(e.target.value)):e.target.value;
  const t=incTag(x),tag=$('#tag'+x.id);if(tag){tag.textContent=t.t;tag.className='tag '+t.c}
  renderIncSum();commit();
});
$('#incList').addEventListener('click',e=>{const id=e.target.closest('button')?.dataset.incdel;if(!id)return;S.income=S.income.filter(o=>o.id!=id);save();renderIncome();render()});
$('#incAdd').addEventListener('click',()=>{const x={id:uid++,label:'',amount:null,date:iso(new Date())};S.income.push(x);save();renderIncome();render();
  const row=document.querySelector(`.inc[data-iid="${x.id}"] input`);row&&row.focus()});

$('#srcList').addEventListener('input',e=>{
  const row=e.target.closest('.form');if(!row)return;const s=S.sources.find(x=>x.id==row.dataset.sid),k=e.target.dataset.k;if(!s||!k)return;
  s[k]=k==='name'||k==='terms'?e.target.value:k==='addon'?e.target.value==='1':(e.target.value===''?null:num(e.target.value));commit();
});
$('#srcList').addEventListener('click',e=>{const id=e.target.closest('button')?.dataset.sdel;if(!id)return;S.sources=S.sources.filter(s=>s.id!=id);save();renderSrcList();render()});
$('#srcAdd').addEventListener('click',()=>{const s={id:uid++,name:'New creditor',avail:null,rate:null,fee:0,term:12};S.sources.push(s);save();renderSrcList();render();const f=$('#sn'+s.id);f&&(f.focus(),f.select())});

$('#resetBtn').addEventListener('click',()=>{$('#resetConfirm').hidden=false});
$('#resetNo').addEventListener('click',()=>{$('#resetConfirm').hidden=true});
$('#resetYes').addEventListener('click',()=>{const bb=S.bb;S=clone(DEFAULTS);if(bb)S.bb=bb;prepare();editingId=null;save();syncInputs();$('#resetConfirm').hidden=true;renderAll()});
$('#acctList').addEventListener('input',e=>{
  const row=e.target.closest('.form');if(!row)return;const a=S.accounts.find(x=>x.id==row.dataset.aid),k=e.target.dataset.k;if(!a||!k)return;
  if(k==='last4'){const v=e.target.value.replace(/\D/g,'').slice(0,4);if(v!==e.target.value)e.target.value=v;a.last4=v}
  else if(k==='due'){const b=billOf(a);if(b){b.day=e.target.value===''?null:num(e.target.value);delete b.bbDue}}
  else{a[k]=k==='name'?e.target.value:(e.target.value===''?null:num(e.target.value));if(k==='name'){const b=billOf(a);if(b)b.name=a.name}}
  commit();
});
$('#acctList').addEventListener('click',e=>{
  const t=e.target.closest('button');if(!t)return;
  if(t.dataset.aedit){acctEditing=+t.dataset.aedit;renderAccounts();const f=$('#al'+acctEditing);f&&f.focus();return}
  if(t.dataset.aedit4){acctEditing=+t.dataset.aedit4;renderAccounts();const f=$('#a4'+acctEditing);f&&f.focus();return}
  if(t.dataset.adone){acctEditing=null;renderAccounts();renderItems();return}
  if(t.dataset.adel){const a=S.accounts.find(x=>x.id==t.dataset.adel);const b=a&&billOf(a);if(b){delete b.acct;b.noAcct=true}S.accounts=S.accounts.filter(x=>x.id!=t.dataset.adel);acctEditing=null;save();renderAccounts();renderItems()}
});
$('#acctAdd').addEventListener('click',()=>{const a={id:uid++,key:genKey(),name:'New card',last4:'',limit:null,stmt:null};S.accounts.push(a);S.items.push({id:uid++,name:a.name,kind:'card',amount:null,day:clampPd(),acct:a.key});renderItems();render();acctEditing=a.id;save();renderAccounts();const f=$('#an'+a.id);f&&(f.focus(),f.select())});
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
  let changed=false;const claimed=new Set();
  bills.forEach(b=>{
    const bank=squash(b.bank),due=parseD(b.due_date),amt=num(b.amount);
    if(!bank||!due||!(amt>0))return;
    const kind=bbKind(b),l4=String(b.last4||'').replace(/\D/g,'').slice(-4),key=b.account_key||null;
    const ofBank=i=>squash(i.name).includes(bank),free=i=>!claimed.has(i)&&(!i.bbKey||i.bbKey===key);
    // same account as last time, then same last 4 digits (same type first, then any), then same bank and type
    // (several loans at one bank: the one with this amount, then this due day)
    let it=(key&&S.items.find(i=>i.bbKey===key&&!claimed.has(i)))
      ||(l4&&S.items.find(i=>i.kind===kind&&free(i)&&last4Of(i)===l4))
      ||(l4&&S.items.find(i=>free(i)&&last4Of(i)===l4))
      ||(()=>{const c=S.items.filter(i=>i.kind===kind&&free(i)&&ofBank(i)&&!(l4&&last4Of(i)));
        return c.find(i=>near(i.amount,amt))||c.find(i=>num(i.day)===due.getDate())||(c.length===1?c[0]:null)})();
    // an earlier sync filed this statement under the wrong type (a loan as "UnionBank CC"): fix or drop that copy
    const wrong=S.items.filter(i=>i!==it&&i.kind!==kind&&!claimed.has(i)&&i.bbDue===b.due_date&&near(i.amount,amt)&&ofBank(i));
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
      if(kind==='loan')Object.assign(it,{left:null,total:null});
      S.items.push(it);ensureLinks();changed=true;
    }
    claimed.add(it);
    if(key&&it.bbKey!==key){it.bbKey=key;changed=true}
    // the card's last 4 digits go on its account; other bills keep them on the bill
    if(l4){const a=it.kind==='card'&&acctOf(it);
      if(a){if(a.last4!==l4){a.last4=l4;changed=true}}else if(it.bbLast4!==l4){it.bbLast4=l4;changed=true}}
    // remember the statement you marked paid, so it is not brought back after payday
    if(isPaid(it)){if(it.bbDue&&it.bbPaidDue!==it.bbDue){it.bbPaidDue=it.bbDue;changed=true}return}
    if(it.bbPaidDue===b.due_date)return;
    if(num(it.amount)===amt&&num(it.day)===due.getDate()&&it.bbDue===b.due_date)return;
    it.amount=amt;it.day=due.getDate();it.bbDue=b.due_date;changed=true;
  });
  // copies an older sync made before bill types were sent (e.g. a loan saved as "UnionBank CC"), even from an
  // earlier statement: filled in by BillBuddy, not matched this time, and the same amount as a bill of
  // another type from that bank
  if(bills.some(bbTyped))S.items.filter(i=>!claimed.has(i)&&i.bbDue&&!i.bbKey).forEach(i=>{
    if(bills.some(b=>bbTyped(b)&&bbKind(b)!==i.kind&&squash(i.name).includes(squash(b.bank))&&near(i.amount,b.amount))){removeItem(i);changed=true}
  });
  if(changed){ensureLinks();save();if(editingId==null)renderItems();render()}
  const t=new Date();
  bbState('ok',`Synced ${bills.length} bill${bills.length===1?'':'s'} at ${t.getHours()%12||12}:${String(t.getMinutes()).padStart(2,'0')} ${t.getHours()<12?'AM':'PM'}`);
}
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
const aiConf=()=>S.ai||{};
const aiModel=()=>AI_PRICE[aiConf().model]?aiConf().model:'claude-opus-5-5';
const aiState=(cls,txt)=>{const el=$('#aiState');el.className='sync '+cls;el.textContent=txt};
function fillAI(){const c=aiConf();$('#aiKey').value=c.key||'';$('#aiModel').value=aiModel();aiState(c.key?'ok':'off',c.key?'Ready':'Not connected');aiNote()}
function aiNote(){$('#aiNote').textContent=aiConf().key?'Then asks '+$('#aiModel').selectedOptions[0].text.split(' –')[0]:'Add a key in API for AI advice'}
$('#aiKey').addEventListener('change',()=>{const key=$('#aiKey').value.trim();if(key)S.ai={...aiConf(),key,model:aiModel()};else delete S.ai;save();fillAI()});
$('#aiModel').addEventListener('change',()=>{S.ai={...aiConf(),model:$('#aiModel').value};save();aiNote()});
$('#aiClear').addEventListener('click',()=>{delete S.ai;save();fillAI()});
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
  const eff=f.type==='inst'?effRate({rate:f.rate,addon:f.addon,fee:0,term:f.term})*100:null;
  return {f,plan,rows,buffer,safe:Math.floor(safe/100)*100,worst,total,interest:total-f.amt,eff,verdict,covered,shortNow:rows[0].before<0};
}
function readLoanForm(){
  const amt=num($('#aiAmt').value),type=$('#aiType').value,due=parseD($('#aiDue').value),term=Math.round(num($('#aiTerm').value)),rate=num($('#aiRate').value);
  if(!(amt>0))return 'Enter how much you want to borrow.';
  if(type==='inst'&&!(term>=1&&term<=60))return 'Enter how many months, from 1 to 60.';
  if(!due)return 'Pick the '+(type==='inst'?'first due date':'due date')+'.';
  return {amt,type,due,term:type==='inst'?term:1,rate,addon:$('#aiAddon').value==='1',why:$('#aiWhy').value.trim().slice(0,120)};
}
function syncLoanForm(){const inst=$('#aiType').value==='inst';$('#aiTermF').hidden=!inst;$('#aiAddonF').hidden=!inst;
  $('#aiRateL').textContent=inst?'Interest %/month':'Interest or fee (%)';$('#aiDueL').textContent=inst?'First due date':'Due date'}
$('#aiType').addEventListener('change',syncLoanForm);syncLoanForm();
const VERDICT={yes:['ok','You can afford it'],careful:['warn','Tight, but possible'],no:['bad','Not without falling short']};
function renderLoanCheck(R){
  const [cls,word]=VERDICT[R.verdict],f=R.f,per=f.type==='inst'?R.plan[0].amt:R.total;
  return `<div class="reco ${cls==='bad'?'bad':'ok'} aiv"><div class="aiv-h"><span class="pill ${cls}">${word}</span><span class="muted small">Planner's check</span></div>
    <h3>${f.type==='inst'?`${peso(per)} a month for ${f.term} month${f.term===1?'':'s'}`:`Pay back ${peso(R.total)} on ${fmtD(f.due)}`}</h3>
    <ul><li><span>Interest</span><span class="a">${peso(R.interest)}</span></li>
      ${R.eff!=null?`<li><span>Real rate /mo</span><span class="a">${R.eff.toFixed(2)}%</span></li>`:''}
      <li><span>Tightest cycle${isFinite(R.worst.after)?' ('+fmtD(R.worst.start)+')':''}</span><span class="a">${isFinite(R.worst.after)?peso(R.worst.after)+' left':'—'}</span></li>
      <li><span>Safe to borrow</span><span class="a"><b>${peso(R.safe)}</b></span></li></ul>
    <p class="note">Safe = every cycle keeps your ${peso(R.buffer)} buffer. Card bills are estimated from this cycle.${R.shortNow?' You\'re already short this cycle.':''}</p>
    <details class="paidlist"><summary>By pay cycle</summary><div class="cyc">${R.rows.map(x=>`<div class="cycrow${x.after<0?' neg':''}"><span>${fmtD(x.start)} – ${fmtD(x.end)}</span><span class="num">${peso(x.before)}${x.pay?` − ${peso(x.pay)}`:''}</span><span class="num">${peso(x.after)}</span></div>`).join('')}</div>
    <p class="note">After bills − loan = left</p></details></div>`;
}

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
    new_loan:{amount:r2(f.amt),repayment:f.type==='inst'?'installments':'one-time',months:f.type==='inst'?f.term:undefined,
      interest_pct:f.rate,rate_type:f.type==='inst'?(f.addon?'add-on':'diminishing'):undefined,first_due:d(f.due),purpose:f.why||undefined,
      payment_each:r2(R.plan[0].amt),total_repay:r2(R.total),total_interest:r2(R.interest),real_monthly_rate_pct:R.eff!=null?r2(R.eff):undefined},
    planner_check:{verdict:R.verdict,safe_amount:R.safe,tightest_cycle_left:isFinite(R.worst.after)?r2(R.worst.after):null,already_short_this_cycle:R.shortNow},
    cycles:R.rows.map(x=>({start:d(x.start),money_in:r2(x.money),bills:r2(x.bills),new_loan_payment:r2(x.pay),left_after:r2(x.after)})),
    installments:S.items.filter(i=>i.kind==='loan'&&num(i.amount)>0).map(i=>({name:i.name,monthly:r2(num(i.amount)),payments_left:num(i.left),rate_pct_month:i.rate??undefined})),
    cards:S.accounts.map(a=>{const b=billOf(a);return {name:a.name,statement:r2(num(b?.amount)),limit:num(a.limit)||undefined}}),
    other_bills:S.items.filter(i=>i.kind!=='loan'&&i.kind!=='card'&&num(i.amount)>0).map(i=>({name:i.name,amount:r2(num(i.amount)),type:catOf(i)?.name})),
    creditors:S.sources.filter(x=>known(x)).map(x=>({name:x.name,rate_pct_month:num(x.rate),rate_type:x.addon?'add-on':'diminishing',available:num(x.avail)||undefined}))};
}
async function askAI(R){
  const {key}=aiConf(),model=aiModel(),summary=JSON.stringify(aiSummary(R)),memoKey=model+summary;
  if(aiMemo.has(memoKey))return aiMemo.get(memoKey); // the same question twice costs nothing
  const SDK=await loadAISdk();
  const client=new SDK.Anthropic({apiKey:key,dangerouslyAllowBrowser:true,maxRetries:1});
  const req={model,max_tokens:4000,output_config:{effort:'low',format:SDK.jsonSchemaOutputFormat(AI_SCHEMA)},system:AI_SYSTEM,
    messages:[{role:'user',content:'Should I take this loan? Planner summary:\n'+summary}]};
  // Opus and Sonnet can retry a declined request on another model; Haiku has no server-side fallback
  if(model!=='claude-haiku-5-5')Object.assign(req,{betas:['server-side-fallback-2026-07-01'],fallbacks:'default'});
  const res=await client.beta.messages.parse(req);
  if(res.stop_reason==='refusal')throw Object.assign(new Error('refusal'),{kind:'refusal'});
  if(res.stop_reason==='max_tokens'||!res.parsed_output)throw Object.assign(new Error('incomplete'),{kind:'incomplete'});
  const [pin,pout]=AI_PRICE[model],u=res.usage||{};
  const out={a:res.parsed_output,cost:((u.input_tokens||0)*pin+(u.output_tokens||0)*pout)/1e6,model:res.model||model};
  aiMemo.set(memoKey,out);return out;
}
function aiError(e){
  const A=window.AnthropicSDK?.Anthropic;
  if(e.message==='load')return 'Could not load the AI library. Check your connection.';
  if(e.kind==='refusal')return 'Claude declined to answer this one. The planner\'s check above still applies.';
  if(e.kind==='incomplete')return 'Claude\'s answer was cut off. Try again.';
  if(A&&e instanceof A.AuthenticationError)return 'The API key was not accepted. Check it in the API tab.';
  if(A&&e instanceof A.PermissionDeniedError)return 'This API key is not allowed to use that model.';
  if(A&&e instanceof A.RateLimitError)return 'Too many requests or no credit left on the key. Try again later.';
  if(A&&e instanceof A.BadRequestError)return 'The AI could not read the request: '+e.message;
  if(A&&e instanceof A.APIConnectionError)return 'Could not reach Anthropic. Check your connection.';
  if(A&&e instanceof A.APIError)return 'The AI service had a problem ('+e.status+'). Try again.';
  return 'Something went wrong asking the AI.';
}
let aiRun=0;
$('#aiForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const f=readLoanForm(),out=$('#aiOut');
  if(typeof f==='string'){out.innerHTML=`<p class="t-bad small">${f}</p>`;return}
  const R=loanCheck(f),run=++aiRun;
  out.innerHTML=renderLoanCheck(R)+(aiConf().key?'<div class="aibox" id="aiAns"><p class="muted small">Asking Claude…</p></div>':'');
  if(!aiConf().key)return;
  const btn=$('#aiGo');btn.disabled=true;
  try{
    const {a,cost,model}=await askAI(R);if(run!==aiRun)return;
    const [cls,word]=VERDICT[a.verdict]||VERDICT.careful;
    $('#aiAns').innerHTML=`<div class="aiv-h"><span class="pill ${cls}">${word}</span><span class="muted small">Claude's view</span></div>
      <p class="aih">${esc(a.headline)}</p>${a.reasons.length?`<ul>${a.reasons.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}
      ${a.tips.length?`<p class="label">Tips</p><ul>${a.tips.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}
      <p class="note">${model} · cost ~$${cost<0.001?cost.toFixed(5):cost.toFixed(3)}</p>`;
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
  if(!cloudReady||cloudTimer||pushing)return;
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
  $('#authBtn').hidden=!cloudUser;
  $('#authForm').hidden=!sb||!authKnown||!!cloudUser;
  $('#authWho').textContent=cloudUser?.email||'';$('#authWho').title=cloudUser?.email||'';
}
function signedOut(){
  cloudUser=null;cloudReady=false;clearTimeout(cloudTimer);cloudTimer=null;
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

// ---------- updates ----------
// A tab left open keeps running the code it loaded with. When a newer version is published, reload, so an
// old copy never syncs BillBuddy with outdated rules and saves that to the account.
const APP_V=(/[?&]v=(\w+)/.exec(document.currentScript?.getAttribute('src')||'')||[])[1];
async function checkUpdate(){
  if(!APP_V)return;
  try{
    const html=await (await fetch(location.pathname,{cache:'no-store'})).text();
    const v=(/app\.js\?v=(\w+)/.exec(html)||[])[1];
    if(!v||v===APP_V||cloudTimer||pushing||document.activeElement?.matches?.('input,select'))return;
    location.reload();
  }catch(e){}
}
setInterval(checkUpdate,5*60000);
