(()=>{
  function install(){
    const bankCard=document.querySelector('#dwollaBankVerifyCard');
    if(!bankCard||document.querySelector('#dwollaTransferTestBtn'))return;

    const section=document.createElement('section');
    section.className='card bankCard';
    section.id='dwollaTransferTestCard';
    section.innerHTML=`<div><p class="eyebrow">DWOLLA SANDBOX</p><h2>Test bank → Dwolla Balance</h2><p class="muted">Moves $1.00 of sandbox funds from SaveMoney Test Checking into the verified customer's Dwolla Balance. No real money moves.</p></div><button id="dwollaTransferTestBtn" class="secondary">Test $1 transfer</button>`;
    bankCard.insertAdjacentElement('afterend',section);

    const btn=document.querySelector('#dwollaTransferTestBtn');
    btn.onclick=async()=>{
      if(!authSession?.accessToken){alert('Sign in first.');return;}
      btn.disabled=true;btn.textContent='Sending $1…';
      try{
        const r=await fetch('/api/dwolla-test-transfer',{
          method:'POST',
          headers:{'Content-Type':'application/json',Authorization:`Bearer ${authSession.accessToken}`}
        });
        const data=await r.json();
        if(!r.ok||!data.ok)throw new Error(data.error||'Could not create Dwolla sandbox transfer.');
        btn.textContent='Transfer created ✓';
        alert(`$1.00 Dwolla sandbox transfer created. Status: ${data.status||'created'}. No real money moved.`);
      }catch(err){
        alert(err.message);
        btn.disabled=false;btn.textContent='Test $1 transfer';
      }
    };
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();
