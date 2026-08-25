function supabaseConfig(){
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_PUBLISHABLE_KEY;
  return {url,key};
}
function tokenFrom(req){
  const auth=req.headers.authorization||'';
  return auth.startsWith('Bearer ')?auth.slice(7):'';
}
async function getUser(url,key,token){
  const r=await fetch(`${url}/auth/v1/user`,{headers:{apikey:key,Authorization:`Bearer ${token}`}});
  if(!r.ok)return null;
  return r.json();
}
async function rest(url,key,token,path,options={}){
  return fetch(`${url}/rest/v1/${path}`,{
    ...options,
    headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(options.headers||{})}
  });
}
function chainMap(user){
  const value=user?.user_metadata?.savemoney_chain_vaults;
  return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
}
function address(value){
  const s=String(value||'').trim();
  return /^0x[a-fA-F0-9]{40}$/.test(s)?s:null;
}
function normalizeChain(value){
  if(!value||typeof value!=='object')return null;
  const contractAddress=address(value.address);
  const tokenAddress=address(value.tokenAddress);
  const beneficiary=address(value.beneficiary);
  const chainId=Number(value.chainId);
  const unlockTimestamp=Number(value.unlockTimestamp);
  if(!contractAddress||!tokenAddress||!beneficiary||chainId!==11155111||!Number.isInteger(unlockTimestamp)||unlockTimestamp<=0)return null;
  return {address:contractAddress,tokenAddress,beneficiary,chainId,unlockTimestamp};
}
async function updateMetadata(url,key,token,user,nextMap){
  const metadata={...(user.user_metadata||{}),savemoney_chain_vaults:nextMap};
  const r=await fetch(`${url}/auth/v1/user`,{
    method:'PUT',
    headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({data:metadata})
  });
  const data=await r.json().catch(()=>null);
  if(!r.ok)throw new Error(data?.message||data?.error_description||'Could not save blockchain vault mapping.');
  return data;
}

export default async function handler(req,res){
  const {url,key}=supabaseConfig();
  if(!url||!key)return res.status(500).json({error:'Supabase is not configured.'});
  const token=tokenFrom(req);
  if(!token)return res.status(401).json({error:'Sign in required.'});
  const user=await getUser(url,key,token);
  if(!user?.id)return res.status(401).json({error:'Your session expired. Sign in again.'});

  try{
    if(req.method==='GET'){
      const r=await rest(url,key,token,'vaults?select=id,name,goal_amount,balance,unlock_date,created_at&order=created_at.asc');
      const data=await r.json();
      if(!r.ok)return res.status(r.status).json({error:data?.message||'Could not load vaults.'});
      const mappings=chainMap(user);
      return res.status(200).json({ok:true,vaults:data.map(v=>({...v,chain:mappings[v.id]||null}))});
    }

    if(req.method==='POST'){
      const {name,goalAmount,unlockDate}=req.body||{};
      const goal=Number(goalAmount);
      const requestedChain=req.body?.chain?normalizeChain(req.body.chain):null;
      if(req.body?.chain&&!requestedChain)return res.status(400).json({error:'Invalid Sepolia vault details.'});
      if(!String(name||'').trim()||!Number.isFinite(goal)||goal<=0||!/^\d{4}-\d{2}-\d{2}$/.test(String(unlockDate||'')))return res.status(400).json({error:'Valid vault name, goal, and unlock date are required.'});
      const today=new Date();today.setHours(0,0,0,0);
      const unlock=new Date(`${unlockDate}T00:00:00`);
      if(!(unlock>today))return res.status(400).json({error:'Unlock date must be after today.'});
      if(requestedChain){
        const expected=Math.floor(unlock.getTime()/1000);
        if(Math.abs(requestedChain.unlockTimestamp-expected)>120)return res.status(400).json({error:'Blockchain unlock time does not match the SaveMoney unlock date.'});
      }
      const r=await rest(url,key,token,'vaults',{
        method:'POST',headers:{Prefer:'return=representation'},
        body:JSON.stringify({name:String(name).trim().slice(0,40),goal_amount:goal,balance:0,unlock_date:unlockDate,user_id:user.id})
      });
      const data=await r.json();
      if(!r.ok)return res.status(r.status).json({error:data?.message||'Could not create vault.'});
      const vault=data[0];
      if(requestedChain){
        const mappings=chainMap(user);
        await updateMetadata(url,key,token,user,{...mappings,[vault.id]:requestedChain});
      }
      return res.status(201).json({ok:true,vault:{...vault,chain:requestedChain}});
    }

    if(req.method==='PATCH'){
      const id=String(req.body?.vaultId||'');
      const requestedChain=normalizeChain(req.body?.chain);
      if(!id||!requestedChain)return res.status(400).json({error:'Vault id and valid Sepolia vault details are required.'});
      const owned=await rest(url,key,token,`vaults?id=eq.${encodeURIComponent(id)}&select=id,unlock_date`);
      const rows=await owned.json();
      if(!owned.ok||!Array.isArray(rows)||!rows.length)return res.status(404).json({error:'Vault not found.'});
      const expected=Math.floor(new Date(`${rows[0].unlock_date}T00:00:00`).getTime()/1000);
      if(Math.abs(requestedChain.unlockTimestamp-expected)>120)return res.status(400).json({error:'Blockchain unlock time does not match this vault.'});
      const mappings=chainMap(user);
      await updateMetadata(url,key,token,user,{...mappings,[id]:requestedChain});
      return res.status(200).json({ok:true,chain:requestedChain});
    }

    if(req.method==='DELETE'){
      const id=String(req.query?.id||'');
      if(!id)return res.status(400).json({error:'Vault id is required.'});
      if(chainMap(user)[id])return res.status(409).json({error:'This vault is linked to an on-chain hard lock and cannot be deleted from SaveMoney.'});
      const r=await rest(url,key,token,`vaults?id=eq.${encodeURIComponent(id)}&balance=eq.0`,{method:'DELETE',headers:{Prefer:'return=representation'}});
      const data=await r.json();
      if(!r.ok)return res.status(r.status).json({error:data?.message||'Could not delete vault.'});
      if(!data.length)return res.status(409).json({error:'Only an empty vault can be deleted.'});
      return res.status(200).json({ok:true});
    }

    res.setHeader('Allow','GET, POST, PATCH, DELETE');
    return res.status(405).json({error:'Direct vault balance updates are disabled.'});
  }catch(error){
    return res.status(500).json({error:error?.message||'Unable to reach the vault database.'});
  }
}
