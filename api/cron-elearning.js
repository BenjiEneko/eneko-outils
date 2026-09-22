// ════════════════════════════════════════════════════════════════
//  /api/cron-elearning  —  Précharge la progression Circle de tous les
//  dossiers (cron Vercel tous les 2 jours, voir vercel.json).
//
//  Sécurité : Vercel envoie `Authorization: Bearer <CRON_SECRET>` ;
//  sans CRON_SECRET configuré, l'endpoint refuse tout (fail-closed).
// ════════════════════════════════════════════════════════════════

import { circleConfigured } from './_lib/circle.js';
import { buildSnapshot } from './_lib/elearning-snapshot.js';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers?.authorization || '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Non autorisé.' });
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
