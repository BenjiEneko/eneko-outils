import { getAuthSecret, verifyToken } from './_lib/token.js';

const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

export default async function handler(req, res) {
  // POST (body JSON) de préférence — le token ne transite plus en query
  // string. GET conservé pour compatibilité avec d'anciens fronts.
  let email, token;
  if (req.method === 'POST') {
    ({ email, token } = req.body || {});
  } else if (req.method === 'GET') {
    ({ email, token } = req.query);
  } else {
    return res.status(405).json({ valid: false });
  }

  if (!email || typeof email !== 'string' || !token) {
    return res.status(200).json({ valid: false });
  }

  const secret = getAuthSecret();
  if (!secret) {
    return res.status(200).json({ valid: false });
  }

  const normalized = email.toLowerCase().trim();

  if (!ALLOWED_EMAILS.includes(normalized)) {
    return res.status(200).json({ valid: false });
  }

  return res.status(200).json({ valid: verifyToken(normalized, token, secret) });
}
