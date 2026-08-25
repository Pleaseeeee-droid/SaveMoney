function bearer(req){
  const auth=req.headers.authorization||'';
  return auth.startsWith('Bearer ')?auth.slice(7):'';
}

async function stripeRequest(secret,path,{method='GET',body}={}){
  const response=await fetch(`https://api.stripe.com${path}`,{
    method,
    headers:{
      Authorization:`Bearer ${secret}`,
      ...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})
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

  if((req.method==='GET'&&action==='payment-methods')||(req.method==='POST'&&action==='setup-card')){
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
