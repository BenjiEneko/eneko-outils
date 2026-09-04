// ════════════════════════════════════════════════════════════════
//  api/_lib/token.js  —  Tokens d'accès signés (gate des outils internes)
//
//  Format : "<exp>.<hmac_sha256(email|exp)>" — signé ET horodaté.
//  Remplace l'ancien HMAC(email) permanent : un token observé n'est
//  plus valable à vie, et le secret n'a plus de fallback en dur
//  (fail closed si AUTH_SECRET n'est pas configuré sur Vercel).
// ════════════════════════════════════════════════════════════════

import crypto from 'node:crypto';

// Durée de vie d'un token : 30 jours (re-saisie de l'email ensuite).
export const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function getAuthSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    console.error("AUTH_SECRET manquant : configurer la variable d'environnement sur Vercel.");
    return null;
  }
  return secret;
}

export function signToken(email, secret, exp = Date.now() + TOKEN_TTL_MS) {
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${email.toLowerCase().trim()}|${exp}`)
    .digest('hex');
  return `${exp}.${sig}`;
}

// Vérifie qu'un couple (email, token) correspond à une session interne valide :
// email présent dans ALLOWED_EMAILS + signature et expiration valides.
// Renvoie false si AUTH_SECRET n'est pas configuré (fail closed).
export function isAuthorized(email, token) {
  const secret = getAuthSecret();
  if (!secret || typeof email !== 'string') return false;
  const allowed = (process.env.ALLOWED_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  const normalized = email.toLowerCase().trim();
  if (!allowed.includes(normalized)) return false;
  return verifyToken(normalized, token, secret);
}

/* ── Tokens de lien à payload (liens envoyés à un tiers) ────────
   Format : "<base64url(JSON)>.<hmac_sha256(purpose|payload)>".
   `purpose` sépare les domaines de signature : un token de lien ne
   peut pas être rejoué comme token de session, et inversement.
   L'expiration est portée par le champ `exp` (ms epoch) du payload. */

export function signPayloadToken(payload, secret, purpose) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${purpose}|${data}`).digest('hex');
  return `${data}.${sig}`;
}

// Vérifie signature + expiration et décode. Renvoie le payload ou null.
export function verifyPayloadToken(token, secret, purpose) {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const dot = token.indexOf('.');
  if (dot === -1) return null;
  const data = token.slice(0, dot);
  const expected = crypto.createHmac('sha256', secret).update(`${purpose}|${data}`).digest('hex');
  const a = Buffer.from(token.slice(dot + 1));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  try {
    if (!crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  if (!Number.isFinite(payload.exp) || payload.exp < Date.now()) return null;
  return payload;
}

// Vérifie un token "exp.sig" : structure, expiration, signature (temps constant).
export function verifyToken(email, token, secret) {
  if (typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot === -1) return false;

  const exp = Number(token.slice(0, dot));
  if (!Number.isFinite(exp) || exp < Date.now()) return false;

  const expected = signToken(email, secret, exp);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
