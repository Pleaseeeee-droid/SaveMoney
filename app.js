const STORAGE_KEY='savemoney.vaults.v1';
const APPLIED_PAYMENTS_KEY='savemoney.appliedStripeSessions.v1';
const $=s=>document.querySelector(s);
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n||0);
const today=()=>new Date(new Date().toDateString());
const parseDate=s=>new Date(`${s}T00:00:00`);
const daysLeft=s=>Math.ceil((parseDate(s)-today())/86400000);
let vaults=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');
let appliedPayments=JSON.parse(localStorage.getItem(APPLIED_PAYMENTS_KEY)||'[]');
let activeAction=null;

function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(vaults));render();}
function saveApplied(){localStorage.setItem(APPLIED_PAYMENTS_KEY,JSON.stringify(appliedPayments));}
function total(){return vaults.reduce((a,v)=>a+Number(v.balance||0),0)}
function unlocked(v){return today()>=parseDate(v.unlockDate)}
function escapeHtml(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function render(){
  $('#totalBalance').textContent=money(total());
  const locked=vaults.filter(v=>!unlocked(v)).sort((a,b)=>parseDate(a.unlockDate)-parseDate(b.unlockDate));
  $('#nextUnlock').textContent=locked.length?`Next unlock: ${new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(parseDate(locked[0].unlockDate))}`:'No locked vaults right now.';
  const list=$('#vaultList'); list.innerHTML='';
  if(!vaults.length){list.append($('#emptyTemplate').content.cloneNode(true));return;}
  vaults.forEach(v=>{
    const isUnlocked=unlocked(v), balance=Number(v.balance||0), pct=Math.max(0,Math.min(100,(balance/Number(v.goal))*100));
    const remaining=Math.max(0,daysLeft(v.unlockDate));
    const canDelete=balance===0;
    const el=document.createElement('article'); el.className='vault card';
    el.innerHTML=`<div class="vaultTop"><div><p class="eyebrow">${isUnlocked?'AVAILABLE':'LOCKED SAVINGS'}</p><h3>${escapeHtml(v.name)}</h3></div><span class="lockPill ${isUnlocked?'unlocked':''}">${isUnlocked?'Unlocked':'🔒 '+remaining+' day'+(remaining===1?'':'s')}</span></div><div class="vaultAmount">${money(balance)}</div><p class="muted">of ${money(v.goal)} goal</p><div class="progressTrack"><div class="progressBar" style="width:${pct}%"></div></div><div class="vaultMeta"><span>${pct.toFixed(0)}% funded</span><span>${isUnlocked?'Unlocked':`Unlocks ${new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(parseDate(v.unlockDate))}`}</span></div><div class="vaultActions"><button class="primary addBtn" data-id="${v.id}">Add money</button><button class="secondary withdrawBtn" data-id="${v.id}" ${isUnlocked?'':'disabled'}>${isUnlocked?'Withdraw':'Withdrawal locked'}</button></div>${canDelete?`<div class="vaultDeleteRow"><button class="dangerGhost deleteVaultBtn" data-id="${v.id}">Delete empty vault</button></div>`:''}`;
    list.append(el);
  });
  document.querySelectorAll('.addBtn').forEach(b=>b.onclick=()=>openAction(b.dataset.id,'add'));
  document.querySelectorAll('.withdrawBtn').forEach(b=>b.onclick=()=>openAction(b.dataset.id,'withdraw'));
  document.querySelectorAll('.deleteVaultBtn').forEach(b=>b.onclick=()=>deleteVault(b.dataset.id));
}

function deleteVault(id){
  const v=vaults.find(x=>x.id===id); if(!v)return;
  if(Number(v.balance||0)!==0){alert('Only empty vaults can be deleted.');return;}
  if(!confirm(`Delete “${v.name}”? This cannot be undone.`))return;
  vaults=vaults.filter(x=>x.id!==id);
  save();
}

function openAction(id,type){
  const v=vaults.find(x=>x.id===id); if(!v)return;
  if(type==='withdraw'&&!unlocked(v)){alert(`This vault is locked until ${v.unlockDate}.`);return;}
  activeAction={id,type};
  $('#actionTitle').textContent=type==='add'?'Add money':'Withdraw money';
  $('#actionDescription').textContent=type==='add'?`Send a Stripe sandbox deposit to “${v.name}”. No real money will move.`:`“${v.name}” is unlocked. Withdrawal is still demo-only in this build.`;
  $('#actionSubmit').textContent=type==='add'?'Continue to Stripe':'Withdraw demo balance';
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

$('#actionForm').addEventListener('submit',async e=>{
  e.preventDefault(); if(!activeAction)return;
  const v=vaults.find(x=>x.id===activeAction.id), amount=Number($('#actionAmount').value);
  if(!v||amount<=0)return;

  if(activeAction.type==='withdraw'){
    if(!unlocked(v)){alert('This vault is still locked.');return;}
    if(amount>v.balance){alert('That amount is more than the vault balance.');return;}
    v.balance=Number(v.balance)-amount;
    save(); $('#actionDialog').close(); activeAction=null;
    return;
  }

  const submit=$('#actionSubmit');
  submit.disabled=true;
  submit.textContent='Opening Stripe…';
  try{
    const response=await fetch('/api/create-vault-checkout',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({vaultId:v.id,vaultName:v.name,amount})
    });
    const data=await response.json();
    if(!response.ok||!data.url)throw new Error(data.error||'Could not create vault checkout.');
    window.location.href=data.url;
  }catch(error){
    alert(error.message);
    submit.disabled=false;
    submit.textContent='Continue to Stripe';
  }
});

$('#exportBtn').onclick=()=>{
  const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),vaults},null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='savemoney-backup.json';a.click();URL.revokeObjectURL(a.href);
};

