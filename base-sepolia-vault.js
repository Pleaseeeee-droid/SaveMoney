(async()=>{
  // Base Sepolia testnet ONLY. No production USDC, custody, or fiat settlement.
  const {BrowserProvider,JsonRpcProvider,Contract,Interface,formatUnits,parseUnits,isAddress}=await import('https://cdn.jsdelivr.net/npm/ethers@6.13.5/+esm');
  const CHAIN_HEX='0x14a34';
  const CHAIN_ID=84532n;
  const USDC='0x036CbD53842c5426634e7929541eC2318f3dCF7e';
  const VAULT_ABI=[
    'function balance() view returns (uint256)',
    'function beneficiary() view returns (address)',
    'function unlockTime() view returns (uint256)',
    'function USDC() view returns (address)',
    'function CHAIN_ID() view returns (uint256)',
    'function deposit(uint256)',
    'function withdraw()'
  ];
  const LOCK_CHECK_ABI=new Interface(['function withdraw()','error VaultLocked()']);
  const LOCKED_REVERT_SELECTOR=LOCK_CHECK_ABI.getError('VaultLocked').selector.toLowerCase();
  const TOKEN_ABI=[
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address,address) view returns (uint256)',
    'function approve(address,uint256) returns (bool)'
  ];
  const $=s=>document.querySelector(s);
  const readProvider=new JsonRpcProvider('https://sepolia.base.org',Number(CHAIN_ID),{staticNetwork:true});
  let signer=null,account=null,busy=false,selectedId=null,unlock=0n,rawVaultBalance=0n,beneficiary=null;
  const short=s=>s?s.slice(0,8)+'…'+s.slice(-6):'—';
  const fmt=amount=>Number(formatUnits(amount,6)).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  function status(s,bad=false){
    const el=$('#baseSepoliaStatus');if(!el)return;
    el.textContent=s;el.className=bad?'chainStatus error':'chainStatus';
  }
  function selected(){
    return vaults.find(v=>v.id===selectedId&&v.chain?.address&&Number(v.chain.chainId)===Number(CHAIN_ID))||null;
  }
  function setDisabled(){
    const verifyBtn=$('#baseSepoliaTestLockBtn');
    if(verifyBtn)verifyBtn.disabled=busy||!selected();
    const v=selected();
    const now=BigInt(Math.floor(Date.now()/1000));
    const locked=unlock>now;
    $('#baseSepoliaDepositBtn').disabled=busy||!v||!signer||!locked;
    $('#baseSepoliaWithdrawBtn').disabled=busy||!v||!signer||locked||!rawVaultBalance||
      String(account||'').toLowerCase()!==String(beneficiary||'').toLowerCase();
    $('#baseSepoliaConnectBtn').disabled=busy;
    $('#baseSepoliaRefreshBtn').disabled=busy;
  }
  function resetDisplay(){
    unlock=0n;rawVaultBalance=0n;beneficiary=null;
    $('#baseSepoliaLockedBalance').textContent='—';
    $('#baseSepoliaWalletBalance').textContent=account?'Checking…':'Connect MetaMask';
    $('#baseSepoliaUnlock').textContent='—';
    $('#baseSepoliaAddress').textContent='—';
    $('#baseSepoliaBeneficiary').textContent='—';
    $('#baseSepoliaLockBadge').textContent='Not selected';
    const output=$('#baseSepoliaLockResult');if(output){output.textContent='';output.hidden=true;}
    $('#baseSepoliaExplorer').hidden=true;
    setDisabled();
  }
  function sync(){
    const menu=$('#baseSepoliaVaultPicker');if(!menu)return;
    const entries=vaults.filter(v=>v.chain?.address&&Number(v.chain.chainId)===Number(CHAIN_ID));
    menu.innerHTML='';
    if(!entries.length){
      const option=document.createElement('option');option.value='';option.textContent='No Base Sepolia test vaults yet';menu.append(option);
      selectedId=null;resetDisplay();
      status('Create a new savings goal and choose Base Sepolia test vault to begin. No real money is used.');
      return;
    }
    for(const v of entries){
      const option=document.createElement('option');option.value=v.id;option.textContent=v.name+' — '+short(v.chain.address);menu.append(option);
    }
    const next=entries.some(v=>v.id===selectedId)?selectedId:entries[0].id;
    menu.value=next;
    if(next!==selectedId)select(next);
    else refresh().catch(e=>status(e?.message||'Could not refresh test vault.',true));
  }
  function select(id){
    const v=vaults.find(v=>v.id===id&&v.chain?.address&&Number(v.chain.chainId)===Number(CHAIN_ID));
    if(!v)return;
    selectedId=id;
    const menu=$('#baseSepoliaVaultPicker');
    if(menu)menu.value=id;
    resetDisplay();
    refresh().catch(e=>status(e?.message||'Could not load test vault.',true));
  }
  async function refresh(){
    const v=selected();if(!v){resetDisplay();return;}
    const address=v.chain.address;
    const targetId=selectedId;
    try{
      if(!isAddress(address))throw new Error('The saved vault address is invalid.');
      const code=await readProvider.getCode(address);
      if(code==='0x')throw new Error('No Base Sepolia contract exists at the saved address.');
      const c=new Contract(address,VAULT_ABI,readProvider);
      const [amount,onBeneficiary,onUnlock,onUSDC,onChain]=await Promise.all([
        c.balance(),c.beneficiary(),c.unlockTime(),c.USDC(),c.CHAIN_ID()
      ]);
      if(selectedId!==targetId)return;
      if(onBeneficiary.toLowerCase()!==v.chain.beneficiary.toLowerCase()||
         onUSDC.toLowerCase()!==USDC.toLowerCase()||
         Number(onChain)!==Number(CHAIN_ID)||
         Number(onUnlock)!==Number(v.chain.unlockTimestamp))
        throw new Error('Contract details do not match this savings goal. Deposits are blocked.');
      unlock=onUnlock;rawVaultBalance=amount;beneficiary=onBeneficiary;
      const locked=BigInt(Math.floor(Date.now()/1000))<unlock;
      $('#baseSepoliaLockedBalance').textContent=fmt(amount)+' test USDC';
      $('#baseSepoliaUnlock').textContent=new Date(Number(unlock)*1000).toLocaleString();
      $('#baseSepoliaAddress').textContent=short(address);
      $('#baseSepoliaBeneficiary').textContent=short(beneficiary);
      $('#baseSepoliaLockBadge').textContent=locked?'🔒 Test lock active':'Test vault unlocked';
      const link=$('#baseSepoliaExplorer');link.href='https://sepolia.basescan.org/address/'+address;link.hidden=false;
      const card=document.querySelector('[data-chain-vault="'+targetId+'"] .vaultAmount');
      if(card)card.textContent=fmt(amount)+' test USDC';
      const progress=document.querySelector('[data-chain-vault="'+targetId+'"] .progressBar');
      if(progress)progress.style.width=Math.min(100,Math.max(0,Number(formatUnits(amount,6))/v.goal*100))+'%';
      if(account){
        const t=new Contract(USDC,TOKEN_ABI,readProvider);
        const walletAmount=await t.balanceOf(account);
        if(selectedId!==targetId)return;
        $('#baseSepoliaWalletBalance').textContent=fmt(walletAmount)+' test USDC';
      }else $('#baseSepoliaWalletBalance').textContent='Connect MetaMask';
      status(locked?'Test vault verified on Base Sepolia. Early withdrawals are enforced by its contract.':'Test vault unlocked on Base Sepolia. Only its beneficiary may withdraw.');
      setDisabled();
    }catch(e){
      unlock=0n;rawVaultBalance=0n;
      $('#baseSepoliaLockedBalance').textContent='Unable to verify';
      setDisabled();status(e?.shortMessage||e?.message||'Unable to verify contract.',true);
    }
  }

  function readRevertData(error){
    // RPC providers expose the Solidity revert data at different nesting depths.
    const candidates=[
      error?.data,error?.error?.data,error?.info?.error?.data,
      error?.revert?.data,error?.info?.error?.error?.data
    ];
    return candidates.find(x=>typeof x==='string'&&/^0x[0-9a-f]*$/i.test(x))||null;
  }
  async function testEarlyWithdrawalLock(){
    const output=$('#baseSepoliaLockResult');
    const button=$('#baseSepoliaTestLockBtn');
    const v=selected();
    if(!v||!output||busy)return;
    const id=selectedId;
    busy=true;setDisabled();
    output.hidden=false;
    output.textContent='Checking the contract without submitting a transaction…';
    output.classList.remove('error');
    try{
      // Do not trust merely the disabled withdrawal button or the saved unlock date.
      const contract=new Contract(v.chain.address,VAULT_ABI,readProvider);
      const [from,onUnlock,onToken,onChain,lockedBalance]=await Promise.all([
        contract.beneficiary(),contract.unlockTime(),contract.USDC(),contract.CHAIN_ID(),contract.balance()
      ]);
      if(selectedId!==id)return;
      if(from.toLowerCase()!==String(v.chain.beneficiary).toLowerCase()||
         onToken.toLowerCase()!==USDC.toLowerCase()||
         Number(onChain)!==Number(CHAIN_ID)||
         Number(onUnlock)!==Number(v.chain.unlockTimestamp))
        throw new Error('Contract identity mismatch. The lock cannot be verified.');
      const chainBlock=await readProvider.getBlock('latest');
      if(!chainBlock)throw new Error('Could not read the latest Base Sepolia block.');
      if(lockedBalance<=0n)throw new Error('Deposit test USDC before checking early withdrawal.');
      if(BigInt(chainBlock.timestamp)>=onUnlock)
        throw new Error('This vault is already unlocked. An early-withdrawal check no longer applies.');
      let revert=null;
      try{
        // A read-only eth_call sets msg.sender to the beneficiary but does not sign,
        // spend gas or broadcast a real transaction.
        await readProvider.call({
          from,to:v.chain.address,data:LOCK_CHECK_ABI.encodeFunctionData('withdraw')
        },chainBlock.number);
      }catch(e){revert=e;}
      if(selectedId!==id)return;
      if(!revert){
        output.classList.add('error');
        output.textContent='WARNING: The early withdrawal simulation did not revert. Do not treat this vault as securely locked.';
        return;
      }
      const data=readRevertData(revert);
      const known=(data&&data.toLowerCase().startsWith(LOCKED_REVERT_SELECTOR))||
        revert?.revert?.name==='VaultLocked';
      if(known){
        output.textContent='PASS: The live Base Sepolia contract rejected an early withdrawal with VaultLocked(). No transaction was sent and no test ETH was spent.';
      }else{
        output.classList.add('error');
        output.textContent='INCONCLUSIVE: The blockchain rejected the simulated call, but the reason could not be confirmed as VaultLocked(). No transaction was sent. '+(revert.shortMessage||revert.message||'');
      }
    }catch(e){
      if(selectedId===id){
        output.classList.add('error');
        output.textContent='Unable to verify: '+(e?.shortMessage||e?.message||'Unknown RPC error')+'. No transaction was sent.';
      }
    }finally{busy=false;setDisabled();}
  }

  async function ensureWallet(){
    if(!window.ethereum)throw new Error('MetaMask is required for test transactions.');
    const id=await window.ethereum.request({method:'eth_chainId'});
    if(id!==CHAIN_HEX){
      try{await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:CHAIN_HEX}]});}
      catch(e){
        if(e.code!==4902)throw e;
        await window.ethereum.request({method:'wallet_addEthereumChain',params:[{
          chainId:CHAIN_HEX,chainName:'Base Sepolia',
          nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},
          rpcUrls:['https://sepolia.base.org'],blockExplorerUrls:['https://sepolia.basescan.org']
        }]});
      }
    }
    if((await window.ethereum.request({method:'eth_chainId'}))!==CHAIN_HEX)
      throw new Error('MetaMask is not on Base Sepolia.');
    await window.ethereum.request({method:'eth_requestAccounts'});
    const provider=new BrowserProvider(window.ethereum);
    if((await provider.getNetwork()).chainId!==CHAIN_ID)
      throw new Error('Wallet is connected to the wrong network.');
    signer=await provider.getSigner();
    account=await signer.getAddress();
    $('#baseSepoliaConnectBtn').textContent='Connected '+short(account);
  }
  async function connect(){
    if(busy)return;
    busy=true;setDisabled();
    status('Connecting MetaMask to Base Sepolia testnet…');
    try{await ensureWallet();await refresh();}
    catch(e){status(e?.shortMessage||e?.message||'Wallet connection failed.',true);}
    finally{busy=false;setDisabled();}
  }
  async function deposit(){
    const v=selected();if(busy||!v)return;
    const entered=$('#baseSepoliaAmount').value.trim();
    let units;
    try{units=parseUnits(entered,6);}catch{status('Enter a valid test USDC amount with up to 6 decimal places.',true);return;}
    if(units<=0n){status('Enter a test USDC amount greater than zero.',true);return;}
    busy=true;setDisabled();
    try{
      await ensureWallet();await refresh();
      if(BigInt(Math.floor(Date.now()/1000))>=unlock)throw new Error('The deposit window has closed.');
      const token=new Contract(USDC,TOKEN_ABI,signer);
      const vault=new Contract(v.chain.address,VAULT_ABI,signer);
      const existing=await token.allowance(account,v.chain.address);
      if(existing<units){
        status('MetaMask: approve exactly '+entered+' TEST USDC for this vault…');
        const approve=await token.approve(v.chain.address,units);await approve.wait();
      }
      status('MetaMask: confirm transfer into the Base Sepolia hard-lock TEST vault…');
      const tx=await vault.deposit(units);await tx.wait();
      await refresh();
      status('Confirmed: test USDC deposited on Base Sepolia. No real money moved.');
      alert('Your test USDC deposit was confirmed. No real money moved.');
    }catch(e){status(e?.shortMessage||e?.message||'Test deposit failed.',true);}
    finally{busy=false;setDisabled();}
  }
  async function withdraw(){
    const v=selected();if(busy||!v)return;
    busy=true;setDisabled();
    try{
      await ensureWallet();await refresh();
      if(!rawVaultBalance)throw new Error('The test vault is empty.');
      if(BigInt(Math.floor(Date.now()/1000))<unlock)throw new Error('This test vault is still locked.');
      if(String(account).toLowerCase()!==String(beneficiary).toLowerCase())
        throw new Error('Only the vault beneficiary can withdraw.');
      status('Confirm the test withdrawal in MetaMask…');
      const c=new Contract(v.chain.address,VAULT_ABI,signer);
      const tx=await c.withdraw();await tx.wait();
      await refresh();status('Test tokens returned to your beneficiary wallet.');
    }catch(e){status(e?.shortMessage||e?.message||'Test withdrawal failed.',true);}
    finally{busy=false;setDisabled();}
  }
  function install(){
    $('#baseSepoliaConnectBtn')?.addEventListener('click',connect);
    $('#baseSepoliaRefreshBtn')?.addEventListener('click',refresh);
    $('#baseSepoliaDepositBtn')?.addEventListener('click',deposit);
    $('#baseSepoliaWithdrawBtn')?.addEventListener('click',withdraw);
    $('#baseSepoliaTestLockBtn')?.addEventListener('click',testEarlyWithdrawalLock);
    $('#baseSepoliaVaultPicker')?.addEventListener('change',e=>select(e.target.value));
    window.addEventListener('savemoney:rendered',sync);
    window.SaveMoneyBaseApp={sync,select};
    // Network/account change never triggers a transaction or an automatic network switch.
    window.ethereum?.on?.('accountsChanged',()=>{signer=null;account=null;$('#baseSepoliaConnectBtn').textContent='Connect MetaMask';refresh();});
    window.ethereum?.on?.('chainChanged',()=>{signer=null;account=null;$('#baseSepoliaConnectBtn').textContent='Connect MetaMask';refresh();});
    resetDisplay();
    sync();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);
  else install();
})().catch(error=>{
  const el=document.querySelector('#baseSepoliaStatus');
  if(el){el.textContent='Base Sepolia module did not load: '+(error?.message||'unknown error');el.className='chainStatus error';}
  console.error(error);
});