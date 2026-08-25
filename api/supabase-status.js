const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const PUBLIC_KEY=process.env.SUPABASE_PUBLISHABLE_KEY||'';
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';

function bearer(req){
  const auth=req.headers.authorization||'';
  return auth.startsWith('Bearer ')?auth.slice(7):'';
}

async function jsonFetch(url,{method='GET',headers={},body}={}){
  const r=await fetch(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const raw=await r.text();
  let data=null;try{data=raw?JSON.parse(raw):null;}catch{data=raw;}
  if(!r.ok)throw new Error(data?.message||data?.error_description||data?.error||raw||`Request failed (${r.status}).`);
  return data;
}

async function sessionUser(token){
  if(!SUPABASE_URL||!PUBLIC_KEY)throw new Error('Supabase is not configured.');
  try{
    return await jsonFetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{apikey:PUBLIC_KEY,Authorization:`Bearer ${token}`}});
  }catch{return null;}
}

async function adminUpdateMetadata(user,autopay){
  if(!SERVICE_KEY)throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured.');
  const metadata={...(user.user_metadata||{})};
  if(autopay===null)delete metadata.savemoney_autopay;
  else metadata.savemoney_autopay=autopay;
  return jsonFetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(user.id)}`,{
    method:'PUT',
    headers:{apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'},
    body:{user_metadata:metadata}
  });
}

async function verifyVaultForUser(userId,vaultId){
  const data=await jsonFetch(`${SUPABASE_URL}/rest/v1/vaults?id=eq.${encodeURIComponent(vaultId)}&user_id=eq.${encodeURIComponent(userId)}&select=id,name,balance,user_id`,{
    headers:{apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`}
  });
  return Array.isArray(data)&&data.length?data[0]:null;
}

function validSchedule(body){
  const vaultId=String(body?.vaultId||'');
  const source=body?.source==='card'?'card':'bank';
  const amount=Number(body?.amount);
  const day=Number(body?.day);
  const timezone=String(body?.timezone||'UTC').slice(0,80);
  if(!vaultId||!Number.isFinite(amount)||amount<0.50||amount>10000||!Number.isInteger(day)||day<1||day>28)return null;
  return {vaultId,source,amount:Number(amount.toFixed(2)),day,timezone,enabled:body?.enabled!==false,lastRun:body?.lastRun||null,lastStatus:body?.lastStatus||null};
}

function dateParts(timeZone){
  try{
    const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const get=t=>parts.find(p=>p.type===t)?.value;
    return {year:get('year'),month:get('month'),day:Number(get('day'))};
  }catch{
    const d=new Date();return {year:String(d.getUTCFullYear()),month:String(d.getUTCMonth()+1).padStart(2,'0'),day:d.getUTCDate()};
  }
}

async function stripeRequest(path,{method='GET',body,idem}={}){
  const secret=(process.env.STRIPE_SECRET_KEY||'').trim();
  if(!secret.startsWith('sk_test_'))throw new Error('Safety block: background card auto-pay is sandbox-only.');
  const r=await fetch(`https://api.stripe.com${path}`,{
    method,
    headers:{Authorization:`Bearer ${secret}`,...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(idem?{'Idempotency-Key':idem}:{})},
    body:body?body.toString():undefined
  });
  const data=await r.json();
  if(!r.ok)throw new Error(data?.error?.message||`Stripe request failed (${r.status}).`);
  return data;
}

async function stripeCustomer(userId){
  const query=`metadata['savemoney_user_id']:'${String(userId).replace(/'/g,'')}'`;
  const found=await stripeRequest(`/v1/customers/search?${new URLSearchParams({query,limit:'1'}).toString()}`);
  return found?.data?.[0]||null;
}

