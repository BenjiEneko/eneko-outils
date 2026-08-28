// ════════════════════════════════════════════════════════════════
//  api/_lib/quiz-submit.js  —  Implémentation partagée des soumissions
//  de quiz (edge runtime). submit-quiz.js et submit-quiz-auto.js
//  étaient identiques à ~95 % : seuls varient la base Notion, le
//  mapping de profils et l'en-tête Slack — passés ici en options.
//
//  Durcissements par rapport à l'ancienne version :
//   - body JSON malformé → 400 propre (plus de crash 500 opaque)
//   - champs validés/normalisés (plus de throw sur objectives absent)
//   - erreurs Notion/Slack loggées côté serveur mais JAMAIS renvoyées
//     au client (elles exposaient IDs de base et noms de propriétés)
//   - timeout 10 s sur chaque appel sortant
// ════════════════════════════════════════════════════════════════

import { originAllowed } from './guard.js';

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export async function handleQuizSubmit(req, { profileMap, dbEnvKey, slackHeader, formationDefault }) {
  if (req.method !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }
  if (!originAllowed(req)) {
    return json(403, { ok: false, error: 'Origine non autorisée.' });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: 'Corps de requête invalide.' });
  }

  const firstName = str(body.firstName, 80);
  const lastName = str(body.lastName, 80);
  const email = str(body.email, 200);
  const company = str(body.company, 200);
  const profile = str(body.profile, 100);
  const formation = str(body.formation, 100);
  const score = num(body.score);
  const maxScore = num(body.maxScore);
  const objectives = Array.isArray(body.objectives) ? body.objectives.map(o => str(o, 200)) : [];
  const answers = Array.isArray(body.answers) ? body.answers.slice(0, 40) : [];

  if (!firstName || !email) {
    return json(400, { ok: false, error: 'Prénom et email requis.' });
  }

  const notionToken = process.env.NOTION_TOKEN;
  const notionDb = process.env[dbEnvKey];
  const slackUrl = process.env.SLACK_WEBHOOK_URL;

  const notionProfile = profileMap[profile] ?? profile;
  let failed = false;

  /* ── NOTION ── */
  if (notionToken && notionDb) {
    try {
      const properties = {
        'Nom Prénom': { title: [{ text: { content: `${firstName} ${lastName}`.trim() } }] },
        'Email': { email: email },
        'Entreprise': { rich_text: [{ text: { content: company } }] },
        'Score': { number: score },
        'Profil': { select: { name: notionProfile } },
        'Date Quizz': { date: { start: new Date().toISOString().split('T')[0] } },
        'Objectifs': { rich_text: [{ text: { content: objectives.join(', ').slice(0, 2000) } }] },
      };

      const res = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${notionToken}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          parent: { database_id: notionDb },
          properties,
          children: answers.length ? [
            {
              object: 'block',
              type: 'heading_2',
              heading_2: { rich_text: [{ type: 'text', text: { content: 'Réponses détaillées' } }] },
            },
            ...answers.map(a => ({
              object: 'block',
              type: 'paragraph',
              paragraph: {
                rich_text: [
                  {
                    type: 'text',
                    text: { content: `[${num(a?.score)}/${num(a?.maxScore)}] ${str(a?.theme, 200)} — ${str(a?.answer, 1500)}` },
                    annotations: { bold: num(a?.score) === num(a?.maxScore) },
                  },
                ],
              },
            })),
          ] : [],
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        console.error(`Notion error ${res.status}:`, (await res.text()).slice(0, 500));
        failed = true;
      }
    } catch (e) {
      console.error('Notion error:', e.message);
      failed = true;
    }
  } else {
    console.error(`Config manquante : NOTION_TOKEN ou ${dbEnvKey} non définie.`);
    failed = true;
  }

  /* ── SLACK ── */
  if (slackUrl) {
    try {
      const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
      const fields = [
        { type: 'mrkdwn', text: `*Nom*\n${firstName} ${lastName}` },
        { type: 'mrkdwn', text: `*Email*\n${email}` },
        { type: 'mrkdwn', text: `*Entreprise*\n${company || '—'}` },
        { type: 'mrkdwn', text: `*Profil*\n${profile}` },
        { type: 'mrkdwn', text: `*Score*\n${score}/${maxScore} (${pct}%)` },
      ];
      if (formationDefault) {
        fields.push({ type: 'mrkdwn', text: `*Formation*\n${formation || formationDefault}` });
      }
      const res = await fetch(slackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blocks: [
            { type: 'header', text: { type: 'plain_text', text: slackHeader } },
            { type: 'section', fields },
            { type: 'section', text: { type: 'mrkdwn', text: `*Objectifs*\n${objectives.join(' · ') || '—'}` } },
          ],
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        console.error('Slack error:', (await res.text()).slice(0, 300));
        failed = true;
      }
    } catch (e) {
      console.error('Slack error:', e.message);
      failed = true;
    }
  }

  if (failed) {
    return json(500, { ok: false, error: "L'enregistrement a partiellement ou totalement échoué." });
  }
  return json(200, { ok: true });
}
