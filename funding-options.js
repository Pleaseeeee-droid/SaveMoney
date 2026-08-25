(()=>{
  const AUTO_KEY='savemoney.autopay.v1';
  const $=s=>document.querySelector(s);
  const authToken=()=>authSession?.accessToken||'';
  const monthKey=()=>new Date().toISOString().slice(0,7);

  function loadSchedule(){
    try{return JSON.parse(localStorage.getItem(AUTO_KEY)||'null');}catch{return null;}
  }
  function saveSchedule(schedule){localStorage.setItem(AUTO_KEY,JSON.stringify(schedule));}
  function removeSchedule(){localStorage.removeItem(AUTO_KEY);}

  const originalOpenAction=openAction;
  openAction=function(id,type){
    originalOpenAction(id,type);
    const row=$('#fundingSourceRow');
    if(!row)return;
    row.hidden=type!=='add';
    if(type==='add'){
      $('#actionDescription').textContent='Choose whether to add money from your connected bank account or by debit card.';
      $('#actionSubmit').textContent=$('#fundingSource').value==='bank'?'Transfer from bank':'Continue to Stripe';
    }
  };

  $('#fundingSource')?.addEventListener('change',e=>{
    if(activeAction?.type!=='add')return;
    $('#actionSubmit').textContent=e.target.value==='bank'?'Transfer from bank':'Continue to Stripe';
  });

  $('#actionForm')?.addEventListener('submit',async e=>{
    if(activeAction?.type!=='add'||$('#fundingSource')?.value!=='bank')return;
    e.preventDefault();e.stopImmediatePropagation();
    const v=vaults.find(x=>x.id===activeAction.id),amount=Number($('#actionAmount').value),submit=$('#actionSubmit');
    if(!v||!Number.isFinite(amount)||amount<=0)return;
    submit.disabled=true;submit.textContent='Starting bank transfer…';
    try{
      const r=await fetch('/api/dwolla-test-transfer',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${authToken()}`},body:JSON.stringify({vaultId:v.id,amount})});
      const data=await r.json();
      if(!r.ok||!data.ok)throw new Error(data.error||'Could not start bank transfer.');
      $('#actionDialog').close();activeAction=null;
      alert(`${money(amount)} Dwolla sandbox bank transfer started for “${v.name}”. Status: ${data.status||'created'}. The vault is not credited until the transfer is processed.`);
    }catch(err){alert(err.message);}finally{submit.disabled=false;submit.textContent='Transfer from bank';}
  },true);

  function refreshVaultOptions(){
    const select=$('#autoPayVault');if(!select)return;
    const current=select.value;
    select.innerHTML=vaults.map(v=>`<option value="${v.id}">${escapeHtml(v.name)}</option>`).join('');
    if(vaults.some(v=>v.id===current))select.value=current;
  }

  function renderSchedule(){
    const s=loadSchedule(),summary=$('#autoPaySummary'),toggle=$('#toggleAutoPayBtn'),remove=$('#removeAutoPayBtn');
    refreshVaultOptions();
    if(!s){
      summary.textContent='No auto-pay schedule saved.';
      if(toggle)toggle.hidden=true;
      if(remove)remove.hidden=true;
      return;
    }
    const v=vaults.find(x=>x.id===s.vaultId);
    $('#autoPayVault').value=s.vaultId||'';
    $('#autoPaySource').value=s.source||'bank';
    $('#autoPayAmount').value=s.amount||'';
    $('#autoPayDay').value=s.day||1;
    $('#autoPayEnabled').checked=Boolean(s.enabled);
    summary.textContent=`${s.enabled?'Enabled':'Paused'} · $${Number(s.amount).toFixed(2)} on day ${s.day} each month · ${s.source==='bank'?'Bank account':'Debit card'} · ${v?.name||'Vault'}`;
    if(toggle){toggle.hidden=false;toggle.textContent=s.enabled?'Pause auto-pay':'Enable auto-pay';}
    if(remove)remove.hidden=false;
  }

  $('#autoPayForm')?.addEventListener('submit',e=>{
    e.preventDefault();
    const existing=loadSchedule()||{};
    const schedule={
      ...existing,
      vaultId:$('#autoPayVault').value,
      source:$('#autoPaySource').value,
      amount:Number($('#autoPayAmount').value),
      day:Number($('#autoPayDay').value),
      enabled:$('#autoPayEnabled').checked,
      timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'
    };
    if(!schedule.vaultId||!Number.isFinite(schedule.amount)||schedule.amount<=0||schedule.day<1||schedule.day>28){alert('Choose a vault, amount, and day from 1 to 28.');return;}
    saveSchedule(schedule);renderSchedule();
    alert(`Sandbox auto-pay saved and ${schedule.enabled?'enabled':'paused'}. Background execution is being moved to the server so it can run while SaveMoney is closed.`);
  });

  $('#toggleAutoPayBtn')?.addEventListener('click',()=>{
    const s=loadSchedule();if(!s)return;
    s.enabled=!s.enabled;saveSchedule(s);renderSchedule();
    alert(`Auto-pay ${s.enabled?'enabled':'paused'}.`);
  });

  $('#removeAutoPayBtn')?.addEventListener('click',()=>{
    const s=loadSchedule();if(!s)return;
    if(!confirm('Remove this auto-pay schedule?'))return;
    removeSchedule();
    $('#autoPayForm')?.reset();
    renderSchedule();
    alert('Auto-pay schedule removed.');
  });

  async function runAutoPayIfDue(){
    const s=loadSchedule();if(!s?.enabled||!authToken())return;
    const now=new Date();if(now.getDate()!==Number(s.day))return;
    const runKey=`${monthKey()}-d${s.day}-a${Number(s.amount).toFixed(2).replace('.','')}`;
    if(s.lastAttempt===runKey)return;
    s.lastAttempt=runKey;saveSchedule(s);
    try{
      const url=s.source==='card'?'/api/stripe-status?action=autopay-charge':'/api/dwolla-test-transfer';
      const body={vaultId:s.vaultId,amount:Number(s.amount),scheduleKey:runKey};
      const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${authToken()}`},body:JSON.stringify(body)});
      const data=await r.json();
      if(!r.ok||!data.ok)throw new Error(data.error||'Auto-pay failed.');
      s.lastSuccess=runKey;saveSchedule(s);
      if(s.source==='card'){await loadVaults();alert(`Sandbox auto-pay added ${money(s.amount)} by saved debit card.`);}
      else alert(`Sandbox auto-pay started a ${money(s.amount)} bank transfer. It is pending until Dwolla processes it.`);
    }catch(err){alert(`Sandbox auto-pay could not run: ${err.message}`);}
  }

  function install(){
    const shell=$('#appShell');
    const observer=new MutationObserver(()=>{if(!shell.hidden){renderSchedule();setTimeout(runAutoPayIfDue,800);}});
    if(shell)observer.observe(shell,{attributes:true,attributeFilter:['hidden']});
    const vaultObserver=new MutationObserver(renderSchedule);const list=$('#vaultList');if(list)vaultObserver.observe(list,{childList:true});
    renderSchedule();if(shell&&!shell.hidden)setTimeout(runAutoPayIfDue,800);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();
