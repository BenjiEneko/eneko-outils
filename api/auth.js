import crypto from 'node:crypto';

const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

const SECRET = process.env.AUTH_SECRET || 'fallback-change-me';

function signToken(email) {
  return crypto
    .createHmac('sha256', SECRET)
    .update(email.toLowerCase().trim())
    .digest('hex');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body || {};

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email requis' });
  }

  const normalized = email.toLowerCase().trim();

  if (!ALLOWED_EMAILS.includes(normalized)) {
    // Délai constant pour éviter l'énumération d'emails
    await new Promise(r => setTimeout(r, 400));
    return res.status(403).json({ error: 'Accès non autorisé pour cette adresse.' });
  }

  const token = signToken(normalized);
  return res.status(200).json({ token, email: normalized });
}
