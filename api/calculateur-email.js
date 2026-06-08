/* ─────────────────────────────────────────────────────────────
   api/calculateur-email.js
   Envoie le récapitulatif du devis chatbot par email à Eneko
   (bonjour@eneko-formation.fr) avec les coordonnées du prospect.

   Transport : Resend (HTTP) — même mécanisme que les autres outils
   du repo (cf. api/save-diagnostic.js). Clé lue côté serveur.

   Le front envoie un récap DÉJÀ formaté (libellés + montants) afin
   de ne pas dupliquer le catalogue de pricing côté serveur : seule
   source de vérité = le front. La fonction se contente de mettre en
   page et d'expédier.
───────────────────────────────────────────────────────────── */

const DESTINATAIRE = 'bonjour@eneko-formation.fr';

// Échappe le HTML pour éviter toute injection dans l'email.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Une ligne « libellé / valeur » du tableau récapitulatif.
function ligne(label, valeur, strong) {
  return `<tr>
    <td style="padding:7px 0;color:#666;font-size:13px;border-bottom:1px solid #F0EEE9;">${esc(label)}</td>
    <td style="padding:7px 0;text-align:right;font-size:13px;border-bottom:1px solid #F0EEE9;${
      strong ? 'font-weight:700;color:#1A1A1A;' : 'color:#333;'
    }">${esc(valeur)}</td>
  </tr>`;
}

// Bloc « liste à puces » (intégrations, canaux, options…).
function blocListe(titre, items) {
  if (!items || !items.length) return '';
  const lis = items
    .map(
      (t) =>
        `<span style="display:inline-block;background:#F5F3FF;color:#5B21B6;font-size:12px;` +
        `padding:4px 10px;border-radius:20px;margin:0 6px 6px 0;">${esc(t)}</span>`
    )
    .join('');
  return `<p style="margin:14px 0 4px;font-size:12px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#999;">${esc(
    titre
  )}</p><div>${lis}</div>`;
}

