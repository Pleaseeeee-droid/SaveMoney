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

  const stripeKey=process.env.STRIPE_SECRET_KEY;
  const supabaseUrl=process.env.SUPABASE_URL;
  const supabaseKey=process.env.SUPABASE_PUBLISHABLE_KEY;
  if(!stripeKey||!supabaseUrl||!supabaseKey)return res.status(500).json({error:'Server is not fully configured.'});
  if(!stripeKey.startsWith('sk_test_'))return res.status(403).json({error:'Safety block: deposits are sandbox-only right now.'});

  const token=tokenFrom(req);
  if(!token)return res.status(401).json({error:'Sign in required.'});
  const user=await getUser(supabaseUrl,supabaseKey,token);
  if(!user?.id)return res.status(401).json({error:'Your session expired. Sign in again.'});

  const sessionId=String(req.body?.sessionId||'');
  if(!sessionId.startsWith('cs_test_'))return res.status(400).json({error:'Invalid sandbox session.'});

  try{
    const stripeResponse=await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,{
      headers:{Authorization:`Bearer ${stripeKey}`}
    });
    const session=await stripeResponse.json();
    if(!stripeResponse.ok)return res.status(stripeResponse.status).json({error:session?.error?.message||'Stripe verification failed.'});
    const purpose=session?.metadata?.purpose;
    if(purpose!=='savemoney_vault_deposit'&&purpose!=='savemoney_chain_card_demo')
      return res.status(400).json({error:'This is not a SaveMoney checkout.'});
    if(session.payment_status!=='paid')return res.status(409).json({error:'Payment is not confirmed as paid yet.'});
    if(session.metadata?.user_id!==user.id)return res.status(403).json({error:'This payment does not belong to your account.'});

    const amount=Number(session.amount_total||0)/100;
    const vaultId=session.metadata?.vault_id;
    if(!vaultId||!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:'Stripe payment data is incomplete.'});

    const chain=user?.user_metadata?.savemoney_chain_vaults?.[vaultId]||null;
    if(purpose==='savemoney_chain_card_demo'){
      if(!chain?.address||session.metadata?.chain_address?.toLowerCase()!==String(chain.address).toLowerCase())
        return res.status(409).json({error:'The linked blockchain vault could not be verified.'});
      // Demo only: card checkout is unrelated to minting/purchasing crypto.
      return res.status(200).json({
        ok:true,sandbox:true,demoOnly:true,sessionId:session.id,
        vaultId,amount,credited:false,tokenTransferred:false,
        message:'Stripe TEST card checkout succeeded. No USDC was created or sent to your blockchain vault.'
      });
    }
    if(chain?.address)return res.status(409).json({error:'Blockchain vaults cannot be credited by ordinary Stripe checkout.'});

    const rpc=await fetch(`${supabaseUrl}/rest/v1/rpc/apply_stripe_deposit`,{
      method:'POST',
      headers:{apikey:supabaseKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({p_vault_id:vaultId,p_session_id:session.id,p_amount:amount})
    });
    const result=await rpc.json();
    if(!rpc.ok)return res.status(rpc.status).json({error:result?.message||'Could not apply deposit to the vault.'});

    return res.status(200).json({ok:true,sandbox:true,sessionId:session.id,vaultId,amount,newBalance:Number(result)});
  }catch{
    return res.status(500).json({error:'Unable to apply sandbox payment.'});
  }
}
