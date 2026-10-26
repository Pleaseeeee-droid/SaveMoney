export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key)return res.status(500).json({error:'Supabase is not configured.'});
  if(req.query?.mode==='recovery'){
    const authorization=String(req.headers.authorization||'');
    const accessToken=authorization.startsWith('Bearer ')?authorization.slice(7):'';
    const password=req.body?.password;
    if(!accessToken)return res.status(401).json({error:'Recovery link is missing or expired. Request a new link.'});
    if(typeof password!=='string'||password.length<12||password.length>128)
      return res.status(400).json({error:'Use a new password with 12 to 128 characters.'});
    try{
      const r=await fetch(`${url}/auth/v1/user`,{
        method:'PUT',
        headers:{'Content-Type':'application/json',apikey:key,Authorization:`Bearer ${accessToken}`},
        body:JSON.stringify({password})
      });
      const data=await r.json().catch(()=>({}));
      if(!r.ok)return res.status(r.status===401?401:400).json({error:data?.msg||data?.error_description||data?.message||'Could not update password. Request a new recovery link.'});
      return res.status(200).json({ok:true});
    }catch{return res.status(502).json({error:'Could not reach Supabase. Please try again.'});}
  }
  const {email,password}=req.body||{};
  if(!email||!password)return res.status(400).json({error:'Email and password are required.'});
  try{
    const r=await fetch(`${url}/auth/v1/token?grant_type=password`,{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':key},
      body:JSON.stringify({email,password})
    });
    const data=await r.json();
    if(!r.ok)return res.status(401).json({error:data?.msg||data?.error_description||data?.message||'Invalid email or password.'});
    return res.status(200).json({ok:true,accessToken:data.access_token,refreshToken:data.refresh_token,expiresIn:data.expires_in,user:{id:data.user?.id,email:data.user?.email}});
  }catch{
    return res.status(500).json({error:'Unable to reach Supabase authentication.'});
  }
}