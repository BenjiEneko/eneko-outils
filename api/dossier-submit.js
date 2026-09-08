// ════════════════════════════════════════════════════════════════
//  /api/dossier-submit  —  Soumission du dossier d'inscription RS6776
//  (page publique /dossier-inscription, accessible via lien signé)
//
//  1) Résout le lien candidat : identifiant court → payload stocké
//     dans Vercel Blob (`dossier-liens/<id>.json`, exp 30 j) ; les
//     anciens liens longs (payload signé HMAC) restent acceptés.
//     Sans lien valide, rien n'est généré : pas de spam PDF.
//     Appelé SANS `fields`, l'endpoint renvoie juste le prefill
//     (chargement du formulaire) ; AVEC `fields`, il soumet.
//  2) Valide et borne TOUS les champs (énumérations comprises) via
//     _lib/dossier-rs6776.js.
//  3) Génère le PDF définitif (mise en page InKréa + encart de
//     traçabilité du consentement : horodatage Paris + IP).
//  4) Stocke le PDF sur Vercel Blob (URL non devinable).
//  5) Met à jour la fiche CONTACTS du CRM Notion (coordonnées, poste,
//     statut pipeline) et y ajoute le détail du dossier.
//  6) Notifie Slack avec le récap + liens PDF et Notion.
//
//  Le PDF/Blob est le cœur : son échec → 500. Notion et Slack sont
//  fail-soft individuellement, mais si LES DEUX échouent on renvoie
//  500 (personne ne saurait que le dossier existe).
// ════════════════════════════════════════════════════════════════

import { put, get } from '@vercel/blob';
import { guardPost } from './_lib/guard.js';
import { getAuthSecret, verifyPayloadToken } from './_lib/token.js';
import { validateDossier, buildDossierPdf, LINK_PURPOSE } from './_lib/dossier-rs6776.js';
import { saveDossierToContact } from './_lib/dossier-contact.js';

/* ─── Résolution du lien candidat ────────────────────────────── */

// Identifiant court (blob) ou ancien token long (payload signé).
// Renvoie le payload {cert, exp, pf, cid} ou null si invalide/expiré.
// Les erreurs d'infrastructure (Blob injoignable) REMONTENT — à
// distinguer d'un lien invalide pour ne pas afficher au candidat
// « lien expiré » quand c'est le service qui tousse.
async function resolveLink(token) {
  if (typeof token !== 'string' || token.length > 4096) return null;

  if (token.includes('.')) {
    // Ancien format : payload embarqué signé HMAC.
    const secret = getAuthSecret();
    if (!secret) return null;
    return verifyPayloadToken(token, secret, LINK_PURPOSE);
  }

  if (!/^[a-z0-9-]{8,80}$/.test(token)) return null;
  // Store Blob privé : lecture serveur authentifiée via le SDK.
  const found = await get(`dossier-liens/${token}.json`, {
    access: 'private',
    abortSignal: AbortSignal.timeout(8_000),
  });
  if (!found || !found.stream) return null;
  const payload = await new Response(found.stream).json().catch(() => null);
  if (!payload || !Number.isFinite(payload.exp) || payload.exp < Date.now()) return null;
  return payload;
}

/* ─── Slack ──────────────────────────────────────────────────── */

