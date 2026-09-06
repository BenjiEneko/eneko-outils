// ════════════════════════════════════════════════════════════════
//  /api/cron-relances  —  Récap hebdomadaire des relances dans Slack
//
//  Déclenché par le cron Vercel (vercel.json, lundi 06:00 UTC = 08:00
//  Paris en été / 07:00 en hiver). Même moteur que la vue « Relances »
//  du cockpit : mêmes règles, mêmes mises en sommeil.
//
//  Sécurité : Vercel envoie `Authorization: Bearer <CRON_SECRET>` ;
//  sans CRON_SECRET configuré, l'endpoint refuse tout (fail-closed).
// ════════════════════════════════════════════════════════════════

import { gatherRelances } from './_lib/relances-sources.js';

const COCKPIT_URL = 'https://outils.eneko.ai/cockpit-dossiers';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers?.authorization || '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Non autorisé.' });
  }
  const slackUrl = process.env.SLACK_WEBHOOK_URL;
  if (!slackUrl || !process.env.NOTION_TOKEN) {
    console.error('cron-relances : SLACK_WEBHOOK_URL ou NOTION_TOKEN manquant.');
    return res.status(500).json({ error: 'Configuration incomplète.' });
  }

  try {
    const { relances, groups } = await gatherRelances();
    // Les règles « compactes » (dossiers à qualifier) ne comptent pas
    // comme relances individuelles : une ligne de synthèse suffit.
    const actives = relances.filter(r => !r.compact);
    const compacts = groups.filter(g => g.compact);
    const dossiersConcernes = new Set(actives.map(r => r.dossierId)).size;

    const blocks = [
      { type: 'header', text: { type: 'plain_text', text: `☀️ Relances de la semaine — ${actives.length} à traiter` } },
      { type: 'section', text: { type: 'mrkdwn', text: actives.length
        ? `*${dossiersConcernes} dossier(s)* demandent une action. Tout se traite depuis le <${COCKPIT_URL}|Cockpit Dossiers → onglet Relances> (email pré-rédigé ou action, puis « Fait »).`
        : `Rien à relancer cette semaine 🎉 — <${COCKPIT_URL}|ouvrir le cockpit>` } },
    ];
    for (const g of groups.filter(g => !g.compact).slice(0, 12)) {
      const lines = g.items.slice(0, 15).map(r => `• *${r.reference}* — ${r.stagiaires.join(', ')}${r.detail ? ` · _${r.detail}_` : ''}`);
      if (g.items.length > 15) lines.push(`• … et ${g.items.length - 15} autre(s)`);
      blocks.push({ type: 'divider' });
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `${g.kind === 'email' ? '✉️' : '🛠️'} *${g.label}* (${g.items.length})\n${lines.join('\n')}`.slice(0, 2900) } });
    }
    for (const g of compacts) {
      blocks.push({ type: 'divider' });
      blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `🗂️ *${g.items.length} ${g.label.toLowerCase()}${g.items.length > 1 ? 's' : ''}* — à qualifier via le filtre « Étape : Sans étape » du cockpit.` }] });
    }

    const r = await fetch(slackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`Slack ${r.status}: ${(await r.text()).slice(0, 200)}`);

    return res.status(200).json({ ok: true, relances: relances.length, dossiers: dossiersConcernes });
  } catch (err) {
    console.error('cron-relances error:', err.message);
    return res.status(500).json({ error: 'Le récap a échoué.' });
  }
}
