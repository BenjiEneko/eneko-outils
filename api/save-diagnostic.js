import nodemailer from 'nodemailer';

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
   EMAIL HTML
───────────────────────────────────────────── */
function buildEmailHtml(prenom, restitution) {
  const formatted = restitution
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(
      /^---$/gm,
      '<hr style="border:none;border-top:1px solid #e8e8e8;margin:20px 0;">'
    )
    .replace(
      /^(🎯 TON DIAGNOSTIC IA PERSONNALISÉ.*)$/gm,
      '<h2 style="font-size:16px;color:#8037EE;font-family:Georgia,serif;margin:20px 0 6px;line-height:1.4;">$1</h2>'
    )
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#1a1a1a;font-weight:700;">$1</strong>')
    .replace(
      /^(\d+)\. (.+)$/gm,
      '<div style="display:table;width:100%;margin-bottom:8px;">' +
        '<span style="display:table-cell;color:#8037EE;font-weight:700;width:22px;vertical-align:top;">$1.</span>' +
        '<span style="display:table-cell;color:#333;vertical-align:top;line-height:1.6;">$2</span>' +
      '</div>'
    )
    .replace(
      /^- (.+)$/gm,
      '<div style="display:table;width:100%;margin-bottom:8px;">' +
        '<span style="display:table-cell;color:#8037EE;font-weight:700;width:16px;vertical-align:top;">•</span>' +
        '<span style="display:table-cell;color:#333;vertical-align:top;line-height:1.6;">$1</span>' +
      '</div>'
    )
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');

  const p = (prenom || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Ton diagnostic IA — Eneko</title>
</head>
<body style="margin:0;padding:0;background:#f3f3f7;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
  <tr>
    <td align="center" style="padding:28px 16px 40px;">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;">

        <!-- HEADER -->
        <tr>
          <td style="background:#0B0C2E;border-radius:12px 12px 0 0;padding:30px 36px;">
            <div style="font-size:26px;font-weight:900;color:#fff;font-family:Georgia,serif;letter-spacing:-0.5px;">eneko</div>
            <div style="font-size:13px;color:rgba(255,255,255,0.55);margin-top:5px;">Ton diagnostic IA personnalisé</div>
          </td>
        </tr>

        <!-- BODY -->
        <tr>
          <td style="background:#fff;padding:36px 36px 28px;">
            <h1 style="font-size:21px;color:#1a1a1a;margin:0 0 10px;font-family:Georgia,serif;line-height:1.35;">
              ${p}, voici tes opportunités IA&nbsp;🎯
            </h1>
            <p style="font-size:14px;color:#777;line-height:1.65;margin:0 0 30px;">
              Analyse personnalisée réalisée par le conseiller IA Eneko,<br>
              basée sur ta situation professionnelle.
            </p>

            <div style="font-size:14px;line-height:1.75;color:#333;">${formatted}</div>

            <div style="text-align:center;margin-top:40px;">
              <a href="https://eneko.ai"
                 style="display:inline-block;background:#8037EE;color:#fff;padding:15px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.3px;">
                Découvrir nos formations →
              </a>
            </div>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background:#F8F7F4;border-radius:0 0 12px 12px;padding:22px 36px;text-align:center;">
            <p style="font-size:12px;color:#aaa;margin:0;line-height:1.7;">
              <a href="https://eneko.ai" style="color:#aaa;text-decoration:none;">eneko.ai</a>
              &nbsp;·&nbsp;
              <a href="mailto:bonjour@eneko-formation.fr" style="color:#aaa;text-decoration:none;">bonjour@eneko-formation.fr</a>
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
   ENVOI VIA GMAIL (nodemailer + App Password)
───────────────────────────────────────────── */
async function sendEmail({ prenom, email, restitution }) {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass) throw new Error('GMAIL_USER ou GMAIL_APP_PASSWORD manquant');

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: gmailUser, pass: gmailPass },
  });

  await transporter.sendMail({
    from:    `"Eneko Formation" <${gmailUser}>`,
    to:      email,
    subject: `${prenom}, voici tes opportunités IA personnalisées 🎯`,
    html:    buildEmailHtml(prenom, restitution),
  });
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
