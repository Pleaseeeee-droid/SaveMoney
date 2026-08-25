(()=>{
  function install(){
    const customerCard=document.querySelector('#dwollaSetupCard');
    if(!customerCard||document.querySelector('#dwollaBankVerifyBtn'))return;

    const section=document.createElement('section');
    section.className='card bankCard';
    section.id='dwollaBankVerifyCard';
    section.innerHTML=`<div><p class="eyebrow">DWOLLA SANDBOX</p><h2 id="dwollaBankVerifyTitle">Verify test bank account</h2><p id="dwollaBankVerifyText" class="muted">Uses Dwolla Sandbox micro-deposits to verify SaveMoney Test Checking. No real deposits or bank money move.</p></div><button id="dwollaBankVerifyBtn" class="secondary">Verify test bank</button>`;
    customerCard.insertAdjacentElement('afterend',section);

    const btn=document.querySelector('#dwollaBankVerifyBtn');
    const title=document.querySelector('#dwollaBankVerifyTitle');
    const text=document.querySelector('#dwollaBankVerifyText');

    async function status(){
      if(!authSession?.accessToken)return;
      try{
        const r=await fetch('/api/dwolla-verify-bank',{headers:{Authorization:`Bearer ${authSession.accessToken}`}});
        const data=await r.json();
        if(!r.ok||!data.ok)return;
        if(data.bank?.status==='verified'){
          title.textContent='Test bank account verified';
          text.textContent='SaveMoney Test Checking is verified in Dwolla Sandbox and can be used for sandbox transfers.';
          btn.textContent='Verified ✓';
          btn.disabled=true;
        }
      }catch{}
    }

    btn.onclick=async()=>{
      if(!authSession?.accessToken){alert('Sign in first.');return;}
      btn.disabled=true;btn.textContent='Verifying…';
      try{
        const r=await fetch('/api/dwolla-verify-bank',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${authSession.accessToken}`}});
        const data=await r.json();
        if(!r.ok||!data.ok)throw new Error(data.error||'Could not verify Dwolla sandbox bank.');
        if(data.bank?.status!=='verified')throw new Error(`Dwolla returned bank status: ${data.bank?.status||'unknown'}.`);
        title.textContent='Test bank account verified';
        text.textContent='SaveMoney Test Checking is verified in Dwolla Sandbox and can be used for sandbox transfers.';
        btn.textContent='Verified ✓';
        btn.disabled=true;
        alert('Dwolla sandbox bank verified. No real money moved.');
      }catch(err){
        alert(err.message);
        btn.disabled=false;btn.textContent='Verify test bank';
      }
    };

    status();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();
