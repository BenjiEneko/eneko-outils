export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const { firstName, lastName, email, company, score, maxScore, profile, objectives, answers = [] } = await req.json();

  const notionToken = process.env.NOTION_TOKEN;
  const notionDb    = process.env.NOTION_DB_ID;
  const slackUrl    = process.env.SLACK_WEBHOOK_URL;

  const PROFILE_MAP = {
    'Explorateur IA':   'Débutant',
    'Pratiquant Averti': 'Curieux',
    'Utilisateur Avancé': 'Utilisateur Avancé',
    'Expert IA':        'Expert',
  };
  const notionProfile = PROFILE_MAP[profile] ?? profile;

  const errors = [];

  /* ── NOTION ── */
  try {
    const res = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        parent: { database_id: notionDb },
        properties: {
          'Nom Prénom': { title:     [{ text: { content: `${firstName} ${lastName}` } }] },
          'Email':      { email:     email },
          'Entreprise': { rich_text: [{ text: { content: company || '' } }] },
          'Score':      { number:    score },
          'Profil':     { select:    { name: notionProfile } },
          'Date Quizz': { date:      { start: new Date().toISOString().split('T')[0] } },
          'Objectifs':  { rich_text: [{ text: { content: objectives.join(', ') } }] },
        },
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
                  text: { content: `[${a.score}/${a.maxScore}] ${a.theme} — ${a.answer}` },
                  annotations: { bold: a.score === a.maxScore },
                },
              ],
            },
          })),
        ] : [],
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      errors.push(`Notion: ${err}`);
    }
  } catch (e) {
    errors.push(`Notion: ${e.message}`);
  }

  /* ── SLACK ── */
  try {
    const pct = Math.round((score / maxScore) * 100);
    const res = await fetch(slackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: '🎯 Nouveau résultat — Quiz IA Eneko' },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Nom*\n${firstName} ${lastName}` },
              { type: 'mrkdwn', text: `*Email*\n${email}` },
              { type: 'mrkdwn', text: `*Entreprise*\n${company || '—'}` },
              { type: 'mrkdwn', text: `*Profil*\n${profile}` },
              { type: 'mrkdwn', text: `*Score*\n${score}/${maxScore} (${pct}%)` },
            ],
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*Objectifs*\n${objectives.join(' · ')}` },
          },
        ],
      }),
    });
    if (!res.ok) errors.push(`Slack: ${await res.text()}`);
  } catch (e) {
    errors.push(`Slack: ${e.message}`);
  }

  if (errors.length) {
    return new Response(JSON.stringify({ ok: false, errors }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
