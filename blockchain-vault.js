(async()=>{
  const { BrowserProvider, JsonRpcProvider, Contract, formatUnits, parseUnits } = await import('https://cdn.jsdelivr.net/npm/ethers@6.13.5/+esm');
  const style=document.createElement('link');style.rel='stylesheet';style.href='blockchain-vault.css?v=1';document.head.appendChild(style);
  const $=s=>document.querySelector(s);
  const CHAIN_ID='0xaa36a7';
  const TOKEN_ADDRESS='0x5Df8a09276305F6c3c3F523bE5FF4fDE4829Dc92';
  const VAULT_ADDRESS='0x2128E0ed09DeD1F2031DE0B28bfbaE94EfcfCb89';
  const TOKEN_DECIMALS=6;
  const TOKEN_ABI=[
    'function balanceOf(address account) view returns (uint256)',
    'function approve(address spender,uint256 amount) returns (bool)'
  ];
  const VAULT_ABI=[
    'function balance() view returns (uint256)',
    'function unlockTime() view returns (uint256)',
    'function beneficiary() view returns (address)',
    'function token() view returns (address)',
    'function deposit(uint256 amount)',
    'function withdraw()'
  ];

  let provider=null;
  let signer=null;
  let account=null;
  let unlockTimestamp=0;

  const short=a=>a?`${a.slice(0,6)}…${a.slice(-4)}`:'Not connected';
  const fmt=n=>new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n||0));

  function setStatus(message,type=''){
    const el=$('#chainStatus');
    if(!el)return;
    el.textContent=message;
    el.className=`chainStatus ${type}`.trim();
  }

  function setBusy(busy){
    ['#chainConnectBtn','#chainRefreshBtn','#chainDepositBtn'].forEach(sel=>{const b=$(sel);if(b)b.disabled=busy;});
    const withdraw=$('#chainWithdrawBtn');
    if(withdraw)withdraw.disabled=busy||!unlockTimestamp||Math.floor(Date.now()/1000)<unlockTimestamp;
  }

  async function ensureSepolia(){
    if(!window.ethereum)throw new Error('MetaMask was not found in this browser.');
    const current=await window.ethereum.request({method:'eth_chainId'});
    if(current===CHAIN_ID)return;
    await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:CHAIN_ID}]});
  }

  async function connect(){
    if(!window.ethereum)throw new Error('Install or enable MetaMask first.');
    setBusy(true);setStatus('Connecting MetaMask…');
    try{
      await ensureSepolia();
      await window.ethereum.request({method:'eth_requestAccounts'});
      provider=new BrowserProvider(window.ethereum);
      signer=await provider.getSigner();
      account=await signer.getAddress();
      const btn=$('#chainConnectBtn');if(btn)btn.textContent=`Connected ${short(account)}`;
      await refresh();
    }finally{setBusy(false);}
  }

  async function getReadProvider(){
    if(provider)return provider;
    if(window.ethereum){
      try{
        const chain=await window.ethereum.request({method:'eth_chainId'});
        if(chain===CHAIN_ID){provider=new BrowserProvider(window.ethereum);return provider;}
      }catch{}
    }
    return new JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com');
  }

  async function refresh(){
    try{
      const p=await getReadProvider();
      const vault=new Contract(VAULT_ADDRESS,VAULT_ABI,p);
      const [rawBalance,rawUnlock,beneficiary,tokenAddress]=await Promise.all([
        vault.balance(),vault.unlockTime(),vault.beneficiary(),vault.token()
      ]);
      unlockTimestamp=Number(rawUnlock);
      const balance=formatUnits(rawBalance,TOKEN_DECIMALS);
      $('#chainVaultBalance').textContent=`${fmt(balance)} mUSDC`;
      $('#chainVaultAddress').textContent=short(VAULT_ADDRESS);
      $('#chainTokenAddress').textContent=short(tokenAddress);
      $('#chainBeneficiary').textContent=short(beneficiary);
      const unlockDate=new Date(unlockTimestamp*1000);
      $('#chainUnlockTime').textContent=unlockDate.toLocaleString();
      const locked=Math.floor(Date.now()/1000)<unlockTimestamp;
      const withdraw=$('#chainWithdrawBtn');
      if(withdraw){withdraw.disabled=locked;withdraw.textContent=locked?'Withdrawal locked':'Withdraw unlocked funds';}
      $('#chainLockBadge').textContent=locked?'🔒 Hard locked':'Unlocked';
      $('#chainLockBadge').className=`lockPill ${locked?'':'unlocked'}`;

      if(account){
        const token=new Contract(TOKEN_ADDRESS,TOKEN_ABI,p);
        const walletRaw=await token.balanceOf(account);
        $('#chainWalletBalance').textContent=`${fmt(formatUnits(walletRaw,TOKEN_DECIMALS))} mUSDC`;
        setStatus(locked?'Connected to Sepolia. The contract itself is enforcing the lock.':'Connected to Sepolia. This test vault is now unlocked.','ok');
      }else{
        $('#chainWalletBalance').textContent='Connect MetaMask';
        setStatus('On-chain vault found on Sepolia. Connect MetaMask to deposit or withdraw.');
      }
    }catch(err){
      setStatus(`Could not read the Sepolia vault: ${err.message}`,'error');
    }
  }

  async function deposit(){
    const amount=Number($('#chainDepositAmount')?.value);
    if(!Number.isFinite(amount)||amount<=0){alert('Enter an amount greater than 0.');return;}
    if(!signer)await connect();
    if(Math.floor(Date.now()/1000)>=unlockTimestamp){alert('This test vault has already reached its unlock time, so it no longer accepts deposits.');return;}
    const units=parseUnits(amount.toFixed(TOKEN_DECIMALS),TOKEN_DECIMALS);
    const token=new Contract(TOKEN_ADDRESS,TOKEN_ABI,signer);
    const vault=new Contract(VAULT_ADDRESS,VAULT_ABI,signer);
    const btn=$('#chainDepositBtn');setBusy(true);
    try{
      btn.textContent='1/2 Approving…';setStatus('MetaMask will ask you to approve mUSDC for this vault.');
      const approveTx=await token.approve(VAULT_ADDRESS,units);await approveTx.wait();
      btn.textContent='2/2 Depositing…';setStatus('Approval confirmed. MetaMask will ask you to make the locked deposit.');
      const depositTx=await vault.deposit(units);await depositTx.wait();
      $('#chainDepositAmount').value='';
      await refresh();
      alert(`${fmt(amount)} fake USDC was deposited into the hard-lock contract.`);
    }catch(err){
      const msg=err?.shortMessage||err?.reason||err?.message||'Deposit failed.';
      setStatus(msg,'error');alert(msg);
    }finally{setBusy(false);btn.textContent='Add test USDC';}
  }

  async function withdraw(){
    if(!signer)await connect();
    const vault=new Contract(VAULT_ADDRESS,VAULT_ABI,signer);
    setBusy(true);setStatus('Requesting withdrawal from the smart contract…');
    try{
      const tx=await vault.withdraw();await tx.wait();
      await refresh();
      alert('Unlocked vault funds were returned to your MetaMask wallet.');
    }catch(err){
      const msg=(err?.data==='0xe5713d2e'||String(err?.message||'').includes('0xe5713d2e'))?'The blockchain rejected the withdrawal because the vault is still locked.':(err?.shortMessage||err?.reason||err?.message||'Withdrawal failed.');
      setStatus(msg,'error');alert(msg);
    }finally{setBusy(false);}
  }

  function install(){
    $('#chainConnectBtn')?.addEventListener('click',()=>connect().catch(err=>{setBusy(false);setStatus(err.message,'error');alert(err.message);}));
    $('#chainRefreshBtn')?.addEventListener('click',refresh);
    $('#chainDepositBtn')?.addEventListener('click',deposit);
    $('#chainWithdrawBtn')?.addEventListener('click',withdraw);
    $('#chainExplorerLink')?.addEventListener('click',()=>window.open(`https://sepolia.etherscan.io/address/${VAULT_ADDRESS}`,'_blank','noopener,noreferrer'));
    window.ethereum?.on?.('accountsChanged',accounts=>{account=accounts?.[0]||null;signer=null;provider=null;if(account)connect().catch(()=>{});else refresh();});
    window.ethereum?.on?.('chainChanged',()=>{provider=null;signer=null;account=null;refresh();});
    refresh();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})().catch(err=>{
  const el=document.querySelector('#chainStatus');
  if(el){el.textContent=`Blockchain module failed to load: ${err.message}`;el.className='chainStatus error';}
  console.error(err);
});
