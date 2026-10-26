(()=>{
  // Sepolia-only prototype. Never use this bytecode/compiler setup with real funds.
  const TOKEN='0x5Df8a09276305F6c3c3F523bE5FF4fDE4829Dc92';
  const SOURCE="// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n\ninterface ISaveMoneyToken {\n    function balanceOf(address account) external view returns (uint256);\n    function transfer(address to, uint256 amount) external returns (bool);\n    function transferFrom(address from, address to, uint256 amount) external returns (bool);\n}\n\ncontract SaveMoneyVault {\n    ISaveMoneyToken public immutable token;\n    address public immutable beneficiary;\n    uint256 public immutable unlockTime;\n\n    error VaultLocked();\n    error VaultExpired();\n    error NotBeneficiary();\n    error TransferFailed();\n    error NothingToWithdraw();\n\n    constructor(address tokenAddress, address beneficiaryAddress, uint256 unlockTimestamp) {\n        require(tokenAddress != address(0), \"Invalid token\");\n        require(beneficiaryAddress != address(0), \"Invalid beneficiary\");\n        require(unlockTimestamp > block.timestamp, \"Unlock must be future\");\n        token = ISaveMoneyToken(tokenAddress);\n        beneficiary = beneficiaryAddress;\n        unlockTime = unlockTimestamp;\n    }\n\n    function deposit(uint256 amount) external {\n        if (block.timestamp >= unlockTime) revert VaultExpired();\n        require(amount > 0, \"Amount must be greater than zero\");\n        if (!token.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();\n    }\n\n    function balance() public view returns (uint256) {\n        return token.balanceOf(address(this));\n    }\n\n    function withdraw() external {\n        if (msg.sender != beneficiary) revert NotBeneficiary();\n        if (block.timestamp < unlockTime) revert VaultLocked();\n        uint256 amount = balance();\n        if (amount == 0) revert NothingToWithdraw();\n        if (!token.transfer(beneficiary, amount)) revert TransferFailed();\n    }\n}";
  let busy=false;
  const $=selector=>document.querySelector(selector);
  const note=(message,error=false)=>{
    const el=$('#chainStatus');if(!el)return;
    el.textContent=message;el.className=error?'chainStatus error':'chainStatus';
  };
  const short=a=>a?a.slice(0,8)+'…'+a.slice(-6):'';
  async function activate(vault){
    if(busy)return;
    if(!vault?.id||!vault.unlockDate)throw new Error('Select a valid SaveMoney vault.');
    if(vault.chain?.address){window.SaveMoneyChainApp?.select?.(vault.id);return;}
    if(Number(vault.balance)>0)throw new Error('This vault already has a sandbox balance. Create a new empty vault for the blockchain hard lock.');
    if(!window.ethereum)throw new Error('MetaMask is needed to activate the hard lock.');
    if(!authSession?.accessToken)throw new Error('Please sign in to SaveMoney first.');
    if(!confirm('Create a Sepolia smart-contract vault for “'+vault.name+'”? This uses FAKE USDC and a small amount of FREE Sepolia test ETH. The unlock date is permanent once deployed.'))return;
    const unlockTimestamp=Math.floor(Date.parse(vault.unlockDate+'T12:00:00Z')/1000);
    if(!Number.isSafeInteger(unlockTimestamp)||unlockTimestamp<=Math.floor(Date.now()/1000)+120)
      throw new Error('Choose an unlock date after today. The test vault unlocks at noon UTC on that date.');
    busy=true;
    const button=document.querySelector('.activateChainBtn[data-id="'+vault.id+'"]');
    if(button){button.disabled=true;button.textContent='Setting up…';}
    let deployedAddress=null;
    let compiler=null;
    try{
      note('Connecting your MetaMask wallet to Sepolia…');
      const {BrowserProvider,ContractFactory}=await import('https://cdn.jsdelivr.net/npm/ethers@6.13.5/+esm');
      const current=await window.ethereum.request({method:'eth_chainId'});
      if(current!=='0xaa36a7')await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:'0xaa36a7'}]});
      await window.ethereum.request({method:'eth_requestAccounts'});
      const provider=new BrowserProvider(window.ethereum);
      const signer=await provider.getSigner();
      const beneficiary=await signer.getAddress();
      note('Preparing the vault contract. The Solidity compiler downloads once; no wallet secret is shared.');
      const {fetchAndLoadSolc}=await import('https://cdn.jsdelivr.net/npm/web-solc@0.7.0/+esm');
      compiler=await fetchAndLoadSolc('0.8.24');
      const input={
        language:'Solidity',
        sources:{'SaveMoneyVault.sol':{content:SOURCE}},
        settings:{optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}
      };
      const compiled=await compiler.compile(input);
      const output=typeof compiled==='string'?JSON.parse(compiled):compiled;
      const errors=(output.errors||[]).filter(e=>e.severity==='error');
      if(errors.length)throw new Error('Compiler error: '+errors[0].formattedMessage);
      const result=output.contracts?.['SaveMoneyVault.sol']?.SaveMoneyVault;
      if(!result?.evm?.bytecode?.object)throw new Error('The contract did not compile. Please try again.');
      note('MetaMask will ask to deploy your new test vault. Verify the wallet and approve if correct.');
      const factory=new ContractFactory(result.abi,'0x'+result.evm.bytecode.object,signer);
      const contract=await factory.deploy(TOKEN,beneficiary,unlockTimestamp);
      await contract.waitForDeployment();
      deployedAddress=await contract.getAddress();
      note('Contract deployed. Saving its address to your private SaveMoney account…');
      // Read on-chain parameters to avoid linking an unrelated contract.
      const [onChainToken,onChainBeneficiary,onChainUnlock]=await Promise.all([
        contract.token(),contract.beneficiary(),contract.unlockTime()
      ]);
      if(onChainToken.toLowerCase()!==TOKEN.toLowerCase()||
         onChainBeneficiary.toLowerCase()!==beneficiary.toLowerCase()||
         Number(onChainUnlock)!==unlockTimestamp)
        throw new Error('On-chain contract checks did not match the vault settings.');
      const chain={address:deployedAddress,tokenAddress:TOKEN,beneficiary,unlockTimestamp,chainId:11155111};
      const response=await fetch('/api/vaults',{
        method:'PATCH',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+authSession.accessToken},
        body:JSON.stringify({vaultId:vault.id,chain})
      });
      const saved=await response.json();
      if(!response.ok||!saved.ok)throw new Error(saved.error||'Could not save vault address.');
      const currentVault=vaults.find(v=>v.id===vault.id);
      if(currentVault)currentVault.chain=chain;
      render();
      window.SaveMoneyChainApp?.sync?.();
      window.SaveMoneyChainApp?.select?.(vault.id);
      note('Hard-lock setup complete. Select your vault above to view it and add fake USDC.');
      alert('Hard-lock vault activated! '+short(deployedAddress)+'\nIt unlocks on '+new Date(unlockTimestamp*1000).toLocaleString()+'.');
    }catch(err){
      const reason=err?.shortMessage||err?.message||'Setup failed.';
      const extra=deployedAddress?'\n\nThe contract WAS deployed. Keep this address so we can reconnect it: '+deployedAddress:'';
      note(reason+(deployedAddress?' (contract address shown in alert)':''),true);
      alert('Unable to complete hard-lock setup: '+reason+extra);
    }finally{
      try{compiler?.stopWorker?.();}catch{}
      busy=false;
      if(button){button.disabled=false;button.textContent='Activate hard lock';}
    }
  }
  window.SaveMoneyChainDeployment={activate};
})();
