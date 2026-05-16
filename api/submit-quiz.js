export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const { firstName, lastName, email, company, role, score, maxScore, profile, objectives } = await req.json();

  const notionToken = process.env.NOTION_TOKEN;
  const notionDb    = process.env.NOTION_DB_ID;
  const slackUrl    = process.env.SLACK_WEBHOOK_URL;

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
          'Nom':        { title:     [{ text: { content: `${firstName} ${lastName}` } }] },
          'Email':      { email:     email },
          'Entreprise': { rich_text: [{ text: { content: company || '' } }] },
          'Poste':      { rich_text: [{ text: { content: role    || '' } }] },
          'Score':      { number:    score },
          'Profil':     { select:    { name: profile } },
          'Date':       { date:      { start: new Date().toISOString().split('T')[0] } },
          'Objectifs':  { rich_text: [{ text: { content: objectives.join(', ') } }] },
        },
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
              { type: 'mrkdwn', text: `*Poste*\n${role || '—'}` },
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
