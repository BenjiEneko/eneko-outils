// ════════════════════════════════════════════════════════════════
//  api/_lib/certificat-realisation.js  —  Certificat de réalisation
//  (modèle du ministère du Travail, Cerfa « certificat de réalisation »)
//
//  Généré NATIVEMENT avec pdf-lib — pas de modèle Google Docs : c'est un
//  formulaire réglementaire à mise en page fixe, reproduit au point près
//  depuis le certificat de référence (Certificat_realisation_CORNIC_Claire.pdf,
//  produit par l'ancien outil). Police Helvetica (métriquement identique à
//  TeX Gyre Heros du modèle), A4, images embarquées (certificat-images.js).
//
//  Entrée : les valeurs déjà validées/cappées par /api/cockpit-docs
//  (voir l'entrée 'certificat-realisation' de documents-dossiers.js).
//  Tout texte passe par winAnsi() : jamais d'emoji dans une police standard.
// ════════════════════════════════════════════════════════════════

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { winAnsi } from './pdf-text.js';
import { LOGO_ENEKO_PNG_B64, LOGO_MINISTERE_PNG_B64, CACHET_ENEKO_PNG_B64 } from './certificat-images.js';

const A4 = { w: 595.28, h: 841.89 };
const ML = 62.7;                     // marge gauche (pt)
const MR = 62.7;
const W = A4.w - ML - MR;            // largeur utile ≈ 470 pt
const INK = rgb(0, 0, 0);
const RULE = rgb(0.85, 0.85, 0.85);

export const NATURES = [
  'action de formation',
  'bilan de compétences',
  'action de VAE',
  'action de formation par apprentissage',
];

// 17 → « 17h 00min », 17.5 → « 17h 30min ». Une chaîne déjà rédigée
// (« 17h 00min », « 21 heures ») est conservée telle quelle.
export function formatDuree(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'string' && !/^\s*\d+([.,]\d+)?\s*$/.test(v)) return v.trim();
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return '';
  const h = Math.floor(n);
  const m = Math.round((n - h) * 60);
  return `${h}h ${String(m).padStart(2, '0')}min`;
}

