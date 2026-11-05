(()=>{
  // Testnet-only. Compiles the exact contract source committed to this repository.
  // Never deploy to Base Mainnet or use with real USDC.
  const CHAIN_ID=84532;
  const CHAIN_HEX='0x14a34';
  const TOKEN='0x036CbD53842c5426634e7929541eC2318f3dCF7e';
  const SOURCE_PATH='contracts/BaseSepoliaLockedSavings.sol';
  const OZ_PREFIX='@openzeppelin/contracts/';
  const $=s=>document.querySelector(s);
  let busy=false;

  function status(message,error=false){
    const el=$('#baseSepoliaStatus');if(!el)return;
    el.textContent=message;el.className=error?'chainStatus error':'chainStatus';
  }
  function nameShort(value){return value.slice(0,8)+'…'+value.slice(-6);}
  function normalizePath(path){
    const parts=[];
    for(const segment of path.split('/')){
      if(segment==='.'||!segment)continue;
      if(segment==='..')parts.pop();
      else parts.push(segment);
    }
    return parts.join('/');
  }
  function importPath(parent,request){
    if(request.startsWith(OZ_PREFIX))return normalizePath(request);
    if(request.startsWith('./')||request.startsWith('../'))
      return normalizePath(parent.split('/').slice(0,-1).join('/')+'/'+request);
    throw new Error('Unsupported Solidity import: '+request);
  }
  async function loadSource(file,files){
    if(files[file])return;
    if(files.size>30)throw new Error('Too many Solidity dependencies.');
    const url=file.startsWith(OZ_PREFIX)
      ?'https://cdn.jsdelivr.net/npm/@openzeppelin/contracts@5.4.0/'+file.slice(OZ_PREFIX.length)
      :'/'+file;
    const r=await fetch(url,{cache:'no-store'});
    if(!r.ok)throw new Error('Could not load Solidity source '+file+' (HTTP '+r.status+').');
    const content=await r.text();
    if(content.length>200000)throw new Error('Unexpectedly large Solidity source: '+file);
    files[file]={content};
    for(const match of content.matchAll(/\bimport\s+(?:(?:[^;'"]*?)\s+from\s+)?["']([^"']+)["']\s*;/g)){
      await loadSource(importPath(file,match[1]),files);
    }
  }
  async function ensureBaseSepolia(){
    if(!window.ethereum)throw new Error('MetaMask is required.');
    const current=await window.ethereum.request({method:'eth_chainId'});
    if(current===CHAIN_HEX)return;
    try{
      await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:CHAIN_HEX}]});
    }catch(e){
      if(e.code!==4902)throw e;
      await window.ethereum.request({method:'wallet_addEthereumChain',params:[{
        chainId:CHAIN_HEX,chainName:'Base Sepolia',
        nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},
        rpcUrls:['https://sepolia.base.org'],blockExplorerUrls:['https://sepolia.basescan.org']
      }]});
    }
    const switched=await window.ethereum.request({method:'eth_chainId'});
    if(switched!==CHAIN_HEX)throw new Error('MetaMask is not on Base Sepolia.');
  }
  async function activate(vault){
    if(busy)return;
    if(!vault?.id||!vault.unlockDate)throw new Error('Please select a valid empty savings goal.');
    if(vault.chain?.address){window.SaveMoneyBaseApp?.select?.(vault.id);return;}
    if(Number(vault.balance||0)!==0)throw new Error('Create an empty goal before activating its blockchain lock.');
    if(!authSession?.accessToken)throw new Error('Sign in to SaveMoney first.');
    if(!window.ethereum)throw new Error('MetaMask was not found in this browser.');

    const unlockTimestamp=Math.floor(Date.parse(vault.unlockDate+'T12:00:00Z')/1000);
    if(!Number.isSafeInteger(unlockTimestamp)||unlockTimestamp<=Math.floor(Date.now()/1000)+120)
      throw new Error('Choose a later unlock date. The test vault unlocks at noon UTC on your date.');
    if(!confirm('Create the Base Sepolia TEST vault for “'+vault.name+'”?\n\nThis uses fake test USDC and test ETH only. Once deployed, the unlock time cannot be changed.'))return;

    const button=document.querySelector('.activateChainBtn[data-id="'+vault.id+'"]');
    busy=true;if(button){button.disabled=true;button.textContent='Setting up test lock…';}
    let address=null,compiler=null;
    try{
      status('Connecting MetaMask to Base Sepolia…');
      await ensureBaseSepolia();
      await window.ethereum.request({method:'eth_requestAccounts'});
      const {BrowserProvider,ContractFactory}=await import('https://cdn.jsdelivr.net/npm/ethers@6.13.5/+esm');
      const provider=new BrowserProvider(window.ethereum);
      if((await provider.getNetwork()).chainId!==BigInt(CHAIN_ID))throw new Error('Wrong blockchain network.');
      if((await provider.getCode(TOKEN))==='0x')throw new Error('Base Sepolia test USDC was not found. Refusing deployment.');
      const signer=await provider.getSigner();
      const beneficiary=await signer.getAddress();

      status('Loading the audited-library dependencies for a TEST contract (not an audit of SaveMoney)…');
      const files={};
      await loadSource(SOURCE_PATH,files);
      const {fetchAndLoadSolc}=await import('https://cdn.jsdelivr.net/npm/web-solc@0.7.0/+esm');
      compiler=await fetchAndLoadSolc('0.8.24');
      status('Compiling the exact Base Sepolia contract in your browser…');
      const input={
        language:'Solidity',
        sources:files,
        settings:{optimizer:{enabled:true,runs:200},
          outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}
      };
      const response=await compiler.compile(input);
      const output=typeof response==='string'?JSON.parse(response):response;
      const errors=(output.errors||[]).filter(x=>x.severity==='error');
      if(errors.length)throw new Error('Compilation failed: '+errors[0].formattedMessage);
      const artifact=output.contracts?.[SOURCE_PATH]?.BaseSepoliaLockedSavings;
      const bytecode=artifact?.evm?.bytecode?.object;
      if(!bytecode||!/^[0-9a-f]+$/i.test(bytecode))throw new Error('Compiler produced invalid deployment bytecode.');

      status('Contract compiled. Confirm its Base Sepolia TEST deployment in MetaMask.');
      const factory=new ContractFactory(artifact.abi,'0x'+bytecode,signer);
      const contract=await factory.deploy(beneficiary,unlockTimestamp);
      await contract.waitForDeployment();
      address=await contract.getAddress();
      const [onBeneficiary,onUnlock,onToken,onChain,code]=await Promise.all([
        contract.beneficiary(),contract.unlockTime(),contract.USDC(),contract.CHAIN_ID(),provider.getCode(address)
      ]);
      if(onBeneficiary.toLowerCase()!==beneficiary.toLowerCase()||
         Number(onUnlock)!==unlockTimestamp||onToken.toLowerCase()!==TOKEN.toLowerCase()||
         Number(onChain)!==CHAIN_ID||code==='0x')
        throw new Error('Deployed contract details did not match. Do not deposit any test tokens.');

      status('Deployment confirmed. Saving your Base Sepolia address to SaveMoney…');
      const chain={address,tokenAddress:TOKEN,beneficiary,chainId:CHAIN_ID,unlockTimestamp};
      const save=await fetch('/api/vaults',{
        method:'PATCH',
        headers:{Authorization:'Bearer '+authSession.accessToken,'Content-Type':'application/json'},
        body:JSON.stringify({vaultId:vault.id,chain})
      });
      const data=await save.json();
      if(!save.ok||!data.ok)throw new Error(data.error||'Could not save the blockchain vault address.');
      const saved=vaults.find(v=>v.id===vault.id);
      if(saved)saved.chain=chain;
      render();
      window.SaveMoneyBaseApp?.sync?.();
      window.SaveMoneyBaseApp?.select?.(vault.id);
      $('#baseSepoliaSectionHead')?.scrollIntoView({behavior:'smooth',block:'start'});
      status('Base Sepolia test vault deployed successfully. Deposit only FAKE test USDC.');
      alert('Base Sepolia test vault created!\n'+nameShort(address)+'\nNo real money moved.');
    }catch(e){
      const message=e?.shortMessage||e?.message||'Could not create the test vault.';
      status(message,true);
      alert('Vault setup did not complete: '+message+
        (address?'\n\nContract WAS deployed. Keep this address to recover its mapping: '+address:''));
    }finally{
      try{await compiler?.stopWorker?.();}catch{}
      busy=false;
      if(button){button.disabled=false;button.textContent='Activate Base Sepolia test lock';}
    }
  }
  window.SaveMoneyBaseDeployment={activate};
})();