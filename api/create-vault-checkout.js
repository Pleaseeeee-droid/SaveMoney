function tokenFrom(req){
  const auth=req.headers.authorization||'';
  return auth.startsWith('Bearer ')?auth.slice(7):'';
}

async function getUser(url,key,token){
  const r=await fetch(`${url}/auth/v1/user`,{headers:{apikey:key,Authorization:`Bearer ${token}`}});
  if(!r.ok)return null;
  return r.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!stripeKey || !supabaseUrl || !supabaseKey) return res.status(500).json({ error: 'Server is not fully configured.' });
  if (!stripeKey.startsWith('sk_test_')) return res.status(403).json({ error: 'Safety block: vault deposits are sandbox-only right now.' });

  const token=tokenFrom(req);
  if(!token)return res.status(401).json({error:'Sign in required.'});
  const user=await getUser(supabaseUrl,supabaseKey,token);
  if(!user?.id)return res.status(401).json({error:'Your session expired. Sign in again.'});

  try {
    const { vaultId, amount } = req.body || {};
    const dollars = Number(amount);
    const cents = Math.round(dollars * 100);
    if (!vaultId || typeof vaultId !== 'string') return res.status(400).json({ error: 'Missing vault.' });
    if (!Number.isFinite(dollars) || cents < 50) return res.status(400).json({ error: 'Minimum sandbox deposit is $0.50.' });
    if (cents > 1000000) return res.status(400).json({ error: 'Sandbox deposit is too large.' });

    const vaultResponse=await fetch(`${supabaseUrl}/rest/v1/vaults?id=eq.${encodeURIComponent(vaultId)}&select=id,name`,{
      headers:{apikey:supabaseKey,Authorization:`Bearer ${token}`}
    });
    const vaults=await vaultResponse.json();
    if(!vaultResponse.ok)return res.status(vaultResponse.status).json({error:vaults?.message||'Could not verify vault.'});
    if(!Array.isArray(vaults)||!vaults.length)return res.status(404).json({error:'Vault not found.'});
    const vault=vaults[0];

    const baseUrl = `https://${req.headers.host}`;
    const body = new URLSearchParams();
    body.set('mode', 'payment');
    body.set('success_url', `${baseUrl}/?vault_payment=success&session_id={CHECKOUT_SESSION_ID}`);
    body.set('cancel_url', `${baseUrl}/?vault_payment=cancelled`);
    body.set('managed_payments[enabled]', 'false');
    body.set('line_items[0][quantity]', '1');
    body.set('line_items[0][price_data][currency]', 'usd');
    body.set('line_items[0][price_data][unit_amount]', String(cents));
    body.set('line_items[0][price_data][product_data][name]', `SaveMoney sandbox deposit — ${String(vault.name).slice(0,40)}`);
    body.set('metadata[purpose]', 'savemoney_vault_deposit');
    body.set('metadata[vault_id]', vault.id);
    body.set('metadata[user_id]', user.id);

    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {Authorization: `Bearer ${stripeKey}`,'Content-Type': 'application/x-www-form-urlencoded'},
      body
    });
    const data = await stripeResponse.json();
    if (!stripeResponse.ok) return res.status(stripeResponse.status).json({ error: data?.error?.message || 'Stripe request failed.' });
    return res.status(200).json({ ok: true, sandbox: true, url: data.url });
  } catch {
    return res.status(500).json({ error: 'Unable to create vault sandbox checkout.' });
  }
}