async function notifySlack(clean, { pdfUrl, notionUrl, horodatage }) {
  // Canal « administration » (webhook dédié) ; repli sur le webhook des quiz.
  const slackUrl = process.env.SLACK_WEBHOOK_ADMIN || process.env.SLACK_WEBHOOK_URL;
  if (!slackUrl) throw new Error('SLACK_WEBHOOK_ADMIN / SLACK_WEBHOOK_URL non configuré');
  const links = [`<${pdfUrl}|📄 Télécharger le PDF définitif>`];
  if (notionUrl) links.push(`<${notionUrl}|📇 Fiche contact Notion>`);
  const res = await fetch(slackUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: '📋 Dossier d\'inscription RS6776 reçu' } },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Candidat·e*\n${clean.prenom} ${clean.nomUsage || clean.nomNaissance}` },
            { type: 'mrkdwn', text: `*Email*\n${clean.email}` },
            { type: 'mrkdwn', text: `*Téléphone*\n${clean.telephone}` },
            { type: 'mrkdwn', text: `*Situation*\n${clean.situationPro}` },
            { type: 'mrkdwn', text: `*Objectif*\n${clean.objectif}` },
            { type: 'mrkdwn', text: `*Soumis le*\n${horodatage}` },
          ],
        },
        { type: 'section', text: { type: 'mrkdwn', text: links.join('   ·   ') } },
      ],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Slack ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

/* ─── Handler ────────────────────────────────────────────────── */

export default async function handler(req, res) {
  // Chargement du formulaire + soumission passent ici : limite serrée
  // mais qui laisse la place aux deux appels et à quelques retries.
  if (!(await guardPost(req, res, { maxBodyChars: 20_000, limit: 12, windowMs: 60_000 }))) return;

  let payload;
  try {
    payload = await resolveLink(req.body?.token);
  } catch (err) {
    console.error('dossier-submit resolveLink error:', err.message);
    return res.status(500).json({ error: 'Service momentanément indisponible. Réessayez dans un instant.' });
  }
  if (!payload || payload.cert !== 'RS6776') {
    return res.status(403).json({ error: 'Lien invalide ou expiré. Contactez Eneko Formation pour recevoir un nouveau lien.' });
  }

  // Sans `fields` : simple chargement du formulaire → prefill.
  if (!req.body?.fields) {
    return res.status(200).json({ ok: true, prefill: payload.pf || {}, exp: payload.exp });
  }

  const { error, clean } = validateDossier(req.body?.fields);
  if (error) return res.status(400).json({ error });

  const submittedAt = new Date();
  const ip = ((req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim();
  const horodatage = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short',
  }).format(submittedAt);

  /* PDF + Blob : le cœur — tout échec ici est bloquant. */
  let pdfUrl;
  try {
    const pdfBytes = await buildDossierPdf(clean, { submittedAt, ip });
    const slug = `${clean.prenom}-${clean.nomUsage || clean.nomNaissance}`
      .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    // Store privé : le blob n'est pas accessible par URL directe. Les
    // liens Slack/Notion passent par /api/dossier-pdf (nom de fichier
    // aléatoire non devinable), qui streame le PDF côté serveur.
    const blob = await put(
      `dossiers-inscription/rs6776-${slug}.pdf`,
      Buffer.from(pdfBytes),
      { access: 'private', contentType: 'application/pdf', addRandomSuffix: true }
    );
    pdfUrl = `https://outils.eneko.ai/api/dossier-pdf?f=${encodeURIComponent(blob.pathname.replace('dossiers-inscription/', ''))}`;
  } catch (err) {
    console.error('dossier-submit PDF/Blob error:', err.message);
    return res.status(500).json({ error: 'La génération du dossier a échoué. Réessayez dans un instant.' });
  }

  /* Notion + Slack : fail-soft individuellement. */
  let notionUrl = null;
  let notionOk = false;
  try {
    const saved = await saveDossierToContact(clean, { pdfUrl, horodatage, ip, contactId: payload.cid || '' });
    notionUrl = saved.url;
    notionOk = true;
  } catch (err) {
    console.error('dossier-submit Notion error:', err.message);
  }

  let slackOk = false;
  try {
    await notifySlack(clean, { pdfUrl, notionUrl, horodatage });
    slackOk = true;
  } catch (err) {
    console.error('dossier-submit Slack error:', err.message);
  }

  // Si personne n'est prévenu, le dossier serait perdu dans le Blob :
  // on demande au candidat de réessayer.
  if (!notionOk && !slackOk) {
    return res.status(500).json({ error: "L'envoi a échoué. Réessayez dans un instant." });
  }

  // Marque le lien court comme rempli (marqueur à côté du payload) : le
  // moteur de relances ne relancera plus ce candidat. Le lien reste
  // utilisable pour une éventuelle correction.
  const token = req.body?.token;
  if (typeof token === 'string' && !token.includes('.')) {
    try {
      await put(`dossier-liens/${token}.done.json`, JSON.stringify({ at: submittedAt.toISOString() }),
        { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true });
    } catch (err) {
      console.error('dossier-submit done marker:', err.message);
    }
  }

  return res.status(200).json({ ok: true });
}
