/**
 * /api/debug — Diagnostic rapide de la configuration
 * Accès : outils.eneko.ai/api/debug
 * À supprimer une fois tout validé.
 */
const DIAGNOSTIC_DB_ID = '6c806117b38948f8b6de743f449fccdb';

export default async function handler(req, res) {
  const checks = {};

  // 1. Variables d'environnement
  checks.env = {
    ANTHROPIC_API_KEY:  !!process.env.ANTHROPIC_API_KEY,
    NOTION_TOKEN:       !!process.env.NOTION_TOKEN,
    GMAIL_USER:         !!process.env.GMAIL_USER,
    GMAIL_APP_PASSWORD: !!process.env.GMAIL_APP_PASSWORD,
    gmail_user_value:   process.env.GMAIL_USER ? process.env.GMAIL_USER.slice(0, 4) + '…' : null,
  };

  // 2. Accès Notion
  try {
    const r = await fetch(
      `https://api.notion.com/v1/databases/${DIAGNOSTIC_DB_ID}`,
      { headers: { 'Authorization': `Bearer ${process.env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' } }
    );
    checks.notion = { ok: r.ok, status: r.status, detail: r.ok ? 'Accès OK' : (await r.text()).slice(0, 200) };
  } catch (e) {
    checks.notion = { ok: false, detail: e.message };
  }

  // 3. Test connexion SMTP Gmail
  try {
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.default.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });
    await transporter.verify();
    checks.gmail = { ok: true, detail: 'Connexion SMTP OK ✅' };
  } catch (e) {
    checks.gmail = { ok: false, detail: e.message };
  }

  return res.status(200).json(checks);
}
