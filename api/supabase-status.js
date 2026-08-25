export default async function handler(req, res) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    return res.status(500).json({ ok: false, error: 'Supabase environment variables are missing.' });
  }

  try {
    const response = await fetch(`${url}/auth/v1/settings`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`
      }
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ ok: false, error: text || 'Supabase connection failed.' });
    }

    return res.status(200).json({
      ok: true,
      connected: true,
      projectUrl: url,
      authReachable: true
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Unable to reach Supabase.' });
  }
}
