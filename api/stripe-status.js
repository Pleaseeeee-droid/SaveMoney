export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    return res.status(500).json({ ok: false, error: 'STRIPE_SECRET_KEY is not configured' });
  }

  try {
    const stripeResponse = await fetch('https://api.stripe.com/v1/account', {
      headers: {
        Authorization: `Bearer ${secretKey}`,
      },
    });

    const data = await stripeResponse.json();

    if (!stripeResponse.ok) {
      return res.status(502).json({
        ok: false,
        error: data?.error?.message || 'Stripe connection failed',
      });
    }

    return res.status(200).json({
      ok: true,
      sandbox: secretKey.startsWith('sk_test_'),
      accountId: data.id,
      country: data.country || null,
      chargesEnabled: Boolean(data.charges_enabled),
      payoutsEnabled: Boolean(data.payouts_enabled),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'Unable to reach Stripe',
    });
  }
}
