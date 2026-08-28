// ════════════════════════════════════════════════════════════════
//  api/_lib/guard.js  —  Garde-fous communs des endpoints publics
//
//  Les proxys IA n'ont ni compte ni session : la protection repose
//  sur trois barrières complémentaires (aucune n'est parfaite seule) :
//    1. Vérification d'origine (Origin/Referer) — stoppe les appels
//       cross-site et les scripts naïfs (curl sans headers).
//    2. Rate-limit en mémoire par IP — best-effort : la Map vit dans
//       l'instance serverless chaude, donc la limite est par instance.
//       Suffisant contre les boucles simples ; pour une vraie limite
//       distribuée, brancher Upstash/Vercel KV ici (un seul fichier
//       à modifier).
//    3. Plafonds de taille — l'input Anthropic est facturé au token,
//       max_tokens ne borne que la sortie.
// ════════════════════════════════════════════════════════════════

const ALLOWED_HOST_SUFFIXES = ['.eneko.ai', '.vercel.app'];
const ALLOWED_HOSTS = ['outils.eneko.ai', 'eneko.ai', 'localhost', '127.0.0.1'];

function hostAllowed(value) {
  if (!value) return false;
  try {
    const host = new URL(value).hostname;
    return (
      ALLOWED_HOSTS.includes(host) ||
      ALLOWED_HOST_SUFFIXES.some(s => host.endsWith(s))
    );
  } catch {
    return false;
  }
}

// Fonctionne avec les deux runtimes : req.headers Node (objet) ou Web (Headers).
function getHeader(req, name) {
  if (typeof req.headers?.get === 'function') return req.headers.get(name) || '';
  return req.headers?.[name] || '';
}

export function originAllowed(req) {
  const origin = getHeader(req, 'origin');
  const referer = getHeader(req, 'referer');
  // Un navigateur envoie toujours Origin sur un POST fetch ; un client
  // sans aucun des deux headers n'est pas notre front.
  if (!origin && !referer) return false;
  if (origin) return hostAllowed(origin);
  return hostAllowed(referer);
}

/* ── Rate-limit en mémoire (par instance) ─────────────────────── */

const buckets = new Map();

export function rateLimited(req, { limit = 20, windowMs = 60_000 } = {}) {
  const xff = getHeader(req, 'x-forwarded-for');
  const ip = (xff.split(',')[0] || 'unknown').trim();
  const now = Date.now();

  // Évite une croissance non bornée de la Map.
  if (buckets.size > 5_000) {
    for (const [k, v] of buckets) {
      if (v.resetAt < now) buckets.delete(k);
    }
  }

  const bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + windowMs });
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}

/* ── Garde combinée pour les handlers Node ────────────────────── */

// Renvoie true si la requête est acceptable, sinon répond et renvoie false.
export function guardPost(req, res, { maxBodyChars = 30_000, limit = 20, windowMs = 60_000 } = {}) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return false;
  }
  if (!originAllowed(req)) {
    res.status(403).json({ error: 'Origine non autorisée.' });
    return false;
  }
  if (rateLimited(req, { limit, windowMs })) {
    res.status(429).json({ error: 'Trop de requêtes. Réessaie dans une minute.' });
    return false;
  }
  let size = 0;
  try {
    size = JSON.stringify(req.body || {}).length;
  } catch {
    size = Infinity;
  }
  if (size > maxBodyChars) {
    res.status(413).json({ error: 'Requête trop volumineuse.' });
    return false;
  }
  return true;
}

/* ── Nettoyage d'un historique de conversation ────────────────── */

// Ne garde que des paires {role, content} valides et bornées.
// Renvoie null si la structure est inutilisable.
export function capMessages(messages, { maxMessages = 40, maxContentChars = 8_000 } = {}) {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  if (messages.length > maxMessages) return null;
  const clean = [];
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) return null;
    if (typeof m.content !== 'string') return null;
    clean.push({ role: m.role, content: m.content.slice(0, maxContentChars) });
  }
  return clean;
}

// Tronque une chaîne arbitraire (entrée libre utilisateur) à une borne sûre.
export function capString(value, max = 8_000) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}
