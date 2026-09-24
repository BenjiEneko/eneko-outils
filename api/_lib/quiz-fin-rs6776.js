// ════════════════════════════════════════════════════════════════
//  api/_lib/quiz-fin-rs6776.js  —  Quiz de fin de formation RS6776
//  (remplace le questionnaire Edusign « Quiz de fin de formation - RS6776 »)
//
//  UNE source de vérité : les questions, leurs options ET le corrigé
//  vivent ici. La page publique ne reçoit que les questions (sans le
//  corrigé) via /api/quiz-fin-submit ; la notation est faite serveur.
//
//  Lien apprenant : généré depuis le cockpit (registre des documents,
//  kind 'lien'), même mécanique que le dossier InKréa — payload dans le
//  Blob privé `quiz-fin-liens/<id>.json`, identifiant dans le fragment #.
//  Une seule soumission par lien (marqueur `<id>.done.json`).
// ════════════════════════════════════════════════════════════════

import crypto from 'node:crypto';
import { put, get } from '@vercel/blob';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { winAnsi } from './pdf-text.js';
import { LOGO_ENEKO_PNG_B64 } from './certificat-images.js';

export const QUIZ_ID = 'quiz-fin-rs6776';
export const QUIZ_TITRE = 'Quiz de fin de formation — RS6776';
export const QUIZ_NOTION = 'RS6776 — IA générative'; // option « Quiz » de la base Notion
export const FORM_URL = 'https://outils.eneko.ai/quiz-fin-formation/';
export const LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const DB_QUIZ_FIN = process.env.NOTION_DB_QUIZ_FIN || '5b418b02ac10436ea394ad98a1e9215f';

// `bonne` = index de la bonne réponse (jamais envoyé au navigateur).
// Libellés repris à l'identique du questionnaire Edusign.
export const QUESTIONS = [
  { q: "Quel est l'objectif principal de la formation RS6776 ?", bonne: 0, options: [
    'Créer des contenus textuels et visuels avec IA de manière responsable',
    'Automatiser entièrement son métier avec IA',
    'Utiliser uniquement Adobe Firefly pour produire du contenu',
    'Apprendre à coder des modèles IA'] },
  { q: 'La méthode ROOCF sert principalement à :', bonne: 0, options: [
    'Structurer un prompt efficace', 'Créer un assistant IA', 'Analyser des documents internes', 'Configurer un LLM'] },
  { q: 'Quel outil est recommandé pour analyser des documents internes sans fuite de données ?', bonne: 1, options: [
    'Adobe Firefly', 'NotebookLM', 'NanoBanana', 'ChatGPT'] },
  { q: "Quel est l'objectif du RAG dans la formation ?", bonne: 3, options: [
    'Créer des images réalistes', 'Automatiser les workflows', 'Créer des assistants IA', 'Enrichir les prompts avec du contexte'] },
  { q: "Quel outil est utilisé pour la génération d'images ?", bonne: 1, options: [
    'Claude', 'NanoBanana', 'ChatGPT'] },
  { q: 'Quel outil est utilisé pour la veille réglementaire ?', bonne: 0, options: [
    'Perplexity', 'ChatGPT', 'NanoBanana'] },
  { q: 'Quel est le rôle du calendrier éditorial ?', bonne: 1, options: [
    'Analyser des documents', 'Planifier les contenus', 'Créer des prompts', 'Configurer un LLM'] },
  { q: "Quel élément améliore le plus la pertinence d'un contenu généré par IA ?", bonne: 2, options: [
    'La longueur du prompt', "Le choix d'un ton neutre", "L'ajout de contexte", "L'utilisation d'un seul outil"] },
  { q: "Quel est le principal risque lié à l'usage non maîtrisé de l'IA générative ?", bonne: 3, options: [
    'La lenteur de génération', 'La création de contenus trop longs', 'La perte de créativité', 'La fuite de données sensibles'] },
  { q: "Quel type de données doit être systématiquement retiré d'un prompt avant envoi ?", bonne: 2, options: [
    'Les dates approximatives', 'Les informations publiques', 'Les données personnelles ou confidentielles'] },
  { q: "Quel est l'objectif d'un assistant IA personnalisé ?", bonne: 0, options: [
    'Automatiser des tâches récurrentes avec un cadre stable', 'Gérer la sécurité des données', "Remplacer totalement l'utilisateur"] },
  { q: 'Quel élément est essentiel pour produire un contenu inclusif ?', bonne: 2, options: [
    'La longueur du texte', "La présence d'images", "L'accessibilité du texte"] },
  { q: "Quel est l'objectif d'une veille réglementaire IA ?", bonne: 1, options: [
    'Créer des contenus plus rapidement', 'Rester conforme aux évolutions légales', 'Automatiser la production', 'Améliorer la créativité'] },
];

