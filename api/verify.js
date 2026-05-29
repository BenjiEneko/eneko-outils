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
  if (req.method !== 'GET') {
    return res.status(405).json({ valid: false });
  }

  const { email, token } = req.query;

  if (!email || !token) {
    return res.status(200).json({ valid: false });
  }

  const normalized = email.toLowerCase().trim();

  if (!ALLOWED_EMAILS.includes(normalized)) {
    return res.status(200).json({ valid: false });
  }

  const expected = signToken(normalized);

  try {
    // timingSafeEqual exige des buffers de même longueur
    const a = Buffer.from(token.padEnd(64, '0').slice(0, 64));
    const b = Buffer.from(expected);
    const valid = token.length === expected.length &&
      crypto.timingSafeEqual(a, b);
    return res.status(200).json({ valid });
  } catch {
    return res.status(200).json({ valid: false });
  }
}
