const DIAGNOSTIC_DB_ID = '6c806117b38948f8b6de743f449fccdb';
const NOTION_VERSION   = '2022-06-28';

/* ─────────────────────────────────────────────
   NOTION HELPERS
───────────────────────────────────────────── */
function notionHeaders() {
  return {
    'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

function richText(content) {
  const text = (content || '').slice(0, 2000);
  return [{ text: { content: text } }];
}

/* ─────────────────────────────────────────────
   PARSING RESTITUTION
───────────────────────────────────────────── */
function extractSection(text, startPattern, endPattern) {
  const startMatch = text.match(startPattern);
  if (!startMatch) return '';
  const after = text.slice(startMatch.index + startMatch[0].length);
  if (!endPattern) return after.trim();
  const endMatch = after.match(endPattern);
  return endMatch ? after.slice(0, endMatch.index).trim() : after.trim();
}

function parseRestitution(text) {
  return {
    profil: extractSection(
      text,
      /\*\*Ton profil\s*:\*\*\s*/i,
      /\n\n\*\*|\n---/
    ),
    opportunites: extractSection(
      text,
      /\*\*Tes opportunités IA prioritaires\s*:\*\*\s*/i,
      /\n\n\*\*|\n---/
    ),
    outils: extractSection(
      text,
      /\*\*Les outils à tester en priorité\s*:\*\*\s*/i,
      /\n\n\*\*|\n---/
    ),
    quickWin: extractSection(
      text,
      /\*\*Ton quick win[^:]*:\*\*\s*/i,
      /\n---|\n\n\*\*/
    ),
  };
}

/* ─────────────────────────────────────────────
   SAUVEGARDE NOTION
───────────────────────────────────────────── */
async function saveToNotion({ prenom, nom, email, sections, restitution, emailEnvoye }) {
  const body = {
    parent: { database_id: DIAGNOSTIC_DB_ID },
    properties: {
      'Nom complet':        { title:     [{ text: { content: `${prenom} ${nom}`.trim() } }] },
      'Email':              { email:     email.toLowerCase().trim() },
      'Date diagnostic':    { date:      { start: new Date().toISOString().split('T')[0] } },
      'Profil':             { rich_text: richText(sections.profil) },
      'Opportunités IA':    { rich_text: richText(sections.opportunites) },
      'Outils recommandés': { rich_text: richText(sections.outils) },
      'Quick win':          { rich_text: richText(sections.quickWin) },
      'Restitution complète':{ rich_text: richText(restitution) },
      'Email envoyé':       { checkbox:  emailEnvoye === true },
    },
  };

  const response = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: notionHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Notion create error ${response.status}: ${err}`);
  }
  return response.json();
}

async function markEmailSent(pageId) {
  await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: notionHeaders(),
    body: JSON.stringify({
      properties: { 'Email envoyé': { checkbox: true } },
    }),
  });
}

/* ─────────────────────────────────────────────
   NETTOYAGE RESTITUTION
   Supprime le message de clôture de l'IA
   ("Ton diagnostic est terminé 🎉…")
───────────────────────────────────────────── */
function cleanRestitution(text) {
  // Coupe à partir du message de clôture s'il est collé à la restitution
  return text
    .replace(/Ton diagnostic est terminé[\s\S]*/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ─────────────────────────────────────────────
   EMAIL HTML
───────────────────────────────────────────── */
function buildEmailHtml(prenom, restitution) {
  const clean = cleanRestitution(restitution);

  const formatted = clean
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^---$/gm,
      '<hr style="border:none;border-top:1px solid #ECEAE5;margin:24px 0;">')
    .replace(/^(🎯 TON DIAGNOSTIC IA PERSONNALISÉ.*)$/gm,
      '<h2 style="font-size:15px;color:#8037EE;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;margin:24px 0 8px;">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g,
      '<strong style="color:#1A1A1A;font-weight:700;">$1</strong>')
    .replace(/^(\d+)\. (.+)$/gm,
      '<div style="display:table;width:100%;margin-bottom:10px;">' +
        '<span style="display:table-cell;color:#8037EE;font-weight:700;width:24px;vertical-align:top;padding-top:1px;">$1.</span>' +
        '<span style="display:table-cell;color:#333;vertical-align:top;line-height:1.65;">$2</span>' +
      '</div>')
    .replace(/^- (.+)$/gm,
      '<div style="display:table;width:100%;margin-bottom:10px;">' +
        '<span style="display:table-cell;color:#8037EE;font-weight:700;width:18px;vertical-align:top;padding-top:1px;">•</span>' +
        '<span style="display:table-cell;color:#333;vertical-align:top;line-height:1.65;">$1</span>' +
      '</div>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');

  const p = (prenom || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const LOGO_URL = 'https://outils.eneko.ai/assets/favicon-eneko-ai.png';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Ton diagnostic IA — Eneko</title>
</head>
<body style="margin:0;padding:0;background:#F0EEE9;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
  <tr>
    <td align="center" style="padding:32px 16px 48px;">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;">

        <!-- LOGO au-dessus du cadre -->
        <tr>
          <td align="center" style="padding-bottom:20px;">
            <img src="${LOGO_URL}" alt="Eneko" width="40" height="40"
                 style="display:inline-block;border-radius:10px;vertical-align:middle;margin-right:10px;">
            <span style="font-size:20px;font-weight:900;color:#1A1A1A;font-family:Georgia,serif;letter-spacing:-0.5px;vertical-align:middle;">eneko</span>
          </td>
        </tr>

        <!-- HEADER -->
        <tr>
          <td style="background:#1A1A2E;border-radius:16px 16px 0 0;padding:32px 40px 28px;">
            <p style="font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.45);margin:0 0 10px;">Diagnostic IA personnalisé</p>
            <h1 style="font-size:26px;font-weight:700;color:#fff;margin:0;line-height:1.25;font-family:Georgia,serif;">
              ${p}, voici tes<br>opportunités IA&nbsp;🎯
            </h1>
          </td>
        </tr>

        <!-- BODY -->
        <tr>
          <td style="background:#fff;padding:36px 40px 32px;">
            <p style="font-size:14px;color:#888;line-height:1.65;margin:0 0 28px;border-bottom:1px solid #F0EEE9;padding-bottom:24px;">
              Analyse réalisée par le conseiller IA Eneko, basée sur ta situation professionnelle.
            </p>
            <div style="font-size:14px;line-height:1.75;color:#333;">${formatted}</div>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background:#FAFAF8;border-radius:0 0 16px 16px;border-top:1px solid #ECEAE5;padding:20px 40px;text-align:center;">
            <p style="font-size:12px;color:#BBB;margin:0;line-height:1.8;">
              <a href="https://eneko.ai" style="color:#8037EE;text-decoration:none;font-weight:600;">eneko.ai</a>
              &nbsp;·&nbsp;
              <a href="mailto:bonjour@eneko-formation.fr" style="color:#BBB;text-decoration:none;">bonjour@eneko-formation.fr</a>
              <br>Tu reçois cet email suite à ton diagnostic IA sur outils.eneko.ai
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/* ─────────────────────────────────────────────
   ENVOI VIA RESEND (HTTP — pas de SMTP)
───────────────────────────────────────────── */
async function sendEmail({ prenom, email, restitution }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY manquant');

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    process.env.RESEND_FROM || 'Eneko Formation <outils@eneko-formation.fr>',
      to:      [email],
      subject: `${prenom}, voici tes opportunités IA personnalisées 🎯`,
      html:    buildEmailHtml(prenom, restitution),
    }),
  });

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Resend ${r.status}: ${err}`);
  }
}

