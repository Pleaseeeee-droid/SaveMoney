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
  if(!r.ok||!data.access_token)throw new Error(data.error_description||data.error||`Dwolla authentication failed (${r.status}).`);
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
function isBalance(fs){
  return fs?.type==='balance'||fs?.name==='Balance'||Boolean(fs?._links?.balance);
}

export default async function handler(req,res){
  if(req.method!=='POST'){
    res.setHeader('Allow','POST');
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

    const sources=await listFundingSources(dToken,customer.id);
    const bank=sources.find(fs=>isBank(fs)&&fs.status==='verified');
    const balance=sources.find(isBalance);
    if(!bank)return res.status(400).json({ok:false,error:'Verify SaveMoney Test Checking first.'});
    if(!balance)return res.status(400).json({ok:false,error:'Dwolla Balance funding source was not found.'});

    const transfer=await fetch('https://api-sandbox.dwolla.com/transfers',{
      method:'POST',
      headers:{
        Authorization:`Bearer ${dToken}`,
        Accept:'application/vnd.dwolla.v1.hal+json',
        'Content-Type':'application/vnd.dwolla.v1.hal+json',
        'Idempotency-Key':`savemoney-${String(user.id).toLowerCase()}-bank-to-balance-1-v2`
      },
      body:JSON.stringify({
        _links:{
          source:{href:`https://api-sandbox.dwolla.com/funding-sources/${bank.id}`},
          destination:{href:`https://api-sandbox.dwolla.com/funding-sources/${balance.id}`}
        },
        amount:{currency:'USD',value:'1.00'}
      })
    });

    const raw=await transfer.text();
    let data={};try{data=raw?JSON.parse(raw):{};}catch{}
    if(!transfer.ok){
      const embedded=data?._embedded?.errors?.map(e=>e.message).filter(Boolean).join(' ')||'';
      return res.status(transfer.status).json({ok:false,error:embedded||data.message||data.code||raw||`Dwolla transfer failed (${transfer.status}).`});
    }

    const location=transfer.headers.get('location')||'';
    let status='created';
    let transferId=location.split('/').filter(Boolean).pop()||null;
    if(location){
      try{
        const t=await apiGet(dToken,location);
        status=t.status||status;
        transferId=t.id||transferId;
      }catch{}
    }

    return res.status(201).json({ok:true,sandbox:true,amount:1,transferId,status});
  }catch(err){
    return res.status(500).json({ok:false,error:err.message||'Unable to create Dwolla sandbox transfer.'});
  }
}
