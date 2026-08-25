const jsonHeaders={'Content-Type':'application/json'};

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
      return res.status(200).json({ok:true,vaults:data});
    }

    if(req.method==='POST'){
      const {name,goalAmount,unlockDate}=req.body||{};
      const goal=Number(goalAmount);
      if(!String(name||'').trim()||!Number.isFinite(goal)||goal<=0||!/^\d{4}-\d{2}-\d{2}$/.test(String(unlockDate||'')))return res.status(400).json({error:'Valid vault name, goal, and unlock date are required.'});
      const today=new Date(); today.setHours(0,0,0,0);
      const unlock=new Date(`${unlockDate}T00:00:00`);
      if(!(unlock>today))return res.status(400).json({error:'Unlock date must be after today.'});
      const r=await rest(url,key,token,'vaults',{
        method:'POST',headers:{Prefer:'return=representation'},
        body:JSON.stringify({name:String(name).trim().slice(0,40),goal_amount:goal,balance:0,unlock_date:unlockDate,user_id:user.id})
      });
      const data=await r.json();
      if(!r.ok)return res.status(r.status).json({error:data?.message||'Could not create vault.'});
      return res.status(201).json({ok:true,vault:data[0]});
    }

    if(req.method==='PATCH'){
      const {id,balance}=req.body||{};
      const next=Number(balance);
      if(!id||!Number.isFinite(next)||next<0)return res.status(400).json({error:'Valid vault and balance are required.'});
      const r=await rest(url,key,token,`vaults?id=eq.${encodeURIComponent(id)}`,{
        method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({balance:next})
      });
      const data=await r.json();
      if(!r.ok)return res.status(r.status).json({error:data?.message||'Could not update vault.'});
      if(!data.length)return res.status(404).json({error:'Vault not found.'});
      return res.status(200).json({ok:true,vault:data[0]});
    }

    if(req.method==='DELETE'){
      const id=String(req.query?.id||'');
      if(!id)return res.status(400).json({error:'Vault id is required.'});
      const r=await rest(url,key,token,`vaults?id=eq.${encodeURIComponent(id)}&balance=eq.0`,{method:'DELETE',headers:{Prefer:'return=representation'}});
      const data=await r.json();
      if(!r.ok)return res.status(r.status).json({error:data?.message||'Could not delete vault.'});
      if(!data.length)return res.status(409).json({error:'Only an empty vault can be deleted.'});
      return res.status(200).json({ok:true});
    }

    res.setHeader('Allow','GET, POST, PATCH, DELETE');
    return res.status(405).json({error:'Method not allowed'});
  }catch{
    return res.status(500).json({error:'Unable to reach the vault database.'});
  }
}
