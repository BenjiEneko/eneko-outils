// ════════════════════════════════════════════════════════════════
//  /api/cron-elearning  —  Précharge la progression Circle de tous les
//  dossiers (cron Vercel tous les 2 jours, voir vercel.json).
//
//  Sécurité : Vercel envoie `Authorization: Bearer <CRON_SECRET>` ;
//  sans CRON_SECRET configuré, ce chemin refuse tout (fail-closed).
//  Déclenchement manuel possible en POST avec une session interne
//  (`{ auth: { email, token } }`) — pour forcer un relevé sans attendre.
// ════════════════════════════════════════════════════════════════

import { circleConfigured } from './_lib/circle.js';
import { guardPost } from './_lib/guard.js';
import { isAuthorized } from './_lib/token.js';
import { buildSnapshot } from './_lib/elearning-snapshot.js';

export default async function handler(req, res) {
  if (req.method === 'POST') {
    if (!(await guardPost(req, res, { maxBodyChars: 2_000, limit: 3, windowMs: 60_000 }))) return;
    const auth = req.body?.auth;
    if (!auth || !isAuthorized(auth.email, auth.token)) {
      return res.status(401).json({ error: 'Session interne requise.' });
    }
  } else {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers?.authorization || '';
    if (!secret || auth !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Non autorisé.' });
    }
  }
  if (!circleConfigured() || !process.env.NOTION_TOKEN) {
    console.error('cron-elearning : CIRCLE_HEADLESS_TOKEN ou NOTION_TOKEN manquant.');
    return res.status(500).json({ error: 'Configuration incomplète.' });
  }
  try {
    const bilan = await buildSnapshot();
    console.log('cron-elearning :', JSON.stringify(bilan));
    return res.status(200).json({ ok: true, ...bilan });
  } catch (err) {
    console.error('cron-elearning error:', err.message);
    return res.status(500).json({ error: 'Préchargement impossible.' });
  }
}
