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
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    NOTION_TOKEN:      !!process.env.NOTION_TOKEN,
    RESEND_API_KEY:    !!process.env.RESEND_API_KEY,
  };

  // 2. Accès Notion
  try {
    const r = await fetch(`https://api.notion.com/v1/databases/${DIAGNOSTIC_DB_ID}`, {
      headers: { 'Authorization': `Bearer ${process.env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' },
    });
    checks.notion = { ok: r.ok, status: r.status, detail: r.ok ? 'Accès OK' : (await r.text()).slice(0, 200) };
  } catch (e) {
    checks.notion = { ok: false, detail: e.message };
  }

  // 3. Test envoi Resend
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from:    'Eneko Formation <bonjour@eneko-formation.fr>',
        to:      ['benjamin@studio-ulk.fr'],
        subject: '[Debug] Test email Resend — Eneko',
        html:    '<p>Test OK ✅ — Resend fonctionne.</p>',
      }),
    });
    const body = await r.text();
    checks.resend = { ok: r.ok, status: r.status, detail: r.ok ? 'Email envoyé ✅' : body.slice(0, 300) };
  } catch (e) {
    checks.resend = { ok: false, detail: e.message };
  }

  return res.status(200).json(checks);
}
