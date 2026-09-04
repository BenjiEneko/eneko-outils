// ════════════════════════════════════════════════════════════════
//  /api/dossier-pdf  —  Sert un PDF de dossier d'inscription
//
//  Le store Vercel Blob du projet est en accès PRIVÉ : les PDF
//  générés par /api/dossier-submit ne sont pas accessibles par URL
//  directe. Cet endpoint streame le fichier côté serveur pour les
//  liens Slack / Notion : GET /api/dossier-pdf?f=<fichier>.
//
//  Protection : le nom de fichier contient le suffixe aléatoire
//  ajouté par le Blob (non devinable) + rate-limit IP. Seul le
//  préfixe `dossiers-inscription/` est servi.
// ════════════════════════════════════════════════════════════════

import { get } from '@vercel/blob';
import { checkRateLimit } from './_lib/guard.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (await checkRateLimit(req, { limit: 30, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Trop de requêtes. Réessayez dans une minute.' });
  }

  const f = typeof req.query?.f === 'string' ? req.query.f : '';
  if (!/^[a-z0-9][a-zA-Z0-9._-]{5,120}\.pdf$/.test(f)) {
    return res.status(400).json({ error: 'Fichier invalide.' });
  }

  try {
    const found = await get(`dossiers-inscription/${f}`, {
      access: 'private',
      abortSignal: AbortSignal.timeout(15_000),
    });
    if (!found || !found.stream) {
      return res.status(404).json({ error: 'Document introuvable.' });
    }
    const buf = Buffer.from(await new Response(found.stream).arrayBuffer());
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${f}"`);
    res.setHeader('Cache-Control', 'private, max-age=0, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    return res.status(200).send(buf);
  } catch (err) {
    console.error('dossier-pdf error:', err.message);
    return res.status(500).json({ error: 'Document momentanément indisponible.' });
  }
}
