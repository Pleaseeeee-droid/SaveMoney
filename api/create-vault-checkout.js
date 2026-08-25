export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return res.status(500).json({ error: 'Stripe key is not configured.' });
  if (!key.startsWith('sk_test_')) {
    return res.status(403).json({ error: 'Safety block: vault deposits are sandbox-only right now.' });
  }

  try {
    const { vaultId, vaultName, amount } = req.body || {};
    const dollars = Number(amount);
    const cents = Math.round(dollars * 100);

    if (!vaultId || typeof vaultId !== 'string') return res.status(400).json({ error: 'Missing vault.' });
    if (!Number.isFinite(dollars) || cents < 50) return res.status(400).json({ error: 'Minimum sandbox deposit is $0.50.' });
    if (cents > 1000000) return res.status(400).json({ error: 'Sandbox deposit is too large.' });

    const baseUrl = `https://${req.headers.host}`;
    const body = new URLSearchParams();
    body.set('mode', 'payment');
    body.set('success_url', `${baseUrl}/?vault_payment=success&session_id={CHECKOUT_SESSION_ID}`);
    body.set('cancel_url', `${baseUrl}/?vault_payment=cancelled`);
    body.set('managed_payments[enabled]', 'false');
    body.set('line_items[0][quantity]', '1');
    body.set('line_items[0][price_data][currency]', 'usd');
    body.set('line_items[0][price_data][unit_amount]', String(cents));
    body.set('line_items[0][price_data][product_data][name]', `SaveMoney sandbox deposit${vaultName ? ` — ${String(vaultName).slice(0, 40)}` : ''}`);
    body.set('metadata[purpose]', 'savemoney_vault_deposit');
    body.set('metadata[vault_id]', vaultId);

    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });

    const data = await stripeResponse.json();
    if (!stripeResponse.ok) {
      return res.status(stripeResponse.status).json({ error: data?.error?.message || 'Stripe request failed.' });
    }

    return res.status(200).json({ ok: true, sandbox: true, url: data.url });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to create vault sandbox checkout.' });
  }
}
