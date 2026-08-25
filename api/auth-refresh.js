export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key)return res.status(500).json({error:'Supabase is not configured.'});
  const {refreshToken}=req.body||{};
  if(!refreshToken)return res.status(400).json({error:'Refresh token required.'});
  try{
    const r=await fetch(`${url}/auth/v1/token?grant_type=refresh_token`,{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':key},
      body:JSON.stringify({refresh_token:refreshToken})
    });
    const data=await r.json();
    if(!r.ok)return res.status(401).json({error:'Session expired.'});
    return res.status(200).json({ok:true,accessToken:data.access_token,refreshToken:data.refresh_token,expiresIn:data.expires_in,user:{id:data.user?.id,email:data.user?.email}});
  }catch{return res.status(500).json({error:'Unable to refresh session.'});}
}