async function handleVaultPaymentReturn(){
  const params=new URLSearchParams(location.search);
  const result=params.get('vault_payment');
  if(result==='cancelled'){
    history.replaceState({},'',location.pathname);
    setTimeout(()=>alert('Stripe sandbox checkout was cancelled. No money was charged.'),100);
    return;
  }
  if(result!=='success')return;

  const sessionId=params.get('session_id');
  history.replaceState({},'',location.pathname);
  if(!sessionId)return;
  if(appliedPayments.includes(sessionId)){
    setTimeout(()=>alert('This Stripe sandbox payment was already added to the vault.'),100);
    return;
  }

  try{
    const response=await fetch(`/api/verify-vault-payment?session_id=${encodeURIComponent(sessionId)}`);
    const data=await response.json();
    if(!response.ok||!data.ok)throw new Error(data.error||'Could not verify payment.');
    const vault=vaults.find(v=>v.id===data.vaultId);
    if(!vault)throw new Error('Payment succeeded, but this browser no longer has the matching vault.');
    vault.balance=Number(vault.balance||0)+Number(data.amount||0);
    appliedPayments.push(sessionId);
    saveApplied();
    save();
    setTimeout(()=>alert(`${money(data.amount)} Stripe sandbox deposit confirmed and added to “${vault.name}”. No real money was charged.`),100);
  }catch(error){
    setTimeout(()=>alert(`Stripe payment return could not be applied: ${error.message}`),100);
  }
}

const stripeResult=new URLSearchParams(location.search).get('stripe_test');
if(stripeResult==='success'){
  setTimeout(()=>alert('Stripe sandbox payment succeeded. No real money was charged. This standalone test payment is not added to a vault.'),100);
  history.replaceState({},'',location.pathname);
}else if(stripeResult==='cancelled'){
  setTimeout(()=>alert('Stripe sandbox checkout was cancelled. No money was charged.'),100);
  history.replaceState({},'',location.pathname);
}

if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
render();
handleVaultPaymentReturn();