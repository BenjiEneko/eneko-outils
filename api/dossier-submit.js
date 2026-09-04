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
//  5) Crée la fiche dans la base Notion « Candidats » RS6776 (ou
//     ajoute le nouveau dossier à la fiche existante du même nom).
//  6) Notifie Slack avec le récap + liens PDF et Notion.
//
//  Le PDF/Blob est le cœur : son échec → 500. Notion et Slack sont
//  fail-soft individuellement, mais si LES DEUX échouent on renvoie
//  500 (personne ne saurait que le dossier existe).
// ════════════════════════════════════════════════════════════════

import { put, get } from '@vercel/blob';
import { guardPost } from './_lib/guard.js';
import { getAuthSecret, verifyPayloadToken } from './_lib/token.js';
import { validateDossier, buildDossierPdf, CERT_RS6776, LINK_PURPOSE } from './_lib/dossier-rs6776.js';

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

const NOTION_VERSION = '2022-06-28';
// Base « Candidats » (sous « CRM & Suivi Apprenants / Certification CPF - Inkrea RS6776 »).
// ⚠️ L'intégration Notion derrière NOTION_TOKEN doit y être connectée.
const CANDIDATS_DB_ID = process.env.NOTION_DB_CANDIDATS_RS6776 || '2fad56ab9c9a802f883dd769748a4ed1';

/* ─── Helpers Notion (mêmes conventions que recrutement-save) ── */

function notionHeaders() {
  return {
    'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}
const txt = (c) => [{ type: 'text', text: { content: (c || '').slice(0, 2000) } }];
const linkTxt = (label, url) => [{ type: 'text', text: { content: label.slice(0, 2000), link: url ? { url } : null } }];
const para = (c) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: txt(c) } });
const h2 = (c) => ({ object: 'block', type: 'heading_2', heading_2: { rich_text: txt(c) } });
const bullet = (c) => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: txt(c) } });
const linkPara = (label, url) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: linkTxt(label, url) } });
const divider = () => ({ object: 'block', type: 'divider', divider: {} });

function dossierBlocks(clean, { pdfUrl, horodatage, ip }) {
  const poste = clean.posteNonConcerne
    ? ['Si en poste : Non concerné(e)']
    : [
        `Poste : ${clean.intitulePoste} — ${clean.nomEntreprise}`,
        `Temps de travail : ${clean.tempsTravail === 'Autre' ? clean.tempsTravailAutre + '%' : clean.tempsTravail} · Contrat : ${clean.typeContrat} · Cadre : ${clean.statutCadre}`,
      ];
  return [
    h2(`Dossier d'inscription ${CERT_RS6776.code} — soumis le ${horodatage}`),
    linkPara('📄 PDF définitif (à transmettre à InKréa)', pdfUrl),
    bullet(`Identité : ${[clean.prenom, clean.prenom2, clean.prenom3].filter(Boolean).join(', ')} ${clean.nomNaissance}${clean.nomUsage ? ` (usage : ${clean.nomUsage})` : ''}`),
    bullet(`Contact : ${clean.email} · ${clean.telephone}`),
    bullet(`Naissance : ${clean.dateNaissance} — ${clean.cpVilleNaissance}, ${clean.paysNaissance}`),
    bullet(`Situation : ${clean.situationPro}`),
    bullet(`Qualification : ${clean.niveauQualif} — depuis le ${clean.niveauDepuis}`),
    bullet(`Dernière certification : ${clean.derniereCertif}`),
    ...poste.map(bullet),
    bullet(`Objectif : ${clean.objectif}${clean.objectifAutre ? ` — ${clean.objectifAutre}` : ''}`),
    para(`Consentement recueilli électroniquement le ${horodatage} (heure de Paris)${ip ? ` — IP ${ip}` : ''}.`),
  ];
}

// Fiche existante du même nom → on ajoute le dossier au lieu de dupliquer.
async function findCandidat(titre) {
  const res = await fetch(`https://api.notion.com/v1/databases/${CANDIDATS_DB_ID}/query`, {
    method: 'POST',
    headers: notionHeaders(),
    body: JSON.stringify({
      page_size: 1,
      filter: { property: 'Nom Candidat', title: { equals: titre } },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Notion query ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).results?.[0] || null;
}

async function saveToNotion(clean, meta) {
  const titre = `${clean.prenom} ${(clean.nomUsage || clean.nomNaissance).toUpperCase()}`.trim();
  const blocks = dossierBlocks(clean, meta);

  const existing = await findCandidat(titre);
  if (existing) {
    const res = await fetch(`https://api.notion.com/v1/blocks/${existing.id}/children`, {
      method: 'PATCH',
      headers: notionHeaders(),
      body: JSON.stringify({ children: [divider(), ...blocks] }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Notion append ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return existing.url || `https://www.notion.so/${existing.id.replace(/-/g, '')}`;
  }

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: notionHeaders(),
    body: JSON.stringify({
      parent: { database_id: CANDIDATS_DB_ID },
      properties: {
        'Nom Candidat': { title: txt(titre) },
        'Certification': { select: { name: 'En attente' } },
      },
      children: blocks,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Notion create ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const page = await res.json();
  return page.url || (page.id ? `https://www.notion.so/${page.id.replace(/-/g, '')}` : null);
}

/* ─── Slack ──────────────────────────────────────────────────── */

async function notifySlack(clean, { pdfUrl, notionUrl, horodatage }) {
  const slackUrl = process.env.SLACK_WEBHOOK_URL;
  if (!slackUrl) throw new Error('SLACK_WEBHOOK_URL non configuré');
  const links = [`<${pdfUrl}|📄 Télécharger le PDF définitif>`];
  if (notionUrl) links.push(`<${notionUrl}|📇 Fiche Candidat Notion>`);
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
    notionUrl = await saveToNotion(clean, { pdfUrl, horodatage, ip });
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

  return res.status(200).json({ ok: true });
}
