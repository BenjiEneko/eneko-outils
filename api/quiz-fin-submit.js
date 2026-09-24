// ════════════════════════════════════════════════════════════════
//  /api/quiz-fin-submit  —  Quiz de fin de formation RS6776
//  (page publique /quiz-fin-formation, lien nominatif généré au cockpit)
//
//  Appelé SANS `reponses` : résout le lien et renvoie le prefill + les
//  questions (sans corrigé) + l'état « déjà rempli ».
//  Appelé AVEC `reponses` :
//   1) valide et note côté serveur (_lib/quiz-fin-rs6776.js) ;
//   2) génère le PDF horodaté des réponses (cœur : échec → 500) et le
//      stocke dans le Blob privé (servi par /api/dossier-pdf?d=quizfin) ;
//   3) dépose le PDF dans le dossier Drive de l'apprenant (« Lien Drive
//      dossier » du DOSSIER), repli sur le Drive partagé du cockpit ;
//   4) écrit une ligne dans la base Notion « Qui fin de formation IAG » (reliée
//      au contact et au dossier) + trace sur la fiche du dossier ;
//   5) notifie Slack (#administration).
//  Drive, Notion, Slack sont fail-soft ; si Notion ET Slack échouent on
//  renvoie 500 (personne ne saurait que le quiz a été rempli).
//  Une seule soumission par lien (marqueur Blob `<id>.done.json`).
// ════════════════════════════════════════════════════════════════

import crypto from 'node:crypto';
import { put } from '@vercel/blob';
import { guardPost } from './_lib/guard.js';
import { notion } from './_lib/notion-crm.js';
import { googleConfigured, uploadPdf, folderIdFromUrl } from './_lib/google.js';
import {
  QUIZ_TITRE, QUIZ_NOTION, DB_QUIZ_FIN, publicQuestions, resolveQuizLink, quizDone, markQuizDone,
  validateQuiz, buildQuizPdf,
} from './_lib/quiz-fin-rs6776.js';

const idOk = (x) => /^[0-9a-f-]{32,36}$/i.test(String(x || ''));
// Notion : 2 000 caractères max par segment de texte.
const chunks = (s) => (String(s).match(/[\s\S]{1,1900}/g) || ['']).map(content => ({ type: 'text', text: { content } }));

/* ─── Notion ─────────────────────────────────────────────────── */

async function saveToNotion(r, { payload, submittedAt, pdfUrl, driveUrl, sha256, linkId, horodatage }) {
  const nomComplet = `${r.clean.nom.toUpperCase()} ${r.clean.prenom}`;
  const reponses = r.detail.map(d => `${d.n}. ${d.correct ? '✅' : '❌'} ${d.reponse}${d.correct ? '' : ` (attendu : ${d.bonneReponse})`}`).join('\n');
  const page = await notion('pages', {
    method: 'POST',
    body: {
      parent: { database_id: DB_QUIZ_FIN },
      properties: {
        'Nom Prénom': { title: [{ text: { content: nomComplet } }] },
        'Email': { email: r.clean.email },
        ...(idOk(payload.cid) ? { 'Stagiaire': { relation: [{ id: payload.cid }] } } : {}),
        ...(idOk(payload.did) ? { 'Dossier': { relation: [{ id: payload.did }] } } : {}),
        'Quiz': { select: { name: QUIZ_NOTION } },
        'Score': { number: r.score },
        'Total': { number: r.total },
        'Réussite (%)': { number: r.pct },
        'Date': { date: { start: submittedAt.toISOString() } },
        'Réponses': { rich_text: chunks(reponses) },
        'PDF': { url: pdfUrl },
        ...(driveUrl ? { 'Drive': { url: driveUrl } } : {}),
        'Source': { select: { name: 'Eneko' } },
        'ID lien': { rich_text: [{ text: { content: linkId } }] },
      },
      children: [{
        object: 'block', type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: `Soumis le ${horodatage} · empreinte SHA-256 du PDF : ${sha256}` } }] },
      }],
    },
  });

  // Trace sur la fiche du dossier (fail-soft : la ligne de la base fait foi).
  if (idOk(payload.did)) {
    const run = (content, url) => ({ type: 'text', text: { content, ...(url ? { link: { url } } : {}) } });
    const rich = [run(`🎯 ${QUIZ_TITRE} — ${r.clean.prenom} ${r.clean.nom} : ${r.score}/${r.total} (${r.pct} %) — soumis le ${horodatage} · `), run('PDF', pdfUrl)];
    if (driveUrl) rich.push(run(' · '), run('Drive', driveUrl));
    try {
      await notion(`blocks/${payload.did}/children`, {
        method: 'PATCH',
        body: { children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: rich } }] },
      });
    } catch (err) {
      console.error('quiz-fin trace dossier:', err.message);
    }
  }
  return page.url;
}

/* ─── Slack ──────────────────────────────────────────────────── */