function buildEmailHtml(payload) {
  const { lead = {}, vue, synthese, recap = {}, pricing = {}, roi = {}, listes = {} } = payload;
  const LOGO_URL = 'https://outils.eneko.ai/assets/logo-eneko.svg';
  const estInterne = vue === 'interne';

  // Tableau pricing — on n'affiche les lignes de marge que pour la vue interne.
  const lignesPricing = [
    pricing.setup != null ? ligne('Setup HT', pricing.setup, true) : '',
    pricing.retainer != null ? ligne('Abonnement HT / mois', pricing.retainer) : '',
    pricing.refacture != null ? ligne('API & hébergement / mois', pricing.refacture) : '',
    pricing.annee1 != null ? ligne('Total année 1', pricing.annee1, true) : '',
    estInterne && pricing.jours != null ? ligne('Charge estimée', pricing.jours) : '',
    estInterne && pricing.coutInterne != null ? ligne('Coût interne setup', pricing.coutInterne) : '',
    estInterne && pricing.marge != null ? ligne('Marge setup', pricing.marge, true) : '',
    estInterne && pricing.margePct != null ? ligne('Marge %', pricing.margePct, true) : '',
  ]
    .filter(Boolean)
    .join('');

  const lignesRoi = [
    roi.etp != null ? ligne('ETP libéré (an)', roi.etp, true) : '',
    roi.heuresMois != null ? ligne('Temps économisé', roi.heuresMois) : '',
    roi.heuresAn != null ? ligne('Sur l’année', roi.heuresAn) : '',
  ]
    .filter(Boolean)
    .join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F0EEE9;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
<td align="center" style="padding:32px 16px 48px;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;">

    <tr><td align="center" style="padding-bottom:20px;">
      <img src="${LOGO_URL}" alt="Eneko" height="30" style="display:block;height:30px;width:auto;">
    </td></tr>

    <!-- HEADER -->
    <tr><td style="background:#0B0C2E;border-radius:16px 16px 0 0;padding:30px 36px 24px;">
      <p style="font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.45);margin:0 0 8px;">
        Nouveau devis chatbot · vue ${esc(vue)}
      </p>
      <h1 style="font-size:23px;font-weight:700;color:#fff;margin:0;line-height:1.3;font-family:Georgia,serif;">
        ${esc(lead.prenom || '')} ${esc(lead.nom || '')}
      </h1>
    </td></tr>

    <!-- CONTACT -->
    <tr><td style="background:#fff;padding:26px 36px 6px;">
      <p style="margin:0 0 14px;font-size:12px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#999;">Coordonnées</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${ligne('Nom & prénom', `${lead.prenom || ''} ${lead.nom || ''}`.trim() || '—')}
        ${ligne('Email', lead.email || '—')}
        ${ligne('Téléphone', lead.telephone || '—')}
      </table>
    </td></tr>

    <!-- SYNTHÈSE -->
    ${
      synthese
        ? `<tr><td style="background:#fff;padding:18px 36px 0;">
            <div style="background:#F5F3FF;border-left:3px solid #8037EE;border-radius:0 8px 8px 0;padding:14px 16px;font-size:13px;color:#444;line-height:1.6;">
              ${esc(synthese)}
            </div>
          </td></tr>`
        : ''
    }

    <!-- CONFIG -->
    <tr><td style="background:#fff;padding:20px 36px 4px;">
      ${ligne ? '' : ''}
      <table width="100%" cellpadding="0" cellspacing="0">
        ${ligne('Usage', recap.usage || '—')}
        ${ligne('Moteur de réponse', recap.moteur || '—')}
        ${ligne('Volume estimé', recap.volume || '—')}
        ${recap.urgence ? ligne('Urgence (< 2 semaines)', 'Oui') : ''}
      </table>
      ${blocListe('Intégrations', listes.integrations)}
      ${blocListe('Canaux', listes.canaux)}
      ${blocListe('Options', listes.options)}
    </td></tr>

    <!-- GAIN DE TEMPS -->
    ${
      lignesRoi
        ? `<tr><td style="background:#fff;padding:20px 36px 4px;">
            <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#999;">Gain de temps estimé</p>
            <table width="100%" cellpadding="0" cellspacing="0">${lignesRoi}</table>
          </td></tr>`
        : ''
    }

    <!-- PRICING -->
    ${
      lignesPricing
        ? `<tr><td style="background:#fff;padding:20px 36px 28px;">
            <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#999;">${
              estInterne ? 'Chiffrage (vue interne)' : 'Proposition'
            }</p>
            <table width="100%" cellpadding="0" cellspacing="0">${lignesPricing}</table>
          </td></tr>`
        : ''
    }

    <!-- FOOTER -->
    <tr><td style="background:#FAFAF8;border-radius:0 0 16px 16px;border-top:1px solid #ECEAE5;padding:18px 36px;text-align:center;">
      <p style="font-size:12px;color:#BBB;margin:0;line-height:1.7;">
        Devis généré depuis le calculateur chatbot · outils.eneko.ai
      </p>
    </td></tr>

  </table>
</td></tr></table>
</body></html>`;
}

async function sendEmail(payload) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY manquant');

  const lead = payload.lead || {};
  const sujet = `Nouveau devis chatbot — ${(lead.prenom || '').trim()} ${(lead.nom || '').trim()}`.trim();

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || 'Eneko Formation <outils@eneko-formation.fr>',
      // Permet de répondre directement au prospect depuis la boîte Eneko.
      reply_to: lead.email ? [lead.email] : undefined,
      to: [DESTINATAIRE],
      subject: sujet || 'Nouveau devis chatbot',
      html: buildEmailHtml(payload),
    }),
  });

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Resend ${r.status}: ${err}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const payload = req.body || {};
  const lead = payload.lead || {};

  // Validation minimale des champs obligatoires du formulaire.
  if (!lead.prenom || !lead.nom || !lead.email || !lead.telephone) {
    return res.status(400).json({ error: 'Nom, prénom, email et téléphone sont obligatoires.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) {
    return res.status(400).json({ error: 'Adresse email invalide.' });
  }

  try {
    await sendEmail(payload);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('calculateur-email error:', err.message);
    return res.status(500).json({ error: 'L’envoi a échoué. Réessaie dans un instant.' });
  }
}
