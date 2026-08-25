(()=>{
  const $=s=>document.querySelector(s);
  const authToken=()=>authSession?.accessToken||'';
  let schedule=null;
  let backgroundReady=false;

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
    const summary=$('#autoPaySummary'),toggle=$('#toggleAutoPayBtn'),remove=$('#removeAutoPayBtn'),note=document.querySelector('.autoPayNote');
    refreshVaultOptions();
    if(!schedule){
      summary.textContent='No auto-pay schedule saved.';
      if(toggle)toggle.hidden=true;if(remove)remove.hidden=true;
      if(note)note.textContent=backgroundReady?'Background auto-pay is ready. Save a schedule to begin.':'Background auto-pay needs one final server security setting.';
      return;
    }
    const v=vaults.find(x=>x.id===schedule.vaultId);
    $('#autoPayVault').value=schedule.vaultId||'';
    $('#autoPaySource').value=schedule.source||'bank';
    $('#autoPayAmount').value=schedule.amount||'';
    $('#autoPayDay').value=schedule.day||1;
    $('#autoPayEnabled').checked=Boolean(schedule.enabled);
    summary.textContent=`${schedule.enabled?'Enabled':'Paused'} · $${Number(schedule.amount).toFixed(2)} on day ${schedule.day} each month · ${schedule.source==='bank'?'Bank account':'Debit card'} · ${v?.name||'Vault'}${schedule.lastStatus?` · Last status: ${schedule.lastStatus}`:''}`;
    if(toggle){toggle.hidden=false;toggle.textContent=schedule.enabled?'Pause auto-pay':'Enable auto-pay';}
    if(remove)remove.hidden=false;
    if(note)note.textContent=backgroundReady?'Runs from the SaveMoney server once daily, even when the app is closed. Sandbox only.':'Schedule is saved, but background execution needs the CRON_SECRET server setting.';
  }

  async function loadSchedule(){
    if(!authToken())return;
    try{
      const r=await fetch('/api/supabase-status',{headers:{Authorization:`Bearer ${authToken()}`}});
      const data=await r.json();
      if(!r.ok||!data.ok)throw new Error(data.error||'Could not load auto-pay.');
      schedule=data.schedule||null;backgroundReady=Boolean(data.backgroundReady);renderSchedule();
    }catch(err){$('#autoPaySummary').textContent=err.message;}
  }

  async function saveServerSchedule(next){
    const r=await fetch('/api/supabase-status',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${authToken()}`},body:JSON.stringify(next)});
    const data=await r.json();if(!r.ok||!data.ok)throw new Error(data.error||'Could not save auto-pay.');
    schedule=data.schedule;backgroundReady=Boolean(data.backgroundReady);renderSchedule();
  }

  $('#autoPayForm')?.addEventListener('submit',async e=>{
    e.preventDefault();
    const next={vaultId:$('#autoPayVault').value,source:$('#autoPaySource').value,amount:Number($('#autoPayAmount').value),day:Number($('#autoPayDay').value),enabled:$('#autoPayEnabled').checked,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'};
    if(!next.vaultId||!Number.isFinite(next.amount)||next.amount<0.50||next.day<1||next.day>28){alert('Choose a vault, at least $0.50, and a day from 1 to 28.');return;}
    const btn=e.submitter;btn.disabled=true;btn.textContent='Saving…';
    try{await saveServerSchedule(next);alert(`Auto-pay saved and ${next.enabled?'enabled':'paused'}. ${backgroundReady?'It can run while SaveMoney is closed.':'One server security setting is still needed for background runs.'}`);}catch(err){alert(err.message);}finally{btn.disabled=false;btn.textContent='Save auto-pay';}
  });

  $('#toggleAutoPayBtn')?.addEventListener('click',async()=>{
    if(!schedule)return;
    const btn=$('#toggleAutoPayBtn');btn.disabled=true;
    try{await saveServerSchedule({...schedule,enabled:!schedule.enabled});alert(`Auto-pay ${schedule.enabled?'enabled':'paused'}.`);}catch(err){alert(err.message);}finally{btn.disabled=false;}
  });

  $('#removeAutoPayBtn')?.addEventListener('click',async()=>{
    if(!schedule||!confirm('Remove this auto-pay schedule?'))return;
    const btn=$('#removeAutoPayBtn');btn.disabled=true;
    try{
      const r=await fetch('/api/supabase-status',{method:'DELETE',headers:{Authorization:`Bearer ${authToken()}`}});
      const data=await r.json();if(!r.ok||!data.ok)throw new Error(data.error||'Could not remove auto-pay.');
      schedule=null;$('#autoPayForm')?.reset();renderSchedule();alert('Auto-pay schedule removed.');
    }catch(err){alert(err.message);}finally{btn.disabled=false;}
  });

  function install(){
    const shell=$('#appShell');
    const observer=new MutationObserver(()=>{if(!shell.hidden)loadSchedule();});
    if(shell)observer.observe(shell,{attributes:true,attributeFilter:['hidden']});
    const vaultObserver=new MutationObserver(renderSchedule),list=$('#vaultList');if(list)vaultObserver.observe(list,{childList:true});
    renderSchedule();if(shell&&!shell.hidden)loadSchedule();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();
