export default async function handler(req,res){
  if(req.method!=='GET'){
    res.setHeader('Allow','GET');
    return res.status(405).json({error:'Method not allowed'});
  }

  const key=process.env.DWOLLA_KEY;
  const secret=process.env.DWOLLA_SECRET;
  if(!key||!secret){
    return res.status(500).json({ok:false,connected:false,error:'Dwolla is not configured.'});
  }

  try{
    const tokenResponse=await fetch('https://api-sandbox.dwolla.com/token',{
      method:'POST',
      headers:{
        Authorization:`Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`,
        'Content-Type':'application/x-www-form-urlencoded',
        Accept:'application/vnd.dwolla.v1.hal+json'
      },
      body:'grant_type=client_credentials'
    });

    const data=await tokenResponse.json();
    if(!tokenResponse.ok||!data.access_token){
      return res.status(tokenResponse.status||500).json({ok:false,connected:false,error:data?.error_description||data?.error||'Dwolla sandbox authentication failed.'});
    }

    return res.status(200).json({ok:true,connected:true,sandbox:true});
  }catch{
    return res.status(500).json({ok:false,connected:false,error:'Unable to reach Dwolla sandbox.'});
  }
}
