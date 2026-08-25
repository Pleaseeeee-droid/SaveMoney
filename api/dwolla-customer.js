function bearer(req){
  const auth=req.headers.authorization||'';
  return auth.startsWith('Bearer ')?auth.slice(7):'';
}

async function getSupabaseUser(token){
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key)throw new Error('Supabase is not configured.');
  const r=await fetch(`${url}/auth/v1/user`,{headers:{apikey:key,Authorization:`Bearer ${token}`}});
  if(!r.ok)return null;
  return r.json();
}

async function dwollaToken(){
  const key=process.env.DWOLLA_KEY;
  const secret=process.env.DWOLLA_SECRET;
  if(!key||!secret)throw new Error('Dwolla is not configured.');
  const r=await fetch('https://api-sandbox.dwolla.com/token',{
    method:'POST',
    headers:{
      Authorization:`Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`,
      'Content-Type':'application/x-www-form-urlencoded',
      Accept:'application/vnd.dwolla.v1.hal+json'
    },
    body:'grant_type=client_credentials'
  });
  const text=await r.text();
  let data={};try{data=JSON.parse(text);}catch{}
  if(!r.ok||!data.access_token)throw new Error(data.error_description||data.error||`Dwolla authentication failed (${r.status}).`);
  return data.access_token;
}

async function findCustomer(token,correlationId,email){
  const r=await fetch(`https://api-sandbox.dwolla.com/customers?search=${encodeURIComponent(email)}&limit=25`,{
    headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.dwolla.v1.hal+json'}
  });
  if(!r.ok)return null;
  const data=await r.json();
  return (data?._embedded?.customers||[]).find(c=>c.correlationId===correlationId||c.email===email)||null;
}

async function retrieveCustomer(token,id){
  const r=await fetch(`https://api-sandbox.dwolla.com/customers/${encodeURIComponent(id)}`,{
    headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.dwolla.v1.hal+json'}
  });
  if(!r.ok)return null;
  return r.json();
}

export default async function handler(req,res){
  if(!['GET','POST'].includes(req.method)){
    res.setHeader('Allow','GET, POST');
    return res.status(405).json({error:'Method not allowed'});
  }

  const token=bearer(req);
  if(!token)return res.status(401).json({error:'Sign in required.'});

  try{
    const user=await getSupabaseUser(token);
    if(!user?.id)return res.status(401).json({error:'Invalid SaveMoney session.'});

    const dwToken=await dwollaToken();
    const correlationId=`savemoney-${String(user.id).toLowerCase()}`;
    const email=`savemoney.${String(user.id).replace(/-/g,'').slice(0,20)}@example.com`;

    let customer=await findCustomer(dwToken,correlationId,email);
    if(customer){
      const full=await retrieveCustomer(dwToken,customer.id);
      customer=full||customer;
      return res.status(200).json({ok:true,exists:true,sandbox:true,customer:{id:customer.id,type:customer.type,status:customer.status}});
    }

    if(req.method==='GET')return res.status(200).json({ok:true,exists:false,sandbox:true});

    const create=await fetch('https://api-sandbox.dwolla.com/customers',{
      method:'POST',
      headers:{
        Authorization:`Bearer ${dwToken}`,
        Accept:'application/vnd.dwolla.v1.hal+json',
        'Content-Type':'application/vnd.dwolla.v1.hal+json'
      },
      body:JSON.stringify({
        firstName:'verified',
        lastName:'SaveMoney',
        email,
        type:'personal',
        address1:'99-99 33rd St',
        city:'Some City',
        state:'NY',
        postalCode:'11101',
        dateOfBirth:'1970-01-01',
        ssn:'1234',
        correlationId
      })
    });

    const raw=await create.text();
    let data={};try{data=JSON.parse(raw);}catch{}
    if(!create.ok){
      return res.status(create.status).json({ok:false,error:data.message||data.code||raw||`Dwolla customer creation failed (${create.status}).`});
    }

    const location=create.headers.get('location')||'';
    const id=location.split('/').filter(Boolean).pop();
    const full=id?await retrieveCustomer(dwToken,id):null;
    return res.status(201).json({ok:true,created:true,sandbox:true,customer:{id:id||null,type:full?.type||'personal',status:full?.status||'unknown'}});
  }catch(err){
    return res.status(500).json({ok:false,error:err.message||'Unable to set up Dwolla sandbox customer.'});
  }
}