// Ce que voit le navigateur : questions + options, sans corrigé.
export const publicQuestions = () => QUESTIONS.map(({ q, options }) => ({ q, options }));

/* ─── Lien apprenant ─────────────────────────────────────────── */

const PREFILL_CAPS = { prenom: 80, nom: 80, email: 200 };
const slugify = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ctx : { dossier: {id, reference, session}, stagiaire: {id} }
export async function createQuizLink(prefill = {}, ctx = {}) {
  const pf = {};
  for (const [key, max] of Object.entries(PREFILL_CAPS)) {
    pf[key] = typeof prefill[key] === 'string' ? prefill[key].trim().slice(0, max) : '';
  }
  const exp = Date.now() + LINK_TTL_MS;
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const rand = Array.from(crypto.randomBytes(10), b => alphabet[b % alphabet.length]).join('');
  const linkId = `${slugify(`${pf.prenom}-${pf.nom}`).slice(0, 40) || 'apprenant'}-${rand}`;
  await put(
    `quiz-fin-liens/${linkId}.json`,
    JSON.stringify({
      v: 1, quiz: QUIZ_ID, exp, pf,
      cid: ctx.stagiaire?.id || '',
      did: ctx.dossier?.id || '',
      ref: ctx.dossier?.reference || '',
      session: ctx.dossier?.session || '',
    }),
    { access: 'private', contentType: 'application/json', addRandomSuffix: false }
  );
  return { url: `${FORM_URL}#${linkId}`, exp, pf };
}

// get() renvoie null sur 404 et lève sur toute autre erreur.
async function readJson(path, { fresh = false } = {}) {
  const found = await get(path, {
    access: 'private', abortSignal: AbortSignal.timeout(8_000), ...(fresh ? { useCache: false } : {}),
  });
  if (!found || !found.stream) return null;
  return new Response(found.stream).json().catch(() => null);
}

// Payload du lien (ou null si invalide / expiré). Les erreurs Blob REMONTENT :
// « service indisponible » ≠ « lien expiré ».
export async function resolveQuizLink(linkId) {
  if (typeof linkId !== 'string' || !/^[a-z0-9-]{8,80}$/.test(linkId)) return null;
  const payload = await readJson(`quiz-fin-liens/${linkId}.json`);
  if (!payload || payload.quiz !== QUIZ_ID) return null;
  if (!Number.isFinite(payload.exp) || payload.exp < Date.now()) return null;
  return payload;
}

// Marqueur « déjà rempli » (une soumission par lien).
export async function quizDone(linkId) {
  return readJson(`quiz-fin-liens/${linkId}.done.json`, { fresh: true });
}
export async function markQuizDone(linkId, info) {
  await put(`quiz-fin-liens/${linkId}.done.json`, JSON.stringify(info),
    { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true });
}

/* ─── Validation + notation ──────────────────────────────────── */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

