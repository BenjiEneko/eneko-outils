import { rateLimited } from './_lib/guard.js';
import { getAuthSecret, signToken } from './_lib/token.js';

const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (rateLimited(req, { limit: 10, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Trop de tentatives. Réessaie dans une minute.' });
  }

  const secret = getAuthSecret();
  if (!secret) {
    return res.status(500).json({ error: 'Service indisponible (configuration).' });
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

  const token = signToken(normalized, secret);
  return res.status(200).json({ token, email: normalized });
}
