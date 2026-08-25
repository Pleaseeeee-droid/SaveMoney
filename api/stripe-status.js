function bearer(req){
  const auth=req.headers.authorization||'';
  return auth.startsWith('Bearer ')?auth.slice(7):'';
}

async function stripeRequest(secret,path,{method='GET',body,headers={}}={}){
  const response=await fetch(`https://api.stripe.com${path}`,{
    method,
    headers:{
      Authorization:`Bearer ${secret}`,
      ...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),
      ...headers
    },
    body:body?body.toString():undefined
  });
  const data=await response.json();
  if(!response.ok)throw new Error(data?.error?.message||`Stripe request failed (${response.status}).`);
  return data;
}

async function getSupabaseUser(token){
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key)throw new Error('Supabase is not configured.');
  const r=await fetch(`${url}/auth/v1/user`,{headers:{apikey:key,Authorization:`Bearer ${token}`}});
  if(!r.ok)return null;
  return r.json();
}

async function getOrCreateCustomer(secret,user){
  const query=`metadata['savemoney_user_id']:'${String(user.id).replace(/'/g,'')}'`;
  const params=new URLSearchParams({query,limit:'1'});
  const found=await stripeRequest(secret,`/v1/customers/search?${params.toString()}`);
  if(found?.data?.[0])return found.data[0];

  const body=new URLSearchParams();
  if(user.email)body.set('email',user.email);
  body.set('description','SaveMoney private app customer');
  body.set('metadata[savemoney_user_id]',user.id);
  return stripeRequest(secret,'/v1/customers',{method:'POST',body});
}

async function verifyVault(token,vaultId){
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY;
  const r=await fetch(`${url}/rest/v1/vaults?id=eq.${encodeURIComponent(vaultId)}&select=id,name`,{headers:{apikey:key,Authorization:`Bearer ${token}`}});
  const data=await r.json();
  if(!r.ok||!Array.isArray(data)||!data.length)return null;
  return data[0];
}

async function applyDeposit(token,vaultId,paymentId,amount){
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY;
  const r=await fetch(`${url}/rest/v1/rpc/apply_stripe_deposit`,{
    method:'POST',
    headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({p_vault_id:vaultId,p_session_id:paymentId,p_amount:amount})
  });
  const raw=await r.text();
  let data=null;try{data=raw?JSON.parse(raw):null;}catch{}
  if(!r.ok)throw new Error(data?.message||'Could not credit the sandbox vault.');
  return Number(data);
}

function cleanKey(value){return String(value||'').toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,80);}

