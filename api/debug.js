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
    RESEND_API_KEY:     !!process.env.RESEND_API_KEY,
  };

  // 2. Accès Notion à la base diagnostic
  try {
    const r = await fetch(
      `https://api.notion.com/v1/databases/${DIAGNOSTIC_DB_ID}`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
          'Notion-Version': '2022-06-28',
        },
      }
    );
    const body = await r.text();
    checks.notion = {
      status: r.status,
      ok: r.ok,
      detail: r.ok ? 'Accès OK' : body.slice(0, 200),
    };
  } catch (e) {
    checks.notion = { ok: false, detail: e.message };
  }

  // 3. Test Resend (envoi d'un email de test vers benjamin@studio-ulk.fr)
  if (req.method === 'POST') {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from:    'Eneko Formation <bonjour@eneko-formation.fr>',
          to:      ['benjamin@studio-ulk.fr'],
          subject: '[Debug] Test email Resend — Eneko',
          html:    '<p>Test OK ✅ — Resend fonctionne.</p>',
        }),
      });
      const body = await r.text();
      checks.resend_test = { ok: r.ok, status: r.status, detail: body.slice(0, 200) };
    } catch (e) {
      checks.resend_test = { ok: false, detail: e.message };
    }
  } else {
    checks.resend_test = 'Envoie une requête POST sur /api/debug pour tester l\'envoi réel';
  }

  return res.status(200).json(checks);
}