// Décodage base64 → Uint8Array possédant SON ArrayBuffer (pdf-lib lit
// `bytes.buffer` sans tenir compte de l'offset d'un Buffer Node poolé).
function bytesOf(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * @param {object} v
 * @param {string} v.signataire   ex. « Benjamin SEGURA »
 * @param {string} v.organisme    ex. « Eneko »
 * @param {string} v.stagiaire    ex. « CORNIC Claire »
 * @param {string} v.formation    intitulé (sans guillemets)
 * @param {string} v.nature       une des NATURES
 * @param {string} v.dateDebut    « 03/07/2026 »
 * @param {string} v.dateFin      « 07/08/2026 »
 * @param {string} v.duree        « 17h 00min » (ou nombre d'heures)
 * @param {string} v.lieu         « LE TEICH »
 * @param {string} v.dateEmission « 08/08/2026 »
 * @param {string} v.qualite      « Gérant Eneko »
 * @returns {Promise<Uint8Array>}
 */
export async function renderCertificatRealisation(v) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  const images = {};
  for (const [key, b64] of [['eneko', LOGO_ENEKO_PNG_B64], ['ministere', LOGO_MINISTERE_PNG_B64], ['cachet', CACHET_ENEKO_PNG_B64]]) {
    try { images[key] = await doc.embedPng(bytesOf(b64)); }
    catch (err) { console.error(`certificat : image ${key} non embarquée —`, err.message); }
  }

  const t = (s) => winAnsi(s);
  doc.setTitle(`Certificat de réalisation — ${t(v.stagiaire)}`);
  doc.setCreator('outils.eneko.ai');
  doc.setLanguage('fr-FR');

  const page = doc.addPage([A4.w, A4.h]);
  const at = (yTop) => A4.h - yTop;             // y mesuré DEPUIS LE HAUT

  /* ── Primitives ── */

  // Ligne composée de segments { text, font } enchaînés sur une même
  // ligne de base ; renvoie la largeur totale.
  // winAnsi() rogne les espaces de bord : on les mesure ici pour garder
  // l'espacement entre segments (« Mme/M. » + « CORNIC Claire »).
  const runs = (x, yTop, size, segs) => {
    let cx = x;
    for (const s of segs) {
      const raw = String(s.text ?? '');
      const f = s.font || font;
      const space = f.widthOfTextAtSize(' ', size);
      cx += (raw.match(/^\s*/)[0].length) * space;
      const txt = t(raw);
      if (txt) {
        page.drawText(txt, { x: cx, y: at(yTop), size, font: f, color: INK });
        cx += f.widthOfTextAtSize(txt, size) + (raw.match(/\s*$/)[0].length) * space;
      }
    }
    return cx - x;
  };

  const wrap = (text, f, size, maxW) => {
    const lines = [];
    let cur = '';
    for (const word of t(text).split(' ')) {
      const test = cur ? `${cur} ${word}` : word;
      if (f.widthOfTextAtSize(test, size) <= maxW || !cur) cur = test;
      else { lines.push(cur); cur = word; }
    }
    if (cur) lines.push(cur);
    return lines;
  };

  // Paragraphe justifié à gauche ; renvoie la ligne de base suivante.
  const para = (text, yTop, { f = font, size = 11, lh = 16.5, x = ML, maxW = W } = {}) => {
    let y = yTop;
    for (const l of wrap(text, f, size, maxW)) {
      page.drawText(l, { x, y: at(y), size, font: f, color: INK });
      y += lh;
    }
    return y;
  };

  const centered = (text, yTop, cx, { f = font, size = 11 } = {}) => {
    const txt = t(text);
    page.drawText(txt, { x: cx - f.widthOfTextAtSize(txt, size) / 2, y: at(yTop), size, font: f, color: INK });
  };

  const image = (key, x, yTop, w, h) => {
    if (images[key]) page.drawImage(images[key], { x, y: at(yTop + h), width: w, height: h });
  };

  /* ── En-tête : logos ── */
  image('eneko', 62.7, 72.9, 90.3, 31.5);
  image('ministere', 479.9, 68.4, 52.7, 46.5);

  centered('CERTIFICAT DE RÉALISATION', 143.5, A4.w / 2, { f: bold, size: 13 });

  /* ── Corps (11 pt, interligne 16,5 pt ; lignes de base depuis le haut) ── */
  runs(ML, 180, 11, [{ text: 'Je soussigné(e) (prénom et nom)', font: bold }, { text: ` ${v.signataire}` }]);
  runs(ML, 196.5, 11, [
    { text: 'représentant légal du dispensateur de formation', font: bold },
    { text: ` ${v.organisme} ` },
    { text: 'atteste que :', font: bold },
  ]);

  runs(ML, 222.5, 11, [{ text: 'Mme/M.', font: bold }, { text: ` ${v.stagiaire}`, font: italic }]);
  runs(ML, 239, 11, [{ text: "a suivi l’action de formation intitulée :", font: bold }]);
  let y = para(`« ${v.formation} »`, 255.7, { f: italic });

  y += 9.5;                                          // ligne de base 298,2 pour 2 lignes de titre
  runs(ML, y, 11, [{ text: "Nature de l’action de formation :", font: bold }]);

  // Cases à cocher (carré 9,7 pt, trait fin) — la nature choisie est cochée.
  let cy = y + 17.8;                                 // haut de la 1re case (316 dans le modèle)
  for (const nature of NATURES) {
    page.drawRectangle({ x: ML, y: at(cy + 9.7), width: 9.7, height: 9.7, borderColor: INK, borderWidth: 0.8 });
    if (nature === v.nature) {
      page.drawLine({ start: { x: ML + 2.2, y: at(cy + 5.6) }, end: { x: ML + 4.2, y: at(cy + 7.8) }, thickness: 1.1, color: INK });
      page.drawLine({ start: { x: ML + 4.2, y: at(cy + 7.8) }, end: { x: ML + 7.9, y: at(cy + 2.2) }, thickness: 1.1, color: INK });
    }
    page.drawText(t(nature), { x: ML + 17.5, y: at(cy + 7.7), size: 11, font, color: INK });
    cy += 18;
  }

  y = cy - 18 + 36.2;                                // ligne de base 406,2 dans le modèle
  runs(ML, y, 11, [
    { text: "qui s’est déroulée du " },
    { text: `${v.dateDebut} au ${v.dateFin}`, font: italic },
    { text: ` pour une durée totale de ${v.duree}.` },
  ]);

  y = para(
    "Sans préjudice des délais imposés par les règles fiscales, comptables ou commerciales, je " +
    "m’engage à conserver l’ensemble des pièces justificatives qui ont permis d’établir le présent " +
    "certificat pendant une durée de 3 ans à compter de la fin de l’année du dernier paiement. En cas " +
    "de cofinancement des fonds européens la durée de conservation est étendue conformément " +
    "aux obligations conventionnelles spécifiques.",
    y + 25.7,
  );

  /* ── Bloc signature (positions fixes du modèle) ── */
  const CX = 422.4;                                  // axe du bloc « Cachet et signature »
  centered('Cachet et signature', 538.5, CX, { f: bold });
  centered('du responsable du dispensateur de formation', 556.5, CX);
  centered(v.signataire, 574.5, CX);
  centered(v.qualite, 592.5, CX);
  image('cachet', 336.1, 602.7, 172.7, 71.3);

  runs(ML, 581.8, 11, [{ text: `Fait à: ${v.lieu}` }]);
  runs(ML, 598.3, 11, [{ text: `Le: ${v.dateEmission}` }]);

  /* ── Pied de page ── */
  para(
    'Dans le cadre des formations à distance prendre en compte la réalisation des activités pédagogiques et le ' +
    'temps estimé pour les réaliser.',
    726.3, { size: 10, lh: 15 },
  );
  page.drawLine({ start: { x: ML, y: at(755) }, end: { x: A4.w - MR, y: at(755) }, thickness: 0.6, color: RULE });
  centered(
    'M&BOCA (Eneko) - 80Q rue des Poissonniers 33470 Le Teich - SIRET 82772968200043 - NDA 75400178140',
    774.3, A4.w / 2, { size: 8.5 },
  );

  return doc.save();
}