/* ─────────────────────────────────────────────
   HANDLER
   1) Crée la fiche Notion (Email envoyé: false)
   2) Envoie l'email Gmail
   3) Coche "Email envoyé" si succès
───────────────────────────────────────────── */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prenom, nom, email, restitution } = req.body || {};
  if (!email || !restitution) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const prenomSafe = (prenom || 'Apprenant').trim();
  const nomSafe    = (nom    || '').trim();
  const sections   = parseRestitution(restitution);

  let notionPageId = null;
  let notionSaved  = false;
  let emailSent    = false;

  // 1 — Notion
  try {
    const page  = await saveToNotion({
      prenom: prenomSafe, nom: nomSafe, email,
      sections, restitution, emailEnvoye: false,
    });
    notionPageId = page.id;
    notionSaved  = true;
  } catch (err) {
    console.error('Notion save failed:', err.message);
  }

  // 2 — Gmail
  let emailError = null;
  try {
    await sendEmail({ prenom: prenomSafe, email, restitution });
    emailSent = true;
  } catch (err) {
    emailError = err.message;
    console.error('Email send failed:', err.message);
  }

  // 3 — Coche Email envoyé
  if (emailSent && notionPageId) {
    try {
      await markEmailSent(notionPageId);
    } catch (err) {
      console.error('markEmailSent failed:', err.message);
    }
  }

  return res.status(200).json({ success: true, notionSaved, emailSent, emailError });
}
