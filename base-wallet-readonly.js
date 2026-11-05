// Real-funds preparation only: intentionally READ-ONLY.
// It never changes networks, deploys contracts, signs transfers, or requests approvals.
(async()=>{
  const {JsonRpcProvider,Contract,formatUnits,isAddress}=await import('https://cdn.jsdelivr.net/npm/ethers@6.13.5/+esm');
  const TOKEN='0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // Circle native USDC on Base
  const RPCS=['https://mainnet.base.org','https://base-rpc.publicnode.com'];
  const CHAIN_ID=8453n;
  const ABI=['function balanceOf(address) view returns (uint256)','function decimals() view returns (uint8)'];
  const $=s=>document.querySelector(s);
  const button=$('#liveWalletConnect');
  const status=$('#liveWalletStatus');
  const balanceEl=$('#liveWalletUsdc');
  const addressEl=$('#liveWalletAddress');
  const viewLink=$('#liveWalletExplorer');
  if(!button||!status||!balanceEl||!addressEl)return;
  let busy=false;
  function say(s,isError=false){
    status.textContent=s;
    status.classList.toggle('error',isError);
  }
  async function readUsdc(address){
    let lastError=null;
    for(const url of RPCS){
      try{
        const provider=new JsonRpcProvider(url,8453,{staticNetwork:true});
        const token=new Contract(TOKEN,ABI,provider);
        const [raw,decimals,network]=await Promise.all([
          token.balanceOf(address),token.decimals(),provider.getNetwork()
        ]);
        if(network.chainId!==CHAIN_ID||Number(decimals)!==6)
          throw new Error('Unexpected Base network or USDC token.');
        const formatted=Number(formatUnits(raw,6));
        if(!Number.isFinite(formatted))throw new Error('Invalid token balance.');
        return formatted.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
      }catch(e){lastError=e;}
    }
    throw new Error(lastError?.shortMessage||lastError?.message||'The Base network could not be reached.');
  }
  async function connect(){
    if(busy)return;
    if(!window.ethereum){
      say('MetaMask is unavailable in this browser. Install/enable it first.',true);
      return;
    }
    busy=true;
    button.disabled=true;
    button.textContent='Reading wallet…';
    say('Checking your Base USDC balance. No transaction will be requested.');
    try{
      const accounts=await window.ethereum.request({method:'eth_requestAccounts'});
      const address=accounts?.[0];
      if(!isAddress(address))throw new Error('No valid wallet address was returned.');
      addressEl.textContent=address.slice(0,9)+'…'+address.slice(-7);
      addressEl.title=address;
      if(viewLink){
        viewLink.href='https://basescan.org/address/'+address;
        viewLink.hidden=false;
      }
      const balance=await readUsdc(address);
      balanceEl.textContent=balance+' USDC';
      say('Read-only: this balance is in your own wallet, NOT locked in SaveMoney. Real-money deposits are disabled until the vault contract is independently reviewed.');
      button.textContent='Refresh wallet balance';
    }catch(e){
      say(e?.shortMessage||e?.message||'Could not read the Base wallet.',true);
      button.textContent='Connect wallet (read-only)';
    }finally{busy=false;button.disabled=false;}
  }
  button.addEventListener('click',connect);
})().catch(e=>{
  const status=document.querySelector('#liveWalletStatus');
  if(status){status.textContent='Unable to load read-only Base wallet module. Refresh the page.';status.classList.add('error');}
  console.error(e);
});