export default async function handler(req,res){
  const secretKey=(process.env.STRIPE_SECRET_KEY||'').trim();
  if(!secretKey)return res.status(500).json({ok:false,error:'STRIPE_SECRET_KEY is not configured'});

  const action=String(req.query?.action||'status');

  if(req.method==='GET'&&action==='status'){
    try{
      const data=await stripeRequest(secretKey,'/v1/account');
      return res.status(200).json({
        ok:true,
        sandbox:secretKey.startsWith('sk_test_'),
        accountId:data.id,
        country:data.country||null,
        chargesEnabled:Boolean(data.charges_enabled),
        payoutsEnabled:Boolean(data.payouts_enabled)
      });
    }catch(error){
      return res.status(502).json({ok:false,error:error.message||'Stripe connection failed'});
    }
  }

  if((req.method==='GET'&&action==='payment-methods')||(req.method==='POST'&&['setup-card','autopay-charge'].includes(action))){
    const token=bearer(req);
    if(!token)return res.status(401).json({ok:false,error:'Sign in required.'});
    try{
      const user=await getSupabaseUser(token);
      if(!user?.id)return res.status(401).json({ok:false,error:'Your session expired. Sign in again.'});
      const customer=await getOrCreateCustomer(secretKey,user);

      if(req.method==='GET'){
        const params=new URLSearchParams({customer:customer.id,type:'card',limit:'10'});
        const list=await stripeRequest(secretKey,`/v1/payment_methods?${params.toString()}`);
        return res.status(200).json({
          ok:true,
          sandbox:secretKey.startsWith('sk_test_'),
          cards:(list.data||[]).map(pm=>({
            id:pm.id,
            brand:pm.card?.brand||'card',
            last4:pm.card?.last4||'••••',
            expMonth:pm.card?.exp_month||null,
            expYear:pm.card?.exp_year||null
          }))
        });
      }

      if(action==='autopay-charge'){
        if(!secretKey.startsWith('sk_test_'))return res.status(403).json({ok:false,error:'Safety block: auto-pay is sandbox-only right now.'});
        const vaultId=String(req.body?.vaultId||'');
        const dollars=Number(req.body?.amount);
        const scheduleKey=cleanKey(req.body?.scheduleKey);
        if(!vaultId)return res.status(400).json({ok:false,error:'Choose a vault.'});
        if(!Number.isFinite(dollars)||dollars<0.50||dollars>10000)return res.status(400).json({ok:false,error:'Card auto-pay amount must be between $0.50 and $10,000.00.'});
        if(!scheduleKey)return res.status(400).json({ok:false,error:'Missing auto-pay schedule key.'});
        const vault=await verifyVault(token,vaultId);
        if(!vault)return res.status(404).json({ok:false,error:'Vault not found.'});

        const params=new URLSearchParams({customer:customer.id,type:'card',limit:'1'});
        const list=await stripeRequest(secretKey,`/v1/payment_methods?${params.toString()}`);
        const pm=list?.data?.[0];
        if(!pm)return res.status(400).json({ok:false,error:'Add a debit card first.'});

        const body=new URLSearchParams();
        body.set('amount',String(Math.round(dollars*100)));
        body.set('currency','usd');
        body.set('customer',customer.id);
        body.set('payment_method',pm.id);
        body.set('confirm','true');
        body.set('off_session','true');
        body.set('description',`SaveMoney sandbox auto-pay — ${String(vault.name).slice(0,40)}`);
        body.set('metadata[purpose]','savemoney_autopay');
        body.set('metadata[vault_id]',vault.id);
        body.set('metadata[user_id]',user.id);
        body.set('metadata[schedule_key]',scheduleKey);
        const idem=`savemoney-autopay-${String(user.id).toLowerCase()}-${vault.id}-${scheduleKey}`.slice(0,240);
        const intent=await stripeRequest(secretKey,'/v1/payment_intents',{method:'POST',body,headers:{'Idempotency-Key':idem}});
        if(intent.status!=='succeeded')return res.status(409).json({ok:false,error:`Stripe auto-pay status is ${intent.status}.`});
        const newBalance=await applyDeposit(token,vault.id,intent.id,dollars);
        return res.status(200).json({ok:true,sandbox:true,provider:'stripe',amount:dollars,vaultId:vault.id,paymentIntentId:intent.id,status:intent.status,newBalance});
      }

      const publishableKey=(process.env.STRIPE_PUBLISHABLE_KEY||'').trim();
      if(!publishableKey)return res.status(503).json({ok:false,error:'Stripe publishable key still needs to be added to Vercel.'});
      if(secretKey.startsWith('sk_test_')&&!publishableKey.startsWith('pk_test_'))return res.status(503).json({ok:false,error:'Use the Stripe sandbox publishable key (pk_test_...) with the sandbox secret key.'});

      const body=new URLSearchParams();
      body.set('customer',customer.id);
      body.append('payment_method_types[]','card');
      body.set('usage','off_session');
      body.set('metadata[savemoney_user_id]',user.id);
      const setupIntent=await stripeRequest(secretKey,'/v1/setup_intents',{method:'POST',body});
      return res.status(200).json({
        ok:true,
        sandbox:secretKey.startsWith('sk_test_'),
        clientSecret:setupIntent.client_secret,
        publishableKey
      });
    }catch(error){
      return res.status(500).json({ok:false,error:error.message||'Unable to configure Stripe payment methods.'});
    }
  }

  res.setHeader('Allow','GET, POST');
  return res.status(405).json({ok:false,error:'Method not allowed'});
}
