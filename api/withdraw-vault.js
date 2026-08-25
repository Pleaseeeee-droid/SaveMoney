function tokenFrom(req){
  const auth=req.headers.authorization||'';
  return auth.startsWith('Bearer ')?auth.slice(7):'';
}

async function getUser(url,key,token){
  const r=await fetch(`${url}/auth/v1/user`,{headers:{apikey:key,Authorization:`Bearer ${token}`}});
  if(!r.ok)return null;
  return r.json();
}

export default async function handler(req,res){
  if(req.method!=='POST'){
    res.setHeader('Allow','POST');
    return res.status(405).json({error:'Method not allowed'});
  }

  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key)return res.status(500).json({error:'Supabase is not configured.'});

  const token=tokenFrom(req);
  if(!token)return res.status(401).json({error:'Sign in required.'});
  const user=await getUser(url,key,token);
  if(!user?.id)return res.status(401).json({error:'Your session expired. Sign in again.'});

  const vaultId=String(req.body?.vaultId||'');
  const amount=Number(req.body?.amount);
  if(!vaultId||!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:'Valid vault and amount are required.'});

  try{
    const rpc=await fetch(`${url}/rest/v1/rpc/withdraw_from_vault`,{
      method:'POST',
      headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({p_vault_id:vaultId,p_amount:amount})
    });
    const result=await rpc.json();
    if(!rpc.ok){
      const message=result?.message||'Withdrawal was rejected.';
      return res.status(message.includes('locked')?423:400).json({error:message});
    }
    return res.status(200).json({ok:true,vaultId,amount,newBalance:Number(result),sandbox:true});
  }catch{
    return res.status(500).json({error:'Unable to process the withdrawal request.'});
  }
}