async function notifySlack(r, { payload, pdfUrl, driveUrl, driveFallback, notionUrl, horodatage }) {
  const slackUrl = process.env.SLACK_WEBHOOK_ADMIN || process.env.SLACK_WEBHOOK_URL;
  if (!slackUrl) throw new Error('SLACK_WEBHOOK_ADMIN / SLACK_WEBHOOK_URL non configuré');
  const links = [`<${pdfUrl}|📄 PDF des réponses>`];
  if (driveUrl) links.push(`<${driveUrl}|📁 Drive${driveFallback ? ' (Drive partagé du cockpit — dossier apprenant inaccessible)' : ''}>`);
  if (notionUrl) links.push(`<${notionUrl}|📇 Résultat Notion>`);
  const res = await fetch(slackUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: '🎯 Quiz de fin de formation RS6776 complété' } },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Apprenant·e*\n${r.clean.prenom} ${r.clean.nom}` },
            { type: 'mrkdwn', text: `*Score*\n${r.score}/${r.total} (${r.pct} %)` },
            { type: 'mrkdwn', text: `*Dossier*\n${[payload.ref, payload.session].filter(Boolean).join(' · ') || '—'}` },
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
  if (!(await guardPost(req, res, { maxBodyChars: 8_000, limit: 12, windowMs: 60_000 }))) return;

  const linkId = typeof req.body?.token === 'string' ? req.body.token : '';
  let payload, done;
  try {
    payload = await resolveQuizLink(linkId);
    done = payload ? await quizDone(linkId) : null;
  } catch (err) {
    console.error('quiz-fin resolve error:', err.message);
    return res.status(500).json({ error: 'Service momentanément indisponible. Réessayez dans un instant.' });
  }
  if (!payload) {
    return res.status(403).json({ error: 'Lien invalide ou expiré. Contactez Eneko Formation pour recevoir un nouveau lien.' });
  }

  // Chargement de la page.
  if (!req.body?.reponses) {
    return res.status(200).json({
      ok: true, prefill: payload.pf || {}, questions: publicQuestions(),
      done: !!done, doneAt: done?.at || null,
    });
  }
  if (done) return res.status(409).json({ error: 'Ce questionnaire a déjà été complété. Merci !' });

  const r = validateQuiz(req.body);
  if (r.error) return res.status(400).json({ error: r.error });

  const submittedAt = new Date();
  const ip = ((req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim();
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 300);
  const horodatage = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short',
  }).format(submittedAt);

  /* PDF + Blob : le cœur. */
  let pdfBytes, pdfUrl, sha256, fileName;
  try {
    pdfBytes = await buildQuizPdf(r, { submittedAt, ip, userAgent, reference: payload.ref, session: payload.session, linkId });
    sha256 = crypto.createHash('sha256').update(pdfBytes).digest('hex');
    fileName = `QUIZ_FIN_RS6776 — ${r.clean.nom.toUpperCase()} ${r.clean.prenom} — ${submittedAt.toISOString().slice(0, 10)}.pdf`;
    const slug = `${r.clean.prenom}-${r.clean.nom}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    const blob = await put(`quiz-fin-pdf/quiz-fin-rs6776-${slug}.pdf`, Buffer.from(pdfBytes),
      { access: 'private', contentType: 'application/pdf', addRandomSuffix: true });
    pdfUrl = `https://outils.eneko.ai/api/dossier-pdf?d=quizfin&f=${encodeURIComponent(blob.pathname.replace('quiz-fin-pdf/', ''))}`;
  } catch (err) {
    console.error('quiz-fin PDF/Blob error:', err.message);
    return res.status(500).json({ error: "L'enregistrement de vos réponses a échoué. Réessayez dans un instant." });
  }

  /* Drive : dossier de l'apprenant (« Lien Drive dossier »), sinon Drive partagé. */
  let driveUrl = null, driveFallback = false;
  if (googleConfigured()) {
    try {
      let folderId = '';
      if (idOk(payload.did)) {
        try {
          const pg = await notion(`pages/${payload.did}`);
          folderId = folderIdFromUrl(pg.properties?.['Lien Drive dossier']?.url);
        } catch (err) { console.error('quiz-fin lecture dossier:', err.message); }
      }
      const up = await uploadPdf(fileName, pdfBytes, folderId);
      driveUrl = up.link; driveFallback = up.fallback;
    } catch (err) {
      console.error('quiz-fin Drive error:', err.message);
    }
  }

  let notionUrl = null, notionOk = false;
  try {
    notionUrl = await saveToNotion(r, { payload, submittedAt, pdfUrl, driveUrl, sha256, linkId, horodatage });
    notionOk = true;
  } catch (err) {
    console.error('quiz-fin Notion error:', err.message);
  }

  let slackOk = false;
  try {
    await notifySlack(r, { payload, pdfUrl, driveUrl, driveFallback, notionUrl, horodatage });
    slackOk = true;
  } catch (err) {
    console.error('quiz-fin Slack error:', err.message);
  }

  if (!notionOk && !slackOk) {
    return res.status(500).json({ error: "L'envoi a échoué. Réessayez dans un instant." });
  }

  try {
    await markQuizDone(linkId, { at: submittedAt.toISOString(), score: r.score, total: r.total });
  } catch (err) {
    console.error('quiz-fin done marker:', err.message);
  }

  return res.status(200).json({ ok: true, score: r.score, total: r.total });
}
