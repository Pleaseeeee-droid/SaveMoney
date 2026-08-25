export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return res.status(500).json({ error: 'Stripe key is not configured.' });
  if (!key.startsWith('sk_test_')) {
    return res.status(403).json({ error: 'Safety block: verification is sandbox-only right now.' });
  }

  const sessionId = String(req.query?.session_id || '');
  if (!sessionId.startsWith('cs_test_')) return res.status(400).json({ error: 'Invalid sandbox session.' });

  try {
    const stripeResponse = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${key}` }
    });
    const data = await stripeResponse.json();
    if (!stripeResponse.ok) {
      return res.status(stripeResponse.status).json({ error: data?.error?.message || 'Stripe verification failed.' });
    }

    if (data?.metadata?.purpose !== 'savemoney_vault_deposit') {
      return res.status(400).json({ error: 'This Stripe session is not a SaveMoney vault deposit.' });
    }
    if (data.payment_status !== 'paid') {
      return res.status(409).json({ error: 'Payment is not confirmed as paid yet.' });
    }

    return res.status(200).json({
      ok: true,
      sandbox: true,
      sessionId: data.id,
      vaultId: data.metadata.vault_id,
      amount: Number(data.amount_total || 0) / 100,
      currency: data.currency
    });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to verify sandbox payment.' });
  }
}
