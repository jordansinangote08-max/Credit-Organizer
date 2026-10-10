const KEY='sahodplan.v1';
const KINDS={essential:'Rent / food / allowance',bill:'Utilities & bills',loan:'Installment loan',card:'Credit card',flex:'Can be cut'};
const DEFAULTS={salary:39000,payday:24,thirteenth:0,efund:5000,buffer:2000,income:[],items:[
 {name:'House rent',kind:'essential',amount:4000,day:24},
 {name:'Work allowance',kind:'essential',amount:3000,day:24},
 {name:'Groceries / food at home',kind:'essential',amount:0,day:24},
 {name:'Electricity, water, load',kind:'bill',amount:0,day:24},
 {name:'UnionBank Loan A',kind:'loan',amount:4384.71,day:24,left:6,rate:2.49},
 {name:'UnionBank Loan B',kind:'loan',amount:3897.52,day:26,left:9,rate:2.49},
 {name:'Mari Loan',kind:'loan',amount:7256.67,day:26,left:3,rate:null},
 {name:'UnionBank CC',kind:'card',amount:2133.13,day:26,rate:3},
 {name:'RCBC CC',kind:'card',amount:8263.94,day:28,rate:3},
 {name:'Maya Credit',kind:'card',amount:5578.14,day:30,rate:3},
 {name:'Maribank CC',kind:'card',amount:2401.66,day:5,rate:3},
 {name:'EastWest CC',kind:'card',amount:4723.29,day:13,rate:3}
]};
const SRC_DEFAULT=[{name:'Mari Loan credit line',avail:30000,rate:null,fee:null,term:12}];
const SRC_TPL=[
 {name:'SSS Salary Loan',avail:null,rate:0.83,fee:1,term:24},
 {name:'Pag-IBIG Multi-Purpose Loan',avail:null,rate:0.88,fee:0,term:24},
 {name:'Company / coop loan',avail:null,rate:null,fee:0,term:12},
 {name:'Family or friend',avail:null,rate:0,fee:0,term:1},
 {name:'Credit card cash advance',avail:null,rate:3,fee:3,term:3}
];
const clone=o=>JSON.parse(JSON.stringify(o));
const $=s=>document.querySelector(s);
const num=v=>{const n=parseFloat(v);return isFinite(n)?n:0};
const peso=n=>'₱'+(Math.round(n*100)/100).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WD=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const fmtD=d=>MON[d.getMonth()]+' '+d.getDate();
const iso=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const parseD=s=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||'');return m?new Date(+m[1],+m[2]-1,+m[3]):null};

let uid=1,S;
try{S=JSON.parse(localStorage.getItem(KEY))}catch(e){S=null}
if(!S||!Array.isArray(S.items))S=clone(DEFAULTS);

// ---------- dates ----------
const clampPd=()=>Math.min(31,Math.max(1,Math.round(num(S.payday))||24));
const dim=(y,m)=>new Date(y,m+1,0).getDate();
function shiftCycle(start,k){const f=new Date(start.getFullYear(),start.getMonth()+k,1);return new Date(f.getFullYear(),f.getMonth(),Math.min(clampPd(),dim(f.getFullYear(),f.getMonth())))}
// The cycle you're living in, switching to the upcoming one in the last 16 days before payday so you can plan it.
function cycleStart(){
  const t=new Date();t.setHours(0,0,0,0);
  let p0=shiftCycle(new Date(t.getFullYear(),t.getMonth(),1),0);
  if(p0>t)p0=shiftCycle(p0,-1);
  const p1=shiftCycle(p0,1);
  return (p1-t)<=16*86400000?p1:p0;
}
function dueDate(day,start){
  let y=start.getFullYear(),m=start.getMonth();
  if(day<start.getDate()){m++;if(m>11){m=0;y++}}
  return new Date(y,m,Math.min(day,dim(y,m)));
}
const dayOf=i=>Math.min(31,Math.max(1,num(i.day)||1));

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
}
const billOf=a=>S.items.find(i=>i.acct===a.key);
const acctOf=i=>i.acct?S.accounts.find(a=>a.key===i.acct):null;

