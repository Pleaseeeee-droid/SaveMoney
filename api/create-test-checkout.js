export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return res.status(500).json({ error: 'Stripe key is not configured.' });
  if (!key.startsWith('sk_test_')) {
    return res.status(403).json({ error: 'Safety block: this endpoint only works with a Stripe sandbox/test key.' });
  }

  try {
    const origin = req.headers.origin || 'https://save-money-azure.vercel.app';
    const body = new URLSearchParams();
    body.set('mode', 'payment');
    body.set('success_url', `${origin}/?stripe_test=success`);
    body.set('cancel_url', `${origin}/?stripe_test=cancelled`);
    body.set('line_items[0][quantity]', '1');
    body.set('line_items[0][price_data][currency]', 'usd');
    body.set('line_items[0][price_data][unit_amount]', '500');
    body.set('line_items[0][price_data][product_data][name]', 'SaveMoney sandbox test deposit');
    body.set('metadata[purpose]', 'savemoney_sandbox_test');

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

    return res.status(200).json({ ok: true, sandbox: true, url: data.url, sessionId: data.id });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to create sandbox checkout session.' });
  }
}
