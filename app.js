const AUTH_SESSION_KEY='savemoney.auth.v1';
const $=s=>document.querySelector(s);
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n||0);
const today=()=>new Date(new Date().toDateString());
const parseDate=s=>new Date(`${s}T00:00:00`);
const daysLeft=s=>Math.ceil((parseDate(s)-today())/86400000);
let vaults=[];
let authSession=JSON.parse(localStorage.getItem(AUTH_SESSION_KEY)||'null');
let activeAction=null;

const normalizeVault=v=>({id:v.id,name:v.name,goal:Number(v.goal_amount??v.goal??0),balance:Number(v.balance||0),unlockDate:v.unlock_date??v.unlockDate,createdAt:v.created_at??v.createdAt});
function authHeaders(extra={}){return {'Content-Type':'application/json',Authorization:`Bearer ${authSession?.accessToken||''}`,...extra};}
function total(){return vaults.reduce((a,v)=>a+Number(v.balance||0),0)}
function unlocked(v){return today()>=parseDate(v.unlockDate)}
function escapeHtml(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

async function loadVaults(){
  if(!authSession?.accessToken)return;
  const list=$('#vaultList');
  list.innerHTML='<section class="empty card"><p class="muted">Loading your vaults…</p></section>';
  try{
    const r=await fetch('/api/vaults',{headers:{Authorization:`Bearer ${authSession.accessToken}`}});
    const data=await r.json();
    if(r.status===401){setSignedOut();return;}
    if(!r.ok)throw new Error(data.error||'Could not load vaults.');
    vaults=(data.vaults||[]).map(normalizeVault);
    render();
  }catch(err){
    list.innerHTML=`<section class="empty card"><h3>Could not load vaults</h3><p class="muted">${escapeHtml(err.message)}</p></section>`;
  }
}

function setSignedIn(session){
  authSession=session;
  localStorage.setItem(AUTH_SESSION_KEY,JSON.stringify(session));
  $('#authScreen').hidden=true;
  $('#appShell').hidden=false;
  loadVaults();
}
function setSignedOut(){
  authSession=null;vaults=[];
  localStorage.removeItem(AUTH_SESSION_KEY);
  $('#appShell').hidden=true;
  $('#authScreen').hidden=false;
  $('#loginPassword').value='';
}
async function refreshSession(){
  if(!authSession?.refreshToken)return false;
  try{
    const response=await fetch('/api/auth-refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refreshToken:authSession.refreshToken})});
    const data=await response.json();
    if(!response.ok||!data.ok)return false;
    setSignedIn(data);return true;
  }catch{return false;}
}
async function initializeAuth(){
  $('#authScreen').hidden=false;$('#appShell').hidden=true;
  if(authSession&&await refreshSession())return true;
  setSignedOut();return false;
}

$('#loginForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const email=$('#loginEmail').value.trim(),password=$('#loginPassword').value,btn=$('#loginBtn'),error=$('#loginError');
  error.hidden=true;btn.disabled=true;btn.textContent='Signing in…';
  try{
    const response=await fetch('/api/auth-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    const data=await response.json();
    if(!response.ok||!data.ok)throw new Error(data.error||'Sign in failed.');
    setSignedIn(data);$('#loginPassword').value='';
    await handleVaultPaymentReturn();
  }catch(err){error.textContent=err.message;error.hidden=false;}
  finally{btn.disabled=false;btn.textContent='Sign in';}
});
$('#signOutBtn').onclick=()=>setSignedOut();

function render(){
  $('#totalBalance').textContent=money(total());
  const locked=vaults.filter(v=>!unlocked(v)).sort((a,b)=>parseDate(a.unlockDate)-parseDate(b.unlockDate));
  $('#nextUnlock').textContent=locked.length?`Next unlock: ${new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(parseDate(locked[0].unlockDate))}`:'No locked vaults right now.';
  const list=$('#vaultList');list.innerHTML='';
  if(!vaults.length){list.append($('#emptyTemplate').content.cloneNode(true));return;}
  vaults.forEach(v=>{
    const isUnlocked=unlocked(v),balance=Number(v.balance||0),pct=Math.max(0,Math.min(100,(balance/Number(v.goal))*100)),remaining=Math.max(0,daysLeft(v.unlockDate)),canDelete=balance===0;
    const el=document.createElement('article');el.className='vault card';
    el.innerHTML=`<div class="vaultTop"><div><p class="eyebrow">${isUnlocked?'AVAILABLE':'LOCKED SAVINGS'}</p><h3>${escapeHtml(v.name)}</h3></div><span class="lockPill ${isUnlocked?'unlocked':''}">${isUnlocked?'Unlocked':'🔒 '+remaining+' day'+(remaining===1?'':'s')}</span></div><div class="vaultAmount">${money(balance)}</div><p class="muted">of ${money(v.goal)} goal</p><div class="progressTrack"><div class="progressBar" style="width:${pct}%"></div></div><div class="vaultMeta"><span>${pct.toFixed(0)}% funded</span><span>${isUnlocked?'Unlocked':`Unlocks ${new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(parseDate(v.unlockDate))}`}</span></div><div class="vaultActions"><button class="primary addBtn" data-id="${v.id}">Add money</button><button class="secondary withdrawBtn" data-id="${v.id}" ${isUnlocked?'':'disabled'}>${isUnlocked?'Withdraw':'Withdrawal locked'}</button></div>${canDelete?`<div class="vaultDeleteRow"><button class="dangerGhost deleteVaultBtn" data-id="${v.id}">Delete empty vault</button></div>`:''}`;
    list.append(el);
  });
  document.querySelectorAll('.addBtn').forEach(b=>b.onclick=()=>openAction(b.dataset.id,'add'));
  document.querySelectorAll('.withdrawBtn').forEach(b=>b.onclick=()=>openAction(b.dataset.id,'withdraw'));
  document.querySelectorAll('.deleteVaultBtn').forEach(b=>b.onclick=()=>deleteVault(b.dataset.id));
}

async function deleteVault(id){
  const v=vaults.find(x=>x.id===id);if(!v)return;
  if(Number(v.balance||0)!==0){alert('Only empty vaults can be deleted.');return;}
  if(!confirm(`Delete “${v.name}”? This cannot be undone.`))return;
  try{
    const r=await fetch(`/api/vaults?id=${encodeURIComponent(id)}`,{method:'DELETE',headers:{Authorization:`Bearer ${authSession.accessToken}`}});
    const data=await r.json();if(!r.ok)throw new Error(data.error||'Could not delete vault.');
    vaults=vaults.filter(x=>x.id!==id);render();
  }catch(err){alert(err.message);}
}

function openAction(id,type){
  const v=vaults.find(x=>x.id===id);if(!v)return;
  if(type==='withdraw'&&!unlocked(v)){alert(`This vault is locked until ${v.unlockDate}.`);return;}
  activeAction={id,type};
  $('#actionTitle').textContent=type==='add'?'Add money':'Withdraw money';
  $('#actionDescription').textContent=type==='add'?`Send a Stripe sandbox deposit to “${v.name}”. No real money will move.`:`“${v.name}” is unlocked. The database will verify the unlock date again before allowing this sandbox withdrawal.`;
  $('#actionSubmit').textContent=type==='add'?'Continue to Stripe':'Withdraw sandbox balance';
  $('#actionAmount').value='';$('#actionDialog').showModal();
}

$('#newVaultBtn').onclick=()=>{const d=new Date();d.setDate(d.getDate()+1);$('#vaultDate').min=d.toISOString().slice(0,10);$('#vaultDate').value=d.toISOString().slice(0,10);$('#vaultDialog').showModal();};
$('#closeDialogBtn').onclick=()=>$('#vaultDialog').close();
$('#closeActionBtn').onclick=()=>$('#actionDialog').close();

$('#vaultForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const name=$('#vaultName').value.trim(),goal=Number($('#vaultGoal').value),unlockDate=$('#vaultDate').value;
  if(!name||goal<=0||!unlockDate)return;
  if(parseDate(unlockDate)<=today()){alert('Choose an unlock date after today.');return;}
  const submit=e.submitter;submit.disabled=true;submit.textContent='Creating…';
  try{
    const r=await fetch('/api/vaults',{method:'POST',headers:authHeaders(),body:JSON.stringify({name,goalAmount:goal,unlockDate})});
    const data=await r.json();if(!r.ok)throw new Error(data.error||'Could not create vault.');
    vaults.push(normalizeVault(data.vault));render();e.target.reset();$('#vaultDialog').close();
  }catch(err){alert(err.message);}finally{submit.disabled=false;submit.textContent='Create locked vault';}
});

$('#actionForm').addEventListener('submit',async e=>{
  e.preventDefault();if(!activeAction)return;
  const v=vaults.find(x=>x.id===activeAction.id),amount=Number($('#actionAmount').value);if(!v||amount<=0)return;
  if(activeAction.type==='withdraw'){
    const submit=$('#actionSubmit');submit.disabled=true;submit.textContent='Checking lock…';
    try{
      const response=await fetch('/api/withdraw-vault',{method:'POST',headers:authHeaders(),body:JSON.stringify({vaultId:v.id,amount})});
      const data=await response.json();
      if(!response.ok||!data.ok)throw new Error(data.error||'Withdrawal was rejected.');
      $('#actionDialog').close();activeAction=null;
      await loadVaults();
      alert(`${money(amount)} sandbox withdrawal completed. No real money moved.`);
    }catch(err){alert(err.message);}
    finally{submit.disabled=false;submit.textContent='Withdraw sandbox balance';}
    return;
  }
  const submit=$('#actionSubmit');submit.disabled=true;submit.textContent='Opening Stripe…';
  try{
    const response=await fetch('/api/create-vault-checkout',{method:'POST',headers:authHeaders(),body:JSON.stringify({vaultId:v.id,amount})});
    const data=await response.json();if(!response.ok||!data.url)throw new Error(data.error||'Could not create vault checkout.');window.location.href=data.url;
  }catch(error){alert(error.message);submit.disabled=false;submit.textContent='Continue to Stripe';}
});

$('#exportBtn').onclick=()=>{const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),vaults},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='savemoney-backup.json';a.click();URL.revokeObjectURL(a.href);};

async function handleVaultPaymentReturn(){
  const params=new URLSearchParams(location.search),result=params.get('vault_payment');
  if(result==='cancelled'){history.replaceState({},'',location.pathname);setTimeout(()=>alert('Stripe sandbox checkout was cancelled. No money was charged.'),100);return;}
  if(result!=='success')return;
  const sessionId=params.get('session_id');
  if(!sessionId||!authSession?.accessToken)return;
  try{
    const response=await fetch('/api/apply-vault-payment',{method:'POST',headers:authHeaders(),body:JSON.stringify({sessionId})});
    const data=await response.json();
    if(!response.ok||!data.ok)throw new Error(data.error||'Could not apply payment.');
    history.replaceState({},'',location.pathname);
    await loadVaults();
    setTimeout(()=>alert(`${money(data.amount)} Stripe sandbox deposit confirmed and saved to your vault. It is now synced across your devices.`),100);
  }catch(error){
    setTimeout(()=>alert(`Stripe payment could not be applied: ${error.message}`),100);
  }
}

if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
render();
initializeAuth().then(signedIn=>{if(signedIn)handleVaultPaymentReturn();});
