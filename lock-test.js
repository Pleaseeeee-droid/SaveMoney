(()=>{
  function install(){
    const shell=document.querySelector('#appShell');
    if(!shell||document.querySelector('#lockSafetyTest'))return;

    const section=document.createElement('section');
    section.id='lockSafetyTest';
    section.className='card bankCard';
    section.innerHTML=`<div><p class="eyebrow">LOCK SAFETY TEST</p><h2>Verify the database lock</h2><p class="muted">Attempts a $1 sandbox withdrawal from your first locked vault. A correct result is BLOCKED. No real money moves.</p></div><button id="testLockBtn" class="secondary">Test locked withdrawal</button>`;
    shell.append(section);

    document.querySelector('#testLockBtn').onclick=async()=>{
      const btn=document.querySelector('#testLockBtn');
      const lockedVault=(typeof vaults!=='undefined'?vaults:[]).find(v=>typeof unlocked==='function'&&!unlocked(v)&&Number(v.balance||0)>=1);
      if(!lockedVault){
        alert('You need a locked vault with at least $1 of sandbox balance for this test.');
        return;
      }
      if(!authSession?.accessToken){alert('Sign in first.');return;}

      btn.disabled=true;
      btn.textContent='Testing…';
      try{
        const r=await fetch('/api/test-locked-withdrawal',{
          method:'POST',
          headers:{'Content-Type':'application/json',Authorization:`Bearer ${authSession.accessToken}`},
          body:JSON.stringify({vaultId:lockedVault.id})
        });
        const data=await r.json();
        if(data.ok&&data.blocked){
          alert(`PASS: Supabase blocked the $1 withdrawal from “${lockedVault.name}”.\n\n${data.message}`);
        }else{
          alert(`TEST DID NOT PASS: ${data.error||data.message||'Unexpected response.'}`);
          if(typeof loadVaults==='function')await loadVaults();
        }
      }catch(err){
        alert(`Could not run the lock test: ${err.message}`);
      }finally{
        btn.disabled=false;
        btn.textContent='Test locked withdrawal';
      }
    };
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();
