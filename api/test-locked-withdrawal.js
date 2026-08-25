function tokenFrom(req){
  const auth=req.headers.authorization||'';
  return auth.startsWith('Bearer ')?auth.slice(7):'';
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

  const vaultId=String(req.body?.vaultId||'');
  if(!vaultId)return res.status(400).json({error:'Vault id is required.'});

  try{
    const rpc=await fetch(`${url}/rest/v1/rpc/withdraw_from_vault`,{
      method:'POST',
      headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({p_vault_id:vaultId,p_amount:1})
    });
    const data=await rpc.json();

    if(!rpc.ok){
      const message=data?.message||'Withdrawal rejected.';
      const locked=/locked until/i.test(message);
      return res.status(locked?200:rpc.status).json({ok:locked,blocked:locked,message});
    }

    return res.status(200).json({ok:false,blocked:false,error:'WARNING: the test withdrawal was accepted. Do not use this vault for lock testing again.',newBalance:Number(data)});
  }catch{
    return res.status(500).json({error:'Unable to run locked withdrawal test.'});
  }
}