// ---------- saving ----------
let cloud=null,cloudTimer=null,cloudReady=false;
function setSync(cls,txt){const el=$('#syncState');el.className='sync '+cls;el.textContent=txt}
const snapshot=()=>JSON.stringify(S,(k,v)=>k==='id'?undefined:v);
function save(){
  try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}
  if(!cloud||!cloudReady)return;
  clearTimeout(cloudTimer);setSync('busy','Saving…');
  cloudTimer=setTimeout(async()=>{
    try{await cloud.set({state:snapshot(),savedAt:Date.now()});setSync('ok','Saved to your account')}
    catch(e){setSync('off','Not saved to cloud. Kept on this device.')}
  },700);
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
  const lines=S.items.filter(i=>num(i.amount)>0).map(i=>{
    const tier=i.kind==='essential'||i.kind==='bill'?1:i.kind==='loan'?2:i.kind==='card'?3:5;
    return {i,tier,date:dueDate(dayOf(i),start),need:num(i.amount)};
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
    box.innerHTML=`<div class="reco bad"><h3>You're ${peso(C.gap)} short</h3><p class="small">Your salary${C.other?' and other money':''} won't cover every bill this cycle. See the cheapest way to cover it.</p><div><button class="btn" data-goto="borrow">See options</button></div></div>`;
    return;
  }
  const buffer=Math.max(0,num(S.buffer)),extra=C.surplus-buffer;
  const bufInput=`<div class="bufrow"><label for="buffer">Keep on hand as a buffer</label><span>₱</span><input id="buffer" type="number" min="0" step="100" value="${num(S.buffer)}"></div>`;
  if(C.surplus<=0.004){box.innerHTML='';return}
  if(extra<=0.004){
    box.innerHTML=`<div class="reco ok"><h3>All bills covered</h3><p class="small">The ${peso(C.surplus)} left is within your buffer. Keep it for surprises.</p>${bufInput}</div>`;
    return;
  }
  // pay-ahead candidates: next cycle's installments (costliest first), then next cycle's fixed bills
  const recs=[];
  S.items.filter(i=>i.kind==='loan'&&num(i.amount)>0).forEach(i=>{
    const after=isPaid(i)?num(i.left):num(i.left)-1;
    if(after>0)recs.push({i,amt:num(i.amount),date:dueDate(dayOf(i),C.next),why:`next installment${i.rate!=null?` · ${num(i.rate)}%${i.addon?' add-on':''}/mo`:''}`,rank:realRate(i)});
  });
  recs.sort((a,b)=>b.rank-a.rank);
  S.items.filter(i=>(i.kind==='essential'||i.kind==='bill')&&num(i.amount)>0).sort((a,b)=>dueDate(dayOf(a),C.next)-dueDate(dayOf(b),C.next))
    .forEach(i=>recs.push({i,amt:num(i.amount),date:dueDate(dayOf(i),C.next),why:'next month',rank:0}));
  let pool=extra;const picks=[];
  recs.forEach(r=>{if(pool<=0.004)return;const p=Math.min(pool,r.amt);pool-=p;picks.push({...r,p})});
  box.innerHTML=`<div class="reco ok"><h3>You have ${peso(extra)} extra</h3>
    <p class="small">Pay these ahead so next cycle starts lighter. Costliest installments come first.</p>
    <ul>${picks.map(r=>`<li><span>${esc(r.i.name)} <span class="muted small">· due ${fmtD(r.date)} · ${r.why}${r.p<r.amt-0.004?` · part of ${peso(r.amt)}`:''}</span></span><span class="a">${peso(r.p)}</span></li>`).join('')}
    ${pool>0.004?`<li><span>Emergency fund <span class="muted small">· nothing left to pay ahead</span></span><span class="a">${peso(pool)}</span></li>`:''}</ul>
    ${bufInput}
    <p class="note">Paying an installment early doesn't lower its interest, but it frees up next month so you don't need a new loan.</p></div>`;
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
      return `<div class="ev${paid?' paid':''}" data-k="${esc(e.l.i.kind)}"><span class="nm">${esc(e.l.i.name)}</span><span class="r">${pill}<span class="a">−${peso(e.l.need)}</span></span></div>`;
    }).join('');
    return `<div class="day"><div class="d">${fmtD(d)}<small>${WD[d.getDay()]}</small></div><div>${rows}<div class="bal${bal<0?' neg':''}"><span>${bal<0?'Not enough on hand':'On hand after'}</span><span class="num">${peso(bal)}</span></div></div></div>`;
  }).join('')||'<p class="empty">Nothing scheduled.</p>';
}