// input : { prenom, nom, email, reponses: [index…] }
export function validateQuiz(input) {
  const s = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const clean = { prenom: s(input?.prenom, 80), nom: s(input?.nom, 80), email: s(input?.email, 200).toLowerCase() };
  if (!clean.prenom || !clean.nom) return { error: 'Prénom et nom sont obligatoires.' };
  if (!EMAIL_RE.test(clean.email)) return { error: 'Adresse email invalide.' };
  const rep = Array.isArray(input?.reponses) ? input.reponses : [];
  if (rep.length !== QUESTIONS.length) return { error: 'Merci de répondre à toutes les questions.' };
  const reponses = [];
  for (let i = 0; i < QUESTIONS.length; i++) {
    const r = rep[i];
    if (!Number.isInteger(r) || r < 0 || r >= QUESTIONS[i].options.length) {
      return { error: `Merci de répondre à la question ${i + 1}.` };
    }
    reponses.push(r);
  }
  const detail = QUESTIONS.map((qq, i) => ({
    n: i + 1, question: qq.q, reponse: qq.options[reponses[i]], bonneReponse: qq.options[qq.bonne], correct: reponses[i] === qq.bonne,
  }));
  const score = detail.filter(d => d.correct).length;
  clean.reponses = reponses;
  return { clean, detail, score, total: QUESTIONS.length, pct: Math.round((score / QUESTIONS.length) * 100) };
}

/* ─── PDF horodaté des réponses (pdf-lib, polices standard) ───── */

const C = {
  ink: rgb(0.043, 0.047, 0.18), mid: rgb(0.27, 0.27, 0.34), soft: rgb(0.43, 0.44, 0.53),
  line: rgb(0.894, 0.894, 0.937), violet: rgb(0.463, 0.263, 0.898), lavande: rgb(0.937, 0.941, 0.976),
  ok: rgb(0.118, 0.482, 0.271), okBg: rgb(0.906, 0.961, 0.925), ko: rgb(0.753, 0.224, 0.169), koBg: rgb(0.988, 0.925, 0.918),
};