async function creditCardAutopay(user,vault,schedule,runKey){
  const customer=await stripeCustomer(user.id);
  if(!customer)throw new Error('Saved Stripe customer was not found.');
  const methods=await stripeRequest(`/v1/payment_methods?${new URLSearchParams({customer:customer.id,type:'card',limit:'1'}).toString()}`);
  const pm=methods?.data?.[0];
  if(!pm)throw new Error('No saved debit card is available.');

  const body=new URLSearchParams();
  body.set('amount',String(Math.round(schedule.amount*100)));
  body.set('currency','usd');
  body.set('customer',customer.id);
  body.set('payment_method',pm.id);
  body.set('confirm','true');
  body.set('off_session','true');
  body.set('description',`SaveMoney sandbox auto-pay — ${String(vault.name).slice(0,40)}`);
  body.set('metadata[purpose]','savemoney_autopay');
  body.set('metadata[vault_id]',vault.id);
  body.set('metadata[user_id]',user.id);
  body.set('metadata[schedule_key]',runKey);
  const idem=`savemoney-bg-${user.id}-${vault.id}-${runKey}`.slice(0,240);
  const intent=await stripeRequest('/v1/payment_intents',{method:'POST',body,idem});
  if(intent.status!=='succeeded')throw new Error(`Stripe payment status is ${intent.status}.`);

  const ledger=await jsonFetch(`${SUPABASE_URL}/rest/v1/stripe_deposits?on_conflict=stripe_session_id`,{
    method:'POST',
    headers:{apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates,return=representation'},
    body:{stripe_session_id:intent.id,vault_id:vault.id,user_id:user.id,amount:schedule.amount}
  });
  if(Array.isArray(ledger)&&ledger.length){
    const fresh=await verifyVaultForUser(user.id,vault.id);
    const newBalance=Number(fresh.balance||0)+schedule.amount;
    await jsonFetch(`${SUPABASE_URL}/rest/v1/vaults?id=eq.${encodeURIComponent(vault.id)}&user_id=eq.${encodeURIComponent(user.id)}`,{
      method:'PATCH',
      headers:{apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json',Prefer:'return=minimal'},
      body:{balance:Number(newBalance.toFixed(2))}
    });
  }
  return {provider:'stripe',status:intent.status,id:intent.id};
}

async function dwollaToken(){
  const key=(process.env.DWOLLA_KEY||'').trim(),secret=(process.env.DWOLLA_SECRET||'').trim();
  if(!key||!secret)throw new Error('Dwolla is not configured.');
  const r=await fetch('https://api-sandbox.dwolla.com/token',{method:'POST',headers:{Authorization:`Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:'grant_type=client_credentials'});
  const data=await r.json();if(!r.ok||!data.access_token)throw new Error(data.error_description||'Dwolla authentication failed.');
  return data.access_token;
}

async function dwollaGet(token,url){
  const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.dwolla.v1.hal+json'}});
  const data=await r.json();if(!r.ok)throw new Error(data.message||'Dwolla request failed.');return data;
}

async function bankAutopay(user,vault,schedule,runKey){
  const token=await dwollaToken();
  const email=`savemoney.${String(user.id).replace(/-/g,'').slice(0,20)}@example.com`;
  const correlationId=`savemoney-${String(user.id).toLowerCase()}`;
  const found=await dwollaGet(token,`https://api-sandbox.dwolla.com/customers?search=${encodeURIComponent(email)}&limit=25`);
  const customer=(found?._embedded?.customers||[]).find(c=>c.correlationId===correlationId||c.email===email);
  if(!customer)throw new Error('Dwolla sandbox customer was not found.');
  const fs=await dwollaGet(token,`https://api-sandbox.dwolla.com/customers/${customer.id}/funding-sources?removed=false`);
  const sources=fs?._embedded?.['funding-sources']||[];
  const bank=sources.find(x=>(x.type==='bank'||x.bankAccountType||x.name==='SaveMoney Test Checking')&&x.status==='verified');
  const balance=sources.find(x=>x.type==='balance'||x.name==='Balance'||x._links?.balance);
  if(!bank||!balance)throw new Error('Verified Dwolla bank or balance was not found.');
  const transfer=await fetch('https://api-sandbox.dwolla.com/transfers',{
    method:'POST',
    headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.dwolla.v1.hal+json','Content-Type':'application/vnd.dwolla.v1.hal+json','Idempotency-Key':`savemoney-bg-${user.id}-${vault.id}-${runKey}`.slice(0,240)},
    body:JSON.stringify({_links:{source:{href:`https://api-sandbox.dwolla.com/funding-sources/${bank.id}`},destination:{href:`https://api-sandbox.dwolla.com/funding-sources/${balance.id}`}},amount:{currency:'USD',value:schedule.amount.toFixed(2)},correlationId:`vault-${vault.id}-${runKey}`.slice(0,255)})
  });
  const raw=await transfer.text();let data={};try{data=raw?JSON.parse(raw):{};}catch{}
  if(!transfer.ok)throw new Error(data.message||data.code||raw||`Dwolla transfer failed (${transfer.status}).`);
  return {provider:'dwolla',status:'pending',id:(transfer.headers.get('location')||'').split('/').pop()||null};
}

async function runCron(){
  if(!SERVICE_KEY)throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured.');
  const all=await jsonFetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`,{headers:{apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`}});
  const users=all?.users||[];
  const results=[];
  for(const user of users){
    const s=user.user_metadata?.savemoney_autopay;
    if(!s?.enabled)continue;
    const parts=dateParts(s.timezone||'UTC');
    if(parts.day!==Number(s.day))continue;
    const runKey=`${parts.year}-${parts.month}`;
    if(s.lastRun===runKey)continue;
    const vault=await verifyVaultForUser(user.id,s.vaultId);
    if(!vault){results.push({user:user.id,status:'skipped',reason:'vault missing'});continue;}
    try{
      const payment=s.source==='card'?await creditCardAutopay(user,vault,s,runKey):await bankAutopay(user,vault,s,runKey);
      const updated={...s,lastRun:runKey,lastStatus:payment.status,lastProvider:payment.provider,lastPaymentId:payment.id||null};
      await adminUpdateMetadata(user,updated);
      results.push({user:user.id,vault:vault.id,status:payment.status,provider:payment.provider});
    }catch(error){
      const updated={...s,lastStatus:`error: ${String(error.message||error).slice(0,180)}`};
      try{await adminUpdateMetadata(user,updated);}catch{}
      results.push({user:user.id,status:'error',error:error.message||String(error)});
    }
  }
  return results;
}

export default async function handler(req,res){
  const cronSecret=(process.env.CRON_SECRET||'').trim();
  const auth=req.headers.authorization||'';
  if(req.method==='GET'&&cronSecret&&auth===`Bearer ${cronSecret}`){
    try{return res.status(200).json({ok:true,background:true,results:await runCron()});}
    catch(error){return res.status(500).json({ok:false,error:error.message||'Background auto-pay failed.'});}
  }

  const token=bearer(req);
  if(!token)return res.status(401).json({ok:false,error:'Sign in required.'});
  const user=await sessionUser(token);
  if(!user?.id)return res.status(401).json({ok:false,error:'Your session expired. Sign in again.'});

  try{
    if(req.method==='GET')return res.status(200).json({ok:true,schedule:user.user_metadata?.savemoney_autopay||null,backgroundReady:Boolean(cronSecret&&SERVICE_KEY)});
    if(req.method==='DELETE'){
      await adminUpdateMetadata(user,null);
      return res.status(200).json({ok:true,removed:true});
    }
    if(req.method==='POST'){
      const schedule=validSchedule(req.body||{});
      if(!schedule)return res.status(400).json({ok:false,error:'Choose a vault, amount from $0.50 to $10,000, and a monthly day from 1 to 28.'});
      const vault=await verifyVaultForUser(user.id,schedule.vaultId);
      if(!vault)return res.status(404).json({ok:false,error:'Vault not found.'});
      const previous=user.user_metadata?.savemoney_autopay;
      if(previous?.vaultId===schedule.vaultId&&previous?.source===schedule.source&&Number(previous?.amount)===schedule.amount&&Number(previous?.day)===schedule.day){
        schedule.lastRun=previous.lastRun||null;schedule.lastStatus=previous.lastStatus||null;
      }
      await adminUpdateMetadata(user,schedule);
      return res.status(200).json({ok:true,schedule,backgroundReady:Boolean(cronSecret&&SERVICE_KEY)});
    }
    res.setHeader('Allow','GET, POST, DELETE');
    return res.status(405).json({ok:false,error:'Method not allowed'});
  }catch(error){
    return res.status(500).json({ok:false,error:error.message||'Unable to manage auto-pay.'});
  }
}
