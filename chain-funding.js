(()=>{
  const $=s=>document.querySelector(s);
  const method=$('#chainFundingMethod');
  const amount=$('#chainFundingAmount');
  const button=$('#chainFundingStart');
  const message=$('#chainFundingNote');
  const result=$('#chainFundingResult');
  if(!method||!amount||!button||!message||!result)return;

  let busy=false;
  const moneyText=n=>'$'+Number(n).toFixed(2);
  const getVault=()=>vaults.find(v=>v.id===$('#chainVaultPicker')?.value&&v.chain?.address);
  const token=()=>authSession?.accessToken||'';
  const setMessage=(text,isError=false)=>{
    result.textContent=text;result.hidden=!text;
    result.classList.toggle('error',isError);
  };
  function update(){
    if(busy)return;
    const linked=Boolean(getVault());
    const choice=method.value;
    button.disabled=choice!=='wallet'&&!linked;
    if(choice==='wallet'){
      button.textContent='Deposit test USDC via MetaMask';
      message.textContent='This is the only option that actually sends fake USDC into the selected blockchain contract. MetaMask approval and a Sepolia network fee are required.';
    }else if(choice==='card'){
      button.textContent='Test card checkout with Stripe';
      message.textContent=linked?
        'Stripe TEST checkout only. The payment will NOT create, buy, or transfer any USDC. Your on-chain vault balance remains unchanged.':
        'Choose a linked savings goal above to test a card checkout.';
    }else{
      button.textContent='Test bank transfer with Dwolla';
      message.textContent=linked?
        'Dwolla SANDBOX transfer only: test funds move from the test bank toward the Dwolla test balance. No USDC is bought or deposited into this smart contract.':
        'Choose a linked savings goal above to test a bank transfer.';
    }
  }

  async function start(){
    if(busy)return;
    const dollars=Number(amount.value);
    if(!Number.isFinite(dollars)||dollars<=0||dollars>10000||Math.round(dollars*100)/100!==dollars){
      setMessage('Enter an amount between $0.01 and $10,000.00 with no more than 2 decimals.',true);return;
    }
    const choice=method.value;
    setMessage('');
    if(choice==='wallet'){
      const current=$('#chainDepositAmount');
      const onChain=$('#chainDepositBtn');
      if(!current||!onChain){setMessage('Blockchain deposit controls are not available.',true);return;}
      if(onChain.disabled){setMessage('Connect MetaMask and select a locked vault that is still accepting deposits.',true);return;}
      current.value=dollars.toFixed(2);
      onChain.click();
      return;
    }
    const vault=getVault();
    if(!vault){setMessage('Select one of your blockchain savings goals before testing this payment.',true);return;}
    if(!token()){setMessage('Sign in to SaveMoney first.',true);return;}
    if(choice==='card'&&dollars<0.50){setMessage('Stripe test checkout requires at least $0.50.',true);return;}
    const notice=choice==='card'
      ?'This Stripe payment is TEST-ONLY. It does not purchase or send USDC to your vault. Continue to test card checkout?'
      :'This bank transfer is DWOLLA SANDBOX ONLY. It will not credit USDC to your vault. Continue with a test bank transfer?';
    if(!confirm(notice))return;
    busy=true;
    button.disabled=true;button.textContent=choice==='card'?'Opening Stripe test checkout…':'Starting Dwolla sandbox transfer…';
    try{
      const path=choice==='card'?'/api/create-vault-checkout':'/api/dwolla-test-transfer';
      const r=await fetch(path,{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+token()},
        body:JSON.stringify({vaultId:vault.id,amount:dollars,chainDemo:choice==='card'})
      });
      const data=await r.json();
      if(!r.ok||!data.ok)throw new Error(data.error||'The sandbox payment could not be started.');
      if(choice==='card'){
        if(!data.url||!data.sandbox)throw new Error('Stripe did not return a sandbox checkout URL.');
        window.location.assign(data.url);
      }else{
        const status=data.status||'created';
        setMessage('Dwolla TEST transfer '+status+' for '+moneyText(dollars)+'. This did NOT transfer USDC or credit your blockchain vault. Transfer ID: '+(data.transferId||'not available'));
      }
    }catch(e){setMessage(e?.message||'Could not start the test.',true);}
    finally{busy=false;update();}
  }
  method.addEventListener('change',()=>{setMessage('');update();});
  button.addEventListener('click',start);
  $('#chainVaultPicker')?.addEventListener('change',()=>{setMessage('');update();});
  window.addEventListener('savemoney:rendered',update);
  update();
})();
