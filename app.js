const STORAGE_KEY='savemoney.vaults.v1';
const $=s=>document.querySelector(s);
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n||0);
const today=()=>new Date(new Date().toDateString());
const parseDate=s=>new Date(`${s}T00:00:00`);
const daysLeft=s=>Math.ceil((parseDate(s)-today())/86400000);
let vaults=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');
let activeAction=null;

function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(vaults));render();}
function total(){return vaults.reduce((a,v)=>a+Number(v.balance||0),0)}
function unlocked(v){return today()>=parseDate(v.unlockDate)}
function escapeHtml(s=''){return s.replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));}

function render(){
  $('#totalBalance').textContent=money(total());
  const locked=vaults.filter(v=>!unlocked(v)).sort((a,b)=>parseDate(a.unlockDate)-parseDate(b.unlockDate));
  $('#nextUnlock').textContent=locked.length?`Next unlock: ${new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(parseDate(locked[0].unlockDate))}`:'No locked vaults right now.';
  const list=$('#vaultList'); list.innerHTML='';
  if(!vaults.length){list.append($('#emptyTemplate').content.cloneNode(true));return;}
  vaults.forEach(v=>{
    const isUnlocked=unlocked(v), pct=Math.max(0,Math.min(100,(Number(v.balance)/Number(v.goal))*100));
    const remaining=Math.max(0,daysLeft(v.unlockDate));
    const el=document.createElement('article'); el.className='vault card';
    el.innerHTML=`<div class="vaultTop"><div><p class="eyebrow">${isUnlocked?'AVAILABLE':'LOCKED SAVINGS'}</p><h3>${escapeHtml(v.name)}</h3></div><span class="lockPill ${isUnlocked?'unlocked':''}">${isUnlocked?'Unlocked':'🔒 '+remaining+' day'+(remaining===1?'':'s')}</span></div><div class="vaultAmount">${money(v.balance)}</div><p class="muted">of ${money(v.goal)} goal</p><div class="progressTrack"><div class="progressBar" style="width:${pct}%"></div></div><div class="vaultMeta"><span>${pct.toFixed(0)}% funded</span><span>${isUnlocked?'Unlocked':`Unlocks ${new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(parseDate(v.unlockDate))}`}</span></div><div class="vaultActions"><button class="primary addBtn" data-id="${v.id}">Add money</button><button class="secondary withdrawBtn" data-id="${v.id}" ${isUnlocked?'':'disabled'}>${isUnlocked?'Withdraw':'Withdrawal locked'}</button></div>`;
    list.append(el);
  });
  document.querySelectorAll('.addBtn').forEach(b=>b.onclick=()=>openAction(b.dataset.id,'add'));
  document.querySelectorAll('.withdrawBtn').forEach(b=>b.onclick=()=>openAction(b.dataset.id,'withdraw'));
}

function openAction(id,type){
  const v=vaults.find(x=>x.id===id); if(!v)return;
  if(type==='withdraw'&&!unlocked(v)){alert(`This vault is locked until ${v.unlockDate}.`);return;}
  activeAction={id,type};
  $('#actionTitle').textContent=type==='add'?'Add money':'Withdraw money';
  $('#actionDescription').textContent=type==='add'?`Add a demo deposit to “${v.name}”.`:`“${v.name}” is unlocked. Choose how much to withdraw.`;
  $('#actionSubmit').textContent=type==='add'?'Add deposit':'Withdraw';
  $('#actionAmount').value='';
  $('#actionDialog').showModal();
}

$('#newVaultBtn').onclick=()=>{
  const d=new Date(); d.setDate(d.getDate()+1);
  $('#vaultDate').min=d.toISOString().slice(0,10); $('#vaultDate').value=d.toISOString().slice(0,10);
  $('#vaultDialog').showModal();
};
$('#closeDialogBtn').onclick=()=>$('#vaultDialog').close();
$('#closeActionBtn').onclick=()=>$('#actionDialog').close();
$('#closeInfoBtn').onclick=$('#dismissInfoBtn').onclick=()=>$('#infoDialog').close();

$('#connectBankBtn').onclick=async()=>{
  const btn=$('#connectBankBtn');
  btn.disabled=true;
  btn.textContent='Opening Stripe…';
  try{
    const response=await fetch('/api/create-test-checkout',{method:'POST'});
    const data=await response.json();
    if(!response.ok||!data.url)throw new Error(data.error||'Could not create Stripe checkout.');
    window.location.href=data.url;
  }catch(error){
    $('#infoTitle').textContent='Stripe test could not start';
    $('#infoText').textContent=error.message;
    $('#infoDialog').showModal();
    btn.disabled=false;
    btn.textContent='Test $5 deposit';
  }
};

$('#vaultForm').addEventListener('submit',e=>{
  e.preventDefault();
  const name=$('#vaultName').value.trim(), goal=Number($('#vaultGoal').value), deposit=Number($('#vaultDeposit').value||0), unlockDate=$('#vaultDate').value;
  if(!name||goal<=0||deposit<0||!unlockDate)return;
  if(parseDate(unlockDate)<=today()){alert('Choose an unlock date after today.');return;}
  vaults.push({id:crypto.randomUUID(),name,goal,balance:deposit,unlockDate,createdAt:new Date().toISOString()});
  save(); e.target.reset(); $('#vaultDialog').close();
});

$('#actionForm').addEventListener('submit',e=>{
  e.preventDefault(); if(!activeAction)return;
  const v=vaults.find(x=>x.id===activeAction.id), amount=Number($('#actionAmount').value);
  if(!v||amount<=0)return;
  if(activeAction.type==='withdraw'){
    if(!unlocked(v)){alert('This vault is still locked.');return;}
    if(amount>v.balance){alert('That amount is more than the vault balance.');return;}
    v.balance=Number(v.balance)-amount;
  }else v.balance=Number(v.balance)+amount;
  save(); $('#actionDialog').close(); activeAction=null;
});

$('#exportBtn').onclick=()=>{
  const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),vaults},null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='savemoney-backup.json';a.click();URL.revokeObjectURL(a.href);
};

const stripeResult=new URLSearchParams(location.search).get('stripe_test');
if(stripeResult==='success'){
  setTimeout(()=>alert('Stripe sandbox payment succeeded. No real money was charged. This test payment is not added to a vault yet.'),100);
  history.replaceState({},'',location.pathname);
}else if(stripeResult==='cancelled'){
  setTimeout(()=>alert('Stripe sandbox checkout was cancelled. No money was charged.'),100);
  history.replaceState({},'',location.pathname);
}

if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
render();