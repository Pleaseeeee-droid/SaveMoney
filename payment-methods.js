(()=>{
  let stripe=null;
  let cardElement=null;
  let setupClientSecret=null;

  const $=s=>document.querySelector(s);
  const authToken=()=>authSession?.accessToken||'';
  const brandName=s=>String(s||'Card').replace(/^./,c=>c.toUpperCase());

  function setEmpty(message){
    const list=$('#paymentMethodList');
    if(list)list.innerHTML=`<div class="paymentMethodEmpty">${message}</div>`;
  }

  async function loadPaymentMethods(){
    if(!authToken())return;
    const list=$('#paymentMethodList');
    if(!list)return;
    list.innerHTML='<div class="paymentMethodEmpty">Loading payment methods…</div>';

    const items=[];
    try{
      const r=await fetch('/api/stripe-status?action=payment-methods',{
        headers:{Authorization:`Bearer ${authToken()}`}
      });
      const data=await r.json();
      if(r.ok&&data.ok){
        for(const card of data.cards||[]){
          items.push(`<div class="paymentMethodRow"><div class="paymentMethodIcon">💳</div><div><strong>${brandName(card.brand)} •••• ${card.last4}</strong><span>Expires ${String(card.expMonth||'').padStart(2,'0')}/${String(card.expYear||'').slice(-2)} · Stripe ${data.sandbox?'Sandbox':''}</span></div><span class="methodStatus">Saved</span></div>`);
        }
      }
    }catch{}

    try{
      const r=await fetch('/api/dwolla-verify-bank',{
        headers:{Authorization:`Bearer ${authToken()}`}
      });
      const data=await r.json();
      if(r.ok&&data.ok&&data.bank){
        const verified=data.bank.status==='verified';
        items.push(`<div class="paymentMethodRow"><div class="paymentMethodIcon">🏦</div><div><strong>${data.bank.name||'SaveMoney Test Checking'}</strong><span>Bank account · Dwolla Sandbox</span></div><span class="methodStatus ${verified?'verified':''}">${verified?'Verified':'Connected'}</span></div>`);
        const bankBtn=$('#connectBankBtn');
        if(bankBtn&&verified){bankBtn.textContent='Bank connected ✓';bankBtn.disabled=true;}
      }
    }catch{}

    list.innerHTML=items.length?items.join(''):'<div class="paymentMethodEmpty">No payment methods saved yet.</div>';
  }

  function clearCardElement(){
    try{cardElement?.destroy();}catch{}
    cardElement=null;stripe=null;setupClientSecret=null;
    const mount=$('#stripeCardElement');if(mount)mount.innerHTML='';
    const error=$('#cardSetupError');if(error){error.hidden=true;error.textContent='';}
  }

  async function openCardSetup(){
    const btn=$('#addCardBtn');
    if(!btn||!authToken())return;
    btn.disabled=true;btn.textContent='Preparing secure card form…';
    try{
      const r=await fetch('/api/stripe-status?action=setup-card',{
        method:'POST',
        headers:{Authorization:`Bearer ${authToken()}`}
      });
      const data=await r.json();
      if(!r.ok||!data.ok)throw new Error(data.error||'Could not start card setup.');
      if(typeof window.Stripe!=='function')throw new Error('Stripe secure fields did not load. Refresh the page and try again.');

      clearCardElement();
      stripe=window.Stripe(data.publishableKey);
      setupClientSecret=data.clientSecret;
      const elements=stripe.elements();
      cardElement=elements.create('card',{
        style:{
          base:{color:'#f5f7fb',fontSize:'16px','::placeholder':{color:'#71859d'}},
          invalid:{color:'#ff9baa'}
        }
      });
      cardElement.mount('#stripeCardElement');
      $('#cardSetupDialog').showModal();
    }catch(err){
      alert(err.message);
    }finally{
      btn.disabled=false;btn.textContent='Add debit card';
    }
  }

  async function saveCard(e){
    e.preventDefault();
    if(!stripe||!cardElement||!setupClientSecret)return;
    const btn=$('#saveCardBtn'),error=$('#cardSetupError');
    btn.disabled=true;btn.textContent='Saving securely…';error.hidden=true;
    try{
      const result=await stripe.confirmCardSetup(setupClientSecret,{payment_method:{card:cardElement}});
      if(result.error)throw new Error(result.error.message||'Stripe could not save this card.');
      $('#cardSetupDialog').close();
      clearCardElement();
      await loadPaymentMethods();
      alert('Card saved securely with Stripe Sandbox. SaveMoney only displays masked card details.');
    }catch(err){
      error.textContent=err.message;error.hidden=false;
    }finally{
      btn.disabled=false;btn.textContent='Save card';
    }
  }

  function install(){
    $('#addCardBtn')?.addEventListener('click',openCardSetup);
    $('#closeCardSetupBtn')?.addEventListener('click',()=>{$('#cardSetupDialog').close();clearCardElement();});
    $('#cardSetupForm')?.addEventListener('submit',saveCard);
    $('#connectBankBtn')?.addEventListener('click',()=>alert('Your Dwolla sandbox bank is already managed through the secure Dwolla connection. A live in-app bank-linking screen will use a provider such as Plaid rather than storing your routing/account numbers in SaveMoney.'));

    const observer=new MutationObserver(()=>{
      if(!$('#appShell')?.hidden&&authToken())loadPaymentMethods();
    });
    const shell=$('#appShell');if(shell)observer.observe(shell,{attributes:true,attributeFilter:['hidden']});
    if(shell&&!shell.hidden&&authToken())loadPaymentMethods();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();