// ---------- bills ----------
let editingId=null;
const GROUPS=[['loan','Installments'],['card','Credit cards'],['essential','Rent, food & allowance'],['bill','Utilities & bills'],['flex','Can be cut']];
function itemForm(i){
  return `<div class="form" data-id="${i.id}">
    <div class="field wide"><label for="n${i.id}">Name</label><input id="n${i.id}" data-k="name" value="${esc(i.name)}"></div>
    <div class="field"><label for="k${i.id}">Type</label><select id="k${i.id}" data-k="kind">${Object.entries(KINDS).map(([k,v])=>`<option value="${k}" ${k===i.kind?'selected':''}>${v}</option>`).join('')}</select></div>
    <div class="field"><label for="a${i.id}">${i.kind==='card'?'Statement amount':'Monthly amount'}</label><input id="a${i.id}" data-k="amount" type="number" step="0.01" min="0" value="${i.amount??''}"></div>
    <div class="field"><label for="d${i.id}">Due day</label><input id="d${i.id}" data-k="day" type="number" min="1" max="31" value="${i.day??''}"></div>
    ${i.kind==='loan'?`<div class="field"><label for="l${i.id}">Payments left</label><input id="l${i.id}" data-k="left" type="number" min="0" value="${i.left??''}"></div><div class="field"><label for="t${i.id}">Total payments</label><input id="t${i.id}" data-k="total" type="number" min="0" value="${i.total??''}"></div>`:''}
    ${i.kind==='card'||i.kind==='loan'?`<div class="field"><label for="r${i.id}">Interest %/month</label><input id="r${i.id}" data-k="rate" type="number" step="0.01" min="0" value="${i.rate??''}"></div>`:''}
    <div class="acts"><button class="danger" data-del="${i.id}">Remove</button><button class="btn" data-done="1">Done</button></div>
  </div>`;
}
function itemRow(i,start){
  const amt=num(i.amount),paid=isPaid(i),meta=[`<span>Due ${fmtD(dueDate(dayOf(i),start))}</span>`];
  if(i.kind==='loan'&&num(i.left))meta.push(`<span>${num(i.left)} left</span>`);
  if(i.kind==='card'){const a=acctOf(i);if(a){if(a.last4)meta.push(`<span>•••• ${esc(a.last4)}</span>`);if(a.stmt)meta.push(`<span>Statement ${ord(num(a.stmt))}</span>`);const L=num(a.limit);if(L>0&&amt>0){const p=amt/L*100;meta.push(`<span style="color:${p>50?'var(--bad)':p>30?'var(--warn)':'var(--ok)'}">${p.toFixed(0)}% of ${peso(L)} limit</span>`)}}}
  if(paid)meta.unshift(`<span style="color:var(--ok);font-weight:600">Paid · clears in ${Math.max(1,Math.ceil((DAY-(Date.now()-num(i.paidAt)))/3600000))}h</span>`);
  return `<div class="bill${paid?' done':''}"><div><div class="nm">${esc(i.name)}</div><div class="mt">${meta.join('')}</div></div>
    <div class="rt">${amt>0?`<span class="amt">${peso(amt)}</span>`:'<span class="pill warn">Add amount</span>'}
    <div class="bt">${paid?`<button class="ghost" data-unpaid="${i.id}">Undo</button>`:`<button class="ghost" data-edit="${i.id}">Edit</button>${amt>0?`<button class="paidbtn" data-paid="${i.id}">Paid</button>`:''}`}</div></div></div>`;
}
function renderItems(){
  const start=cycleStart();
  const vis=S.items.filter(i=>!isHiddenPaid(i)),hidden=S.items.filter(isHiddenPaid);
  const html=GROUPS.map(([k,label])=>{
    const its=vis.filter(i=>i.kind===k);if(!its.length)return '';
    its.sort((a,b)=>(isPaid(a)-isPaid(b))||dueDate(dayOf(a),start)-dueDate(dayOf(b),start));
    const due=its.filter(i=>!isPaid(i)).reduce((s,i)=>s+num(i.amount),0);
    return `<div class="grp" data-k="${k}"><div class="grp-h"><h3>${label}<span>${its.length}</span></h3><span class="sub">${peso(due)}</span></div>${its.map(i=>i.id===editingId?itemForm(i):itemRow(i,start)).join('')}</div>`;
  }).join('');
  const left=S.items.filter(i=>!isPaid(i)).reduce((s,i)=>s+num(i.amount),0);
  $('#itemList').innerHTML=(html||'<p class="empty">Nothing left to pay this cycle.</p>')+
    `<div class="tot"><span>Still to pay</span><span>${peso(left)}</span></div>`+
    (hidden.length?`<details class="paidlist"><summary>Paid this cycle (${hidden.length})</summary><ul>${hidden.map(i=>`<li><span>${esc(i.name)}</span><span class="num">${peso(num(i.amount))}</span></li>`).join('')}</ul></details>`:'');
}

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
      <div class="loan-h"><div><h3>${esc(i.name)}</h3><span class="muted small">${i.rate!=null&&i.rate!==''?num(i.rate)+'%'+(i.addon?' add-on':'')+'/mo · ':''}due every ${ord(num(i.day))}</span></div><span class="pay">${peso(pay)}<span class="muted small">/mo</span></span></div>
      ${total?`<div class="bar" role="img" aria-label="${done} of ${total} paid"><i style="width:${Math.round(done/total*100)}%"></i></div>`:''}
      <div class="facts">${total?`<span><b>${done}/${total}</b> paid</span>`:''}<span><b>${left}</b> left</span><span><b>${peso(pay*left)}</b> to go</span><span>Ends <b>${end?MON[end.getMonth()]+' '+end.getFullYear():'—'}</b></span></div>
      <div class="acts">${isPaid(i)?`<span class="pill ok">Paid this month</span>${!isHiddenPaid(i)?`<button class="ghost" data-iundo="${i.id}">Undo</button>`:''}`:''}<button class="ghost" data-iedit="${i.id}">Edit</button>${left>0&&!isPaid(i)?`<button class="paidbtn" data-ipaid="${i.id}">Paid</button>`:''}</div>
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
    <button class="x" data-incdel="${x.id}" aria-label="Remove">×</button>
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
function nextFree(){
  const fixed=S.items.filter(i=>i.kind==='essential'||i.kind==='bill').reduce((s,i)=>s+num(i.amount),0);
  const ln=S.items.filter(i=>i.kind==='loan'&&(isPaid(i)?num(i.left):num(i.left)-1)>0).reduce((s,i)=>s+num(i.amount),0);
  return num(S.salary)-fixed-ln;
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
    ?`<h2>Cover ${peso(C.gap)}</h2><p class="muted small" style="margin-top:4px">What it costs to borrow that from each creditor, cheapest first.</p>`
    :`<h2>You're not short</h2><p class="muted small" style="margin-top:4px">Your money covers every bill this cycle. Nothing to borrow.</p>`;
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
    <div class="acts"><button class="danger" data-sdel="${s.id}">Remove</button></div></div>`).join('');
}

// ---------- plan ahead ----------
function renderAhead(C){
  const salary=num(S.salary);
  const fixed=S.items.filter(i=>i.kind==='essential'||i.kind==='bill').reduce((s,i)=>s+num(i.amount),0);
  const loans=S.items.filter(i=>i.kind==='loan'&&num(i.amount)>0);
  const n=Math.min(24,Math.max(1,...loans.map(l=>num(l.left)||1))+1);
  const scale=Math.max(salary,fixed+loans.reduce((s,l)=>s+num(l.amount),0))||1;
  let rows='';
  for(let m=0;m<n;m++){
    const d=shiftCycle(C.start,m);
    const ln=loans.filter(l=>(num(l.left)+(isPaid(l)?1:0))>m).reduce((s,l)=>s+num(l.amount),0);
    const free=Math.max(0,salary-ln-fixed),w=v=>(v/scale*100).toFixed(2)+'%';
    rows+=`<div class="mrow"><span>${MON[d.getMonth()]} ${String(d.getFullYear()).slice(2)}</span><div class="track"><div class="seg loan" style="width:${w(ln)}"></div><div class="seg fixed" style="width:${w(fixed)}"></div><div class="seg free" style="width:${w(free)}"></div></div><span class="num" style="text-align:right">${peso(free)}</span></div>`;
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
    <div class="field"><label for="a4${a.id}">Last 4 digits</label><input id="a4${a.id}" data-k="last4" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="1234" autocomplete="off" value="${esc(a.last4||'')}"></div>
    <div class="field"><label for="al${a.id}">Credit limit (₱)</label><input id="al${a.id}" data-k="limit" type="number" min="0" step="0.01" value="${a.limit??''}"></div>
    <div class="field"><label for="as${a.id}">Statement day</label><input id="as${a.id}" data-k="stmt" type="number" min="1" max="31" value="${a.stmt??''}"></div>
    <div class="field"><label for="ad${a.id}">Payment due day</label><input id="ad${a.id}" data-k="due" type="number" min="1" max="31" value="${billOf(a)?.day??''}"></div>
    <div class="acts"><button class="danger" data-adel="${a.id}">Remove</button><button class="btn" data-adone="1">Done</button></div>
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
    if(bill)facts.push(`<span>Due <b>${fmtD(dueDate(dayOf(bill),cycleStart()))}</b></span>`);
    facts.push(`<span>Using <b>${peso(U)}</b>${L>0?` of ${peso(L)}`:''}</span>`);
    if(L>0)facts.push(`<span>Available <b>${peso(Math.max(0,L-U))}</b></span>`);
    return `<div class="acct" data-k="card">
      <div class="acct-h"><h3>${esc(a.name)}${a.last4?`<span class="l4">•••• ${esc(a.last4)}</span>`:''}</h3>
        <span class="lim">${L>0?peso(L):'—'}<small>credit limit</small></span></div>
      ${p!==null?`<div class="ubar" role="img" aria-label="${p.toFixed(0)}% of limit used"><i class="${ucls(p)}" style="width:${Math.min(100,p).toFixed(1)}%"></i></div>`:''}
      <div class="facts">${p!==null?`<span><b>${p.toFixed(0)}%</b> used</span>`:''}${facts.join('')}</div>
      <div class="acts"><button class="ghost" data-aedit="${a.id}">Edit</button></div>
    </div>`;
  }).join('');
  $('#acctList').innerHTML=html||'<p class="empty">No cards yet.</p>';
  const p=lim>0?used/lim*100:null;
  $('#acctSum').innerHTML=`<div><span class="label">Total limit</span><span class="v">${peso(lim)}</span></div><div><span class="label">Total used</span><span class="v">${peso(used)}</span></div><div><span class="label">Overall usage</span><span class="v" style="color:${p===null?'inherit':p>50?'var(--bad)':p>30?'var(--warn)':'var(--ok)'}">${p===null?'—':p.toFixed(0)+'%'}</span></div>`;
}

// ---------- render ----------
function render(){
  const C=compute();
  renderStatus(C);renderAdvice(C);renderTimeline(C);renderInst();renderBorrow(C);renderAhead(C);if(acctEditing==null)renderAccounts();
}
function renderAll(){renderItems();renderIncome();renderSrcList();render()}
const commit=()=>{save();render()};

// ---------- events ----------
['salary','payday'].forEach(k=>{$('#'+k).addEventListener('input',e=>{S[k]=e.target.value===''?0:num(e.target.value);save();if(k==='payday')renderAll();else render()})});
function syncInputs(){['salary','payday'].forEach(k=>{const el=$('#'+k);if(document.activeElement!==el)el.value=S[k]??''})}
document.addEventListener('input',e=>{if(e.target.id==='buffer'){S.buffer=num(e.target.value);save();const C=compute();renderStatus(C);
  const pos=e.target.selectionStart;renderAdvice(C);const b=$('#buffer');if(b){b.focus();try{b.setSelectionRange(pos,pos)}catch(_){}}}});
document.addEventListener('click',e=>{const g=e.target.closest('[data-goto]');if(g)selectTab(g.dataset.goto)});

$('#itemList').addEventListener('input',e=>{
  const row=e.target.closest('.form');if(!row)return;const it=S.items.find(i=>i.id==row.dataset.id),k=e.target.dataset.k;if(!it||!k)return;
  it[k]=k==='name'||k==='kind'?e.target.value:(e.target.value===''?null:num(e.target.value));
  if(k==='name'){const a=acctOf(it);if(a)a.name=it.name}
  if(k==='kind'&&it.kind==='card'){delete it.noAcct;ensureLinks()}
  commit();if(k==='kind'){renderItems();const f=$('#k'+it.id);f&&f.focus()}
});
$('#itemList').addEventListener('click',e=>{
  const t=e.target.closest('button');if(!t)return;
  if(t.dataset.del){S.items=S.items.filter(i=>i.id!=t.dataset.del);editingId=null;save();renderAll();return}
  if(t.dataset.edit){editingId=+t.dataset.edit;renderItems();const f=$('#a'+editingId);f&&f.focus();return}
  if(t.dataset.done){editingId=null;renderItems();return}
  const id=t.dataset.paid||t.dataset.unpaid;if(!id)return;const it=S.items.find(i=>i.id==id);if(!it)return;
  t.dataset.paid?markPaid(it):undoPaid(it);save();renderItems();render();
});
$('#addBtn').addEventListener('click',()=>{const it={id:uid++,name:'New bill',kind:'bill',amount:null,day:clampPd()};S.items.push(it);editingId=it.id;save();renderItems();render();const f=$('#n'+it.id);f&&(f.focus(),f.select())});

function openEdit(id){editingId=id;selectTab('bills');renderItems();const f=$('#n'+id);f&&f.focus()}
$('#instList').addEventListener('click',e=>{
  const t=e.target.closest('button');if(!t)return;
  const id=t.dataset.ipaid||t.dataset.iundo||t.dataset.iedit,it=S.items.find(i=>i.id==id);if(!it)return;
  if(t.dataset.iedit){openEdit(it.id);return}
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
$('#resetYes').addEventListener('click',()=>{S=clone(DEFAULTS);S.rev=0;prepare();editingId=null;save();syncInputs();$('#resetConfirm').hidden=true;renderAll()});
$('#acctList').addEventListener('input',e=>{
  const row=e.target.closest('.form');if(!row)return;const a=S.accounts.find(x=>x.id==row.dataset.aid),k=e.target.dataset.k;if(!a||!k)return;
  if(k==='last4'){const v=e.target.value.replace(/\D/g,'').slice(0,4);if(v!==e.target.value)e.target.value=v;a.last4=v}
  else if(k==='due'){const b=billOf(a);if(b)b.day=e.target.value===''?null:num(e.target.value)}
  else{a[k]=k==='name'?e.target.value:(e.target.value===''?null:num(e.target.value));if(k==='name'){const b=billOf(a);if(b)b.name=a.name}}
  commit();
});
$('#acctList').addEventListener('click',e=>{
  const t=e.target.closest('button');if(!t)return;
  if(t.dataset.aedit){acctEditing=+t.dataset.aedit;renderAccounts();const f=$('#al'+acctEditing);f&&f.focus();return}
  if(t.dataset.adone){acctEditing=null;renderAccounts();renderItems();return}
  if(t.dataset.adel){const a=S.accounts.find(x=>x.id==t.dataset.adel);const b=a&&billOf(a);if(b){delete b.acct;b.noAcct=true}S.accounts=S.accounts.filter(x=>x.id!=t.dataset.adel);acctEditing=null;save();renderAccounts();renderItems()}
});
$('#acctAdd').addEventListener('click',()=>{const a={id:uid++,key:genKey(),name:'New card',last4:'',limit:null,stmt:null};S.accounts.push(a);S.items.push({id:uid++,name:a.name,kind:'card',amount:null,day:clampPd(),acct:a.key});renderItems();render();acctEditing=a.id;save();renderAccounts();const f=$('#an'+a.id);f&&(f.focus(),f.select())});
function selectTab(name){
  document.querySelectorAll('.tab').forEach(x=>{const on=x.dataset.tab===name;x.setAttribute('aria-selected',on);x.tabIndex=on?0:-1;
    if(on&&x.parentElement.scrollWidth>x.parentElement.clientWidth)x.parentElement.scrollTo({left:x.offsetLeft-x.parentElement.clientWidth/2+x.offsetWidth/2,behavior:'smooth'})});
  document.querySelectorAll('[data-panel]').forEach(p=>p.hidden=p.dataset.panel!==name);
  // when the tab bar is stuck to the top, bring the new panel's start into view
  const bar=$('.tabs'),top=bar.getBoundingClientRect().top;
  if(top<=parseFloat(getComputedStyle(bar).top)+1)bar.parentElement.scrollIntoView({block:'start'});
  try{localStorage.setItem(KEY+'.tab',name)}catch(e){}
}
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>selectTab(t.dataset.tab)));
$('.tabs').addEventListener('keydown',e=>{
  const tabs=[...document.querySelectorAll('.tab')],i=tabs.indexOf(document.activeElement);if(i<0)return;
  const j={ArrowRight:i+1,ArrowLeft:i-1,Home:0,End:tabs.length-1}[e.key];if(j==null)return;
  e.preventDefault();const t=tabs[(j+tabs.length)%tabs.length];t.focus();selectTab(t.dataset.tab);
});
try{const tb=localStorage.getItem(KEY+'.tab');if(tb&&document.querySelector(`[data-panel="${tb}"]`))selectTab(tb)}catch(e){}

// ---------- boot ----------
function adopt(next){
  if(!next||!Array.isArray(next.items))return;
  S=next;prepare();rollover();editingId=null;syncInputs();renderAll();
}
async function connectCloud(){
  for(let k=0;k<30&&!(window.claude&&window.claude.use);k++)await new Promise(r=>setTimeout(r,100));
  if(!window.claude||!window.claude.use){setSync('off','Saved on this device only');return}
  try{
    const [db,user]=await Promise.all([window.claude.use('db'),window.claude.use('user')]);
    const id=db&&user?await user.id():null;
    if(!db||!id){setSync('off','Sign in to save to your account');return}
    cloud=db.collection('data/users/'+id).doc('planner');
    const snap=await cloud.get();cloudReady=true;
    if(snap.exists){try{adopt(JSON.parse(snap.data().state))}catch(e){}save()}
    else save();
  }catch(e){cloud=null;setSync('off','Could not reach your account. Saved on this device.')}
}
prepare();rollover();save();syncInputs();renderAll();
// ---------- BillBuddy ----------
// Card bills come from BillBuddy: each one fills the matching credit card's
// statement amount and due day here. Matched by bank name ("RCBC" -> "RCBC CC").
// The link and key live in this device's storage only, never in the cloud snapshot.
const BB_KEY=KEY+'.billbuddy';
const bbConf=()=>{try{return JSON.parse(localStorage.getItem(BB_KEY))||{}}catch(e){return {}}};
const squash=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const bbState=(cls,txt)=>{const el=$('#bbState');el.className='sync '+cls;el.textContent=txt};
let bbBusy=false;
async function syncBillBuddy(){
  const {url,key}=bbConf();
  if(!url||!key){bbState('off','Not connected');return}
  if(bbBusy)return;bbBusy=true;
  let bills;
  try{
    const r=await fetch(url,{headers:{Authorization:'Bearer '+key},cache:'no-store'});
    if(r.status===401){bbState('off','Wrong API key');return}
    const j=await r.json();if(!j.ok)throw new Error(j.error||'BillBuddy returned an error');bills=j.bills||[];
  }catch(e){console.warn('BillBuddy sync failed',e);bbState('off','Could not reach BillBuddy. Check the link.');return}
  finally{bbBusy=false}
  let changed=false;
  bills.forEach(b=>{
    const bank=squash(b.bank),due=parseD(b.due_date),amt=num(b.amount);
    if(!bank||!due||!(amt>0))return;
    let it=S.items.find(i=>i.kind==='card'&&squash(i.name).includes(bank));
    // remember the statement you marked paid, so it is not brought back after payday
    if(it&&isPaid(it)){if(it.bbDue&&it.bbPaidDue!==it.bbDue){it.bbPaidDue=it.bbDue;changed=true}return}
    if(it&&it.bbPaidDue===b.due_date)return;
    if(!it){it={id:uid++,name:b.bank+' CC',kind:'card',amount:null,day:null,rate:3};S.items.push(it);ensureLinks()}
    if(num(it.amount)===amt&&num(it.day)===due.getDate()&&it.bbDue===b.due_date)return;
    it.amount=amt;it.day=due.getDate();it.bbDue=b.due_date;changed=true;
  });
  if(changed){save();if(editingId==null)renderItems();render()}
  const t=new Date();
  bbState('ok',`Synced ${bills.length} bill${bills.length===1?'':'s'} at ${t.getHours()%12||12}:${String(t.getMinutes()).padStart(2,'0')} ${t.getHours()<12?'AM':'PM'}`);
}
{const c=bbConf();$('#bbUrl').value=c.url||'';$('#bbKey').value=c.key||''}
$('#bbSave').addEventListener('click',()=>{
  const url=$('#bbUrl').value.trim(),key=$('#bbKey').value.trim();
  if(!/^https:\/\//i.test(url)){bbState('off','The link must start with https://');return}
  if(!key){bbState('off','Enter the API key');return}
  try{localStorage.setItem(BB_KEY,JSON.stringify({url,key}))}catch(e){bbState('off','Could not save on this device');return}
  bbState('busy','Syncing…');syncBillBuddy();
});
$('#bbClear').addEventListener('click',()=>{
  try{localStorage.removeItem(BB_KEY)}catch(e){}
  $('#bbUrl').value='';$('#bbKey').value='';bbState('off','Not connected');
});
connectCloud().finally(syncBillBuddy);
setInterval(syncBillBuddy,60000);
setInterval(()=>{if(rollover())save();if(editingId==null&&!document.activeElement?.closest?.('.form'))renderItems();render()},60000);
