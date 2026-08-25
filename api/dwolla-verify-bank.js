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
  const key=(process.env.DWOLLA_KEY||'').trim();
  const secret=(process.env.DWOLLA_SECRET||'').trim();
  if(!key||!secret)throw new Error('Dwolla is not configured.');

  const r=await fetch('https://api-sandbox.dwolla.com/token',{
    method:'POST',
    headers:{
      Authorization:`Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`,
      'Content-Type':'application/x-www-form-urlencoded',
      Accept:'application/json'
    },
    body:new URLSearchParams({grant_type:'client_credentials'}).toString()
  });

  const raw=await r.text();
  let data={};try{data=raw?JSON.parse(raw):{};}catch{}
  if(!r.ok||!data.access_token){
    throw new Error(data.error_description||data.error||`Dwolla authentication failed (${r.status}).`);
  }
  return data.access_token;
}

async function apiGet(token,url){
  const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.dwolla.v1.hal+json'}});
  const raw=await r.text();
  let data={};try{data=raw?JSON.parse(raw):{};}catch{}
  if(!r.ok)throw new Error(data.message||data.code||raw||`Dwolla request failed (${r.status}).`);
  return data;
}

async function findCustomer(token,userId){
  const correlationId=`savemoney-${String(userId).toLowerCase()}`;
  const email=`savemoney.${String(userId).replace(/-/g,'').slice(0,20)}@example.com`;
  const data=await apiGet(token,`https://api-sandbox.dwolla.com/customers?search=${encodeURIComponent(email)}&limit=25`);
  return (data?._embedded?.customers||[]).find(c=>c.correlationId===correlationId||c.email===email)||null;
}

async function listFundingSources(token,customerId){
  const data=await apiGet(token,`https://api-sandbox.dwolla.com/customers/${encodeURIComponent(customerId)}/funding-sources?removed=false`);
  return data?._embedded?.['funding-sources']||[];
}

function isBank(fs){
  return fs?.type==='bank'||Boolean(fs?.bankAccountType)||fs?.name==='SaveMoney Test Checking';
}

async function postDwolla(token,url,body){
  const headers={
    Authorization:`Bearer ${token}`,
    Accept:'application/vnd.dwolla.v1.hal+json',
    'Content-Type':'application/vnd.dwolla.v1.hal+json'
  };
  const options={method:'POST',headers};
  if(body!==undefined)options.body=JSON.stringify(body);
  const r=await fetch(url,options);
  const raw=await r.text();
  let data={};try{data=raw?JSON.parse(raw):{};}catch{}
  return {ok:r.ok,status:r.status,data,raw};
}

export default async function handler(req,res){
  if(!['GET','POST'].includes(req.method)){
    res.setHeader('Allow','GET, POST');
    return res.status(405).json({error:'Method not allowed'});
  }

  const saveMoneyToken=bearer(req);
  if(!saveMoneyToken)return res.status(401).json({error:'Sign in required.'});

  try{
    const user=await getSupabaseUser(saveMoneyToken);
    if(!user?.id)return res.status(401).json({error:'Invalid SaveMoney session.'});

    const dToken=await dwollaToken();
    const customer=await findCustomer(dToken,user.id);
    if(!customer)return res.status(404).json({ok:false,error:'Create the Dwolla sandbox customer first.'});

    let sources=await listFundingSources(dToken,customer.id);
    let bank=sources.find(fs=>isBank(fs)&&fs.status!=='verified')||sources.find(isBank);
    if(!bank)return res.status(404).json({ok:false,error:'No test bank funding source was found.'});

    if(req.method==='GET'){
      return res.status(200).json({ok:true,sandbox:true,bank:{id:bank.id,name:bank.name,status:bank.status}});
    }

    if(bank.status==='verified'){
      return res.status(200).json({ok:true,sandbox:true,verified:true,bank:{id:bank.id,name:bank.name,status:'verified'}});
    }

    const microUrl=`https://api-sandbox.dwolla.com/funding-sources/${encodeURIComponent(bank.id)}/micro-deposits`;

    const initiate=await postDwolla(dToken,microUrl);
    if(!initiate.ok && ![400,403,409].includes(initiate.status)){
      const msg=initiate.data?.message||initiate.data?.code||initiate.raw||`Could not initiate micro-deposits (${initiate.status}).`;
      return res.status(initiate.status).json({ok:false,error:msg});
    }

    const verifyBody={
      amount1:{value:'0.03',currency:'USD'},
      amount2:{value:'0.08',currency:'USD'}
    };
    const verify=await postDwolla(dToken,microUrl,verifyBody);
    if(!verify.ok){
      const msg=verify.data?.message||verify.data?.code||verify.raw||`Could not verify micro-deposits (${verify.status}).`;
      return res.status(verify.status).json({ok:false,error:msg});
    }

    sources=await listFundingSources(dToken,customer.id);
    bank=sources.find(fs=>fs.id===bank.id)||bank;
    return res.status(200).json({ok:true,sandbox:true,verified:bank.status==='verified',bank:{id:bank.id,name:bank.name,status:bank.status}});
  }catch(err){
    return res.status(500).json({ok:false,error:err.message||'Unable to verify Dwolla sandbox bank.'});
  }
}