// r : { clean, detail, score, total, pct } ; meta : { submittedAt, ip, userAgent, reference, session, linkId }
export async function buildQuizPdf(r, meta = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let logo = null;
  try {
    // Uint8Array propre (pdf-lib ignore l'offset des Buffer Node poolés).
    const bin = atob(LOGO_ENEKO_PNG_B64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    logo = await doc.embedPng(bytes);
  } catch (err) {
    console.error('quiz-fin PDF : logo non embarqué —', err.message);
  }
  const nomComplet = `${r.clean.prenom} ${r.clean.nom.toUpperCase()}`;
  doc.setTitle(`${QUIZ_TITRE} — ${nomComplet}`);
  doc.setAuthor('Eneko Formation');
  doc.setCreator('outils.eneko.ai');

  const W = 595.28, H = 841.89, M = 50, CW = W - 2 * M;
  let page, y;
  const txt = (t, x, yy, { f = font, size = 10, color = C.ink } = {}) =>
    page.drawText(winAnsi(t), { x, y: yy, size, font: f, color });
  const wrap = (t, f, size, maxW) => {
    const out = []; let cur = '';
    for (const w of winAnsi(t).split(/\s+/).filter(Boolean)) {
      const a = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(a, size) <= maxW) cur = a; else { if (cur) out.push(cur); cur = w; }
    }
    if (cur) out.push(cur);
    return out.length ? out : [''];
  };
  const horo = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', dateStyle: 'full', timeStyle: 'medium',
  }).format(meta.submittedAt || new Date());

  const newPage = () => {
    page = doc.addPage([W, H]);
    y = H - M;
    page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: C.violet });
    // Pied de page : horodatage répété sur chaque page.
    txt(`Eneko Formation — ${QUIZ_TITRE} — ${nomComplet} — soumis le ${horo} (heure de Paris)`, M, 28, { size: 7.5, color: C.soft });
  };
  const ensure = (h) => { if (y - h < 60) newPage(); };

  newPage();
  if (logo) {
    const h = 26, w = (logo.width / logo.height) * h;
    page.drawImage(logo, { x: M, y: y - h, width: w, height: h });
  }
  txt('QUESTIONNAIRE DE FIN DE FORMATION', W - M - bold.widthOfTextAtSize('QUESTIONNAIRE DE FIN DE FORMATION', 8), y - 10, { f: bold, size: 8, color: C.soft });
  y -= 60;
  txt(QUIZ_TITRE, M, y, { f: bold, size: 19 });
  y -= 18;
  txt("Création de contenus rédactionnels et visuels par l'usage responsable de l'IA générative", M, y, { size: 9.5, color: C.mid });
  y -= 26;

  // Encart identité + score
  const boxH = 92;
  page.drawRectangle({ x: M, y: y - boxH, width: CW, height: boxH, color: C.lavande });
  const lignes = [
    ['Apprenant·e', nomComplet],
    ['Email', r.clean.email],
    ['Dossier', [meta.reference, meta.session].filter(Boolean).join(' · ') || '—'],
    ['Soumis le', `${horo} (heure de Paris)`],
  ];
  let ly = y - 20;
  for (const [k, v] of lignes) {
    txt(k, M + 14, ly, { f: bold, size: 9, color: C.mid });
    txt(v, M + 90, ly, { size: 9.5 });
    ly -= 18;
  }
  const scoreTxt = `${r.score}/${r.total}`;
  txt(scoreTxt, W - M - 14 - bold.widthOfTextAtSize(scoreTxt, 26), y - 44, { f: bold, size: 26, color: C.violet });
  const pctTxt = `${r.pct} % de bonnes réponses`;
  txt(pctTxt, W - M - 14 - font.widthOfTextAtSize(winAnsi(pctTxt), 8.5), y - 60, { size: 8.5, color: C.mid });
  y -= boxH + 24;

  // Questions
  for (const d of r.detail) {
    const qLines = wrap(`${d.n}. ${d.question}`, bold, 10.5, CW);
    const aLines = wrap(`Réponse : ${d.reponse}`, font, 10, CW - 90);
    const cLines = d.correct ? [] : wrap(`Réponse attendue : ${d.bonneReponse}`, font, 9, CW - 20);
    const h = qLines.length * 14 + aLines.length * 13 + 16 + (cLines.length ? cLines.length * 12 + 4 : 0) + 14;
    ensure(h);
    for (const l of qLines) { txt(l, M, y, { f: bold, size: 10.5 }); y -= 14; }
    y -= 2;
    const blocH = aLines.length * 13 + 10 + (cLines.length ? cLines.length * 12 + 4 : 0);
    page.drawRectangle({ x: M, y: y - blocH + 10, width: CW, height: blocH, color: d.correct ? C.okBg : C.koBg });
    let ay = y - 2;
    for (const l of aLines) { txt(l, M + 10, ay, { size: 10 }); ay -= 13; }
    const badge = d.correct ? 'CORRECT' : 'INCORRECT';
    txt(badge, W - M - 10 - bold.widthOfTextAtSize(badge, 8), y - 2, { f: bold, size: 8, color: d.correct ? C.ok : C.ko });
    if (cLines.length) { ay -= 2; for (const l of cLines) { txt(l, M + 10, ay, { size: 9, color: C.mid }); ay -= 12; } }
    y -= blocH + 14;
  }

  // Traçabilité
  const trace = [
    'Traçabilité',
    `Questionnaire rempli en ligne via un lien nominatif unique (${meta.linkId || '—'}) envoyé par Eneko Formation.`,
    `Horodatage serveur : ${(meta.submittedAt || new Date()).toISOString()} (UTC) · Adresse IP : ${meta.ip || 'non disponible'}`,
    meta.userAgent ? `Navigateur : ${meta.userAgent.slice(0, 160)}` : '',
  ].filter(Boolean);
  const tLines = trace.slice(1).flatMap(t => wrap(t, font, 8, CW - 20));
  ensure(tLines.length * 11 + 34);
  page.drawLine({ start: { x: M, y: y + 4 }, end: { x: W - M, y: y + 4 }, thickness: 0.6, color: C.line });
  y -= 10;
  txt(trace[0], M, y, { f: bold, size: 8.5, color: C.mid }); y -= 13;
  for (const l of tLines) { txt(l, M, y, { size: 8, color: C.soft }); y -= 11; }

  return doc.save();
}
