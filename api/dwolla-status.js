export default async function handler(req,res){
  if(req.method!=='GET'){
    res.setHeader('Allow','GET');
    return res.status(405).json({error:'Method not allowed'});
  }

  const key=(process.env.DWOLLA_KEY||'').trim();
  const secret=(process.env.DWOLLA_SECRET||'').trim();

  if(!key||!secret){
    return res.status(500).json({
      ok:false,
      connected:false,
      sandbox:true,
      error:'Dwolla is not configured.',
      hasKey:Boolean(key),
      hasSecret:Boolean(secret)
    });
  }

  try{
    const tokenResponse=await fetch('https://api-sandbox.dwolla.com/token',{
      method:'POST',
      headers:{
        Authorization:`Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`,
        'Content-Type':'application/x-www-form-urlencoded',
        Accept:'application/json'
      },
      body:new URLSearchParams({grant_type:'client_credentials'}).toString()
    });

    const raw=await tokenResponse.text();
    let data={};
    try{data=raw?JSON.parse(raw):{};}catch{data={raw:raw.slice(0,300)};}

    if(!tokenResponse.ok||!data.access_token){
      return res.status(tokenResponse.status||500).json({
        ok:false,
        connected:false,
        sandbox:true,
        httpStatus:tokenResponse.status,
        dwollaError:data?.error||data?.code||null,
        dwollaMessage:data?.error_description||data?.message||data?.raw||'Dwolla sandbox authentication failed.'
      });
    }

    return res.status(200).json({
      ok:true,
      connected:true,
      sandbox:true,
      tokenType:data.token_type||null,
      expiresIn:data.expires_in||null
    });
  }catch(error){
    return res.status(500).json({
      ok:false,
      connected:false,
      sandbox:true,
      error:'Unable to reach Dwolla sandbox.',
      detail:error?.message||'Unknown network error'
    });
  }
}
