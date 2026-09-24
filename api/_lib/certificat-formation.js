// ════════════════════════════════════════════════════════════════
//  api/_lib/certificat-formation.js  —  Certificat de formation Eneko
//  (version « à partager » : LinkedIn, réseaux sociaux)
//
//  Distinct du certificat de RÉALISATION (formulaire réglementaire, voir
//  certificat-realisation.js) : ici un visuel de marque, pensé pour être
//  publié. UN modèle SVG (charte eneko.ai : nuit #0B0C2E, violet #7643E5,
//  bleu #3843D0, rose #E580E7 ; Playfair Display italique + Outfit),
//  rendu par resvg en trois sorties :
//   • png   — A4 paysage 2480 px (≈ 210 dpi) : image à poster / imprimer
//   • og    — 1200×627 : aperçu du lien partagé (LinkedIn, WhatsApp…)
//   • pdf   — A4 paysage, le PNG en pleine page (pdf-lib)
//
//  Les polices sont des TTF statiques (Google Fonts, licence OFL) dans
//  certificat-assets/ : resvg n'a AUCUNE police système en serverless.
//  Le SVG n'a pas de retour à la ligne : les textes sont mesurés avec
//  certificat-metrics.js (généré depuis ces mêmes TTF).
// ════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import QRCode from 'qrcode';
import { PDFDocument } from 'pdf-lib';
import { textWidth, wrapText } from './certificat-metrics.js';

const asset = (name) => new URL(`./certificat-assets/${name}`, import.meta.url);
const FONT_FILES = [
  'Outfit-Regular.ttf', 'Outfit-Medium.ttf', 'Outfit-SemiBold.ttf', 'Outfit-Bold.ttf',
  'PlayfairDisplay-SemiBoldItalic.ttf', 'PlayfairDisplay-BoldItalic.ttf',
].map(f => fileURLToPath(asset(f)));

const C = {
  nuit: '#0B0C2E', nuit2: '#1A1553', violet: '#7643E5', bleu: '#3843D0',
  rose: '#E580E7', mauve: '#A259FF', inkMid: '#444457', inkSoft: '#6E7086',
  ligne: '#E4E4EF', lavande: '#EFF0F9',
};

const W = 1684;   // A4 paysage, 2 unités par point
const H = 1191;

/* ─── Utilitaires texte ──────────────────────────────────────── */

// Retire ce qu'aucune police du certificat ne sait dessiner (emoji des
// selects Notion, sélecteurs de variante…), puis échappe pour le XML.
export function propre(s) {
  return String(s ?? '')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
const xml = (s) => propre(s).replace(/'/g, '’')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// « SEGURA » → « Segura » (mots tout en capitales seulement).
export const casseNom = (s) => propre(s).split(' ')
  .map(w => (w.length > 1 && w === w.toUpperCase() && /\p{L}/u.test(w))
    ? w.charAt(0) + w.slice(1).toLowerCase().replace(/([-'’])(\p{L})/gu, (_, a, b) => a + b.toUpperCase())
    : w)
  .join(' ');

// Plus grande taille (≤ max, ≥ min) pour que le texte tienne dans maxW.
function fitSize(text, font, max, min, maxW, letterSpacing = 0) {
  for (let s = max; s > min; s -= 2) if (textWidth(text, font, s, letterSpacing) <= maxW) return s;
  return min;
}

// Lignes d'un paragraphe : réduit la taille jusqu'à tenir en maxLines.
function fitLines(text, font, max, min, maxW, maxLines) {
  for (let s = max; s >= min; s -= 2) {
    const lines = wrapText(propre(text), font, s, maxW);
    if (lines.length <= maxLines) return { size: s, lines };
  }
  const lines = wrapText(propre(text), font, min, maxW);
  return { size: min, lines: lines.slice(0, maxLines).map((l, i, a) => (i === a.length - 1 && lines.length > maxLines ? `${l}…` : l)) };
}

const FONT = {
  outfit400: 'font-family="Outfit" font-weight="400"',
  outfit500: 'font-family="Outfit" font-weight="500"',
  outfit600: 'font-family="Outfit" font-weight="600"',
  outfit700: 'font-family="Outfit" font-weight="700"',
  playfair600i: 'font-family="Playfair Display" font-weight="600" font-style="italic"',
  playfair700i: 'font-family="Playfair Display" font-weight="700" font-style="italic"',
};

/* ─── Logo eneko.ai (SVG officiel, ids préfixés) ─────────────── */

const LOGOS = {};
function logo(variant, prefix, x, y, height) {
  if (!LOGOS[variant]) {
    const raw = readFileSync(asset(variant === 'blanc' ? 'logo-eneko-blanc.svg' : 'logo-eneko.svg'), 'utf8');
    const vb = raw.match(/viewBox="([^"]+)"/)[1];
    const inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    LOGOS[variant] = { vb, inner, ratio: Number(vb.split(/\s+/)[2]) / Number(vb.split(/\s+/)[3]) };
  }
  const { vb, inner, ratio } = LOGOS[variant];
  const ids = [...new Set([...inner.matchAll(/id="([^"]+)"/g)].map(m => m[1]))];
  let body = inner;
  for (const id of ids) body = body.split(id).join(`${prefix}${id}`);
  return `<svg x="${x}" y="${y}" width="${(height * ratio).toFixed(1)}" height="${height}" viewBox="${vb}">${body}</svg>`;
}

/* ─── QR code de vérification ────────────────────────────────── */

function qrPath(text, x, y, size) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const cell = size / n;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.get(r, c)) d += `M${(x + c * cell).toFixed(2)} ${(y + r * cell).toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
    }
  }
  return `<path d="${d}" fill="${C.nuit}" shape-rendering="crispEdges"/>`;
}

/* ─── Certificat A4 paysage ──────────────────────────────────── */

// d : { id, nom, formation, periode, duree, dateEmission, mention,
//       signataire, qualite, verifyUrl, verifyLabel, annee }
function certificatBody(d, p = 'c-') {
  const LX = 124;                 // marge gauche du contenu
  const CW = 1000;                // largeur utile du contenu
  const PX = 1196;                // début du panneau nuit
  const PW = W - PX;
  const PC = PX + PW / 2;         // axe du panneau

  // Nom : Playfair italique, taille ajustée à la largeur.
  const nom = propre(d.nom);
  // Une ligne tant que possible (≥ 84), sinon deux lignes plus petites.
  const nom1 = fitSize(nom, 'playfair600i', 124, 84, CW);
  const nomFit = textWidth(nom, 'playfair600i', nom1) <= CW
    ? { size: nom1, lines: [nom] }
    : fitLines(nom, 'playfair600i', 84, 56, CW, 2);
  const nomSize = nomFit.size;
  const titre = fitLines(d.formation, 'outfit600', 40, 28, CW, 3);

  // Méta : durée · période · délivrance (colonnes mesurées).
  const metas = [
    ['DURÉE', d.duree],
    ['PÉRIODE', d.periode],
    ['DÉLIVRÉ LE', d.dateEmission],
  ].filter(([, v]) => propre(v));

  // Texte circulaire du sceau.
  const R = 118;
  const devise = 'PASSEZ À L’IA, VRAIMENT · ';
  const circ = 2 * Math.PI * R;
  const unit = textWidth(devise, 'outfit600', 19, 4.2);
  const repeats = Math.max(1, Math.floor(circ / unit));
  const deviseTxt = devise.repeat(repeats);
  const sealY = 372;

  let y = 0;
  const out = [];
  out.push(`
  <defs>
    <radialGradient id="${p}glow1" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(140 60) scale(760 560)">
      <stop offset="0" stop-color="${C.rose}" stop-opacity="0.22"/><stop offset="0.55" stop-color="${C.mauve}" stop-opacity="0.08"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="${p}glow2" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(1060 1191) scale(620 420)">
      <stop offset="0" stop-color="${C.bleu}" stop-opacity="0.10"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${p}panel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.nuit}"/><stop offset="1" stop-color="${C.nuit2}"/>
    </linearGradient>
    <linearGradient id="${p}bar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.violet}"/><stop offset="0.6" stop-color="${C.mauve}"/><stop offset="1" stop-color="${C.rose}"/>
    </linearGradient>
    <linearGradient id="${p}seal" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.violet}"/><stop offset="1" stop-color="${C.bleu}"/>
    </linearGradient>
    <filter id="${p}blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="60"/></filter>
    <filter id="${p}soft" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000" flood-opacity="0.35"/></filter>
    <clipPath id="${p}panelClip"><rect x="${PX}" y="0" width="${PW}" height="${H}"/></clipPath>
    <path id="${p}ring" d="M ${PC} ${sealY - R} a ${R} ${R} 0 1 1 -0.01 0"/>
  </defs>

  <!-- Fond clair + halos (comme le hero d'eneko.ai) -->
  <rect width="${W}" height="${H}" fill="#FFFFFF"/>
  <rect width="${PX}" height="${H}" fill="url(#${p}glow1)"/>
  <rect width="${PX}" height="${H}" fill="url(#${p}glow2)"/>

  <!-- Panneau nuit à droite : orbes floutées + arcs -->
  <g clip-path="url(#${p}panelClip)">
    <rect x="${PX}" y="0" width="${PW}" height="${H}" fill="url(#${p}panel)"/>
    <circle cx="${PX + 60}" cy="120" r="190" fill="${C.violet}" opacity="0.55" filter="url(#${p}blur)"/>
    <circle cx="${W - 30}" cy="640" r="170" fill="${C.rose}" opacity="0.35" filter="url(#${p}blur)"/>
    <circle cx="${PX + 120}" cy="1120" r="200" fill="${C.bleu}" opacity="0.55" filter="url(#${p}blur)"/>
    ${[260, 330, 400, 470].map(r => `<circle cx="${PC}" cy="${sealY}" r="${r}" fill="none" stroke="#FFFFFF" stroke-opacity="0.07" stroke-width="2"/>`).join('')}
  </g>
  <rect x="${PX - 10}" y="0" width="10" height="${H}" fill="url(#${p}bar)"/>`);

  // Logo + titre
  out.push(logo('nuit', `${p}lg-`, LX, 96, 74));
  y = 290;
  out.push(`<rect x="${LX}" y="${y - 22}" width="44" height="6" rx="3" fill="url(#${p}bar)"/>`);
  out.push(`<text x="${LX + 60}" y="${y - 10}" ${FONT.outfit700} font-size="26" letter-spacing="6.5" fill="${C.violet}">CERTIFICAT DE FORMATION</text>`);
  y += 62;
  out.push(`<text x="${LX}" y="${y}" ${FONT.outfit400} font-size="29" fill="${C.inkMid}">Ce certificat est décerné à</text>`);
  nomFit.lines.forEach((l, i) => {
    y += i === 0 ? 32 + nomSize * 0.92 : nomSize * 1.08;
    out.push(`<text x="${LX}" y="${y.toFixed(1)}" ${FONT.playfair600i} font-size="${nomSize}" fill="${C.nuit}">${xml(l)}</text>`);
  });
  y += 42;
  out.push(`<rect x="${LX}" y="${y.toFixed(1)}" width="${Math.min(CW, Math.max(260, Math.max(...nomFit.lines.map(l => textWidth(l, 'playfair600i', nomSize))) * 0.55)).toFixed(1)}" height="7" rx="3.5" fill="url(#${p}bar)"/>`);
  y += 78;
  out.push(`<text x="${LX}" y="${y.toFixed(1)}" ${FONT.outfit400} font-size="29" fill="${C.inkMid}">pour avoir suivi avec succès la formation</text>`);
  y += 20;
  titre.lines.forEach((l, i) => {
    out.push(`<text x="${LX}" y="${(y + titre.size * 1.28 * (i + 1)).toFixed(1)}" ${FONT.outfit600} font-size="${titre.size}" fill="${C.nuit}">${xml(i === 0 ? `« ${l}` : l)}${i === titre.lines.length - 1 ? ' »' : ''}</text>`);
  });
  y += titre.size * 1.28 * titre.lines.length + 60;

  // Méta en colonnes séparées par un filet
  let mx = LX;
  metas.forEach(([label, value], i) => {
    const vw = textWidth(propre(value), 'outfit600', 30);
    const lw = textWidth(label, 'outfit600', 17, 3.4);
    const colW = Math.max(vw, lw);
    if (i > 0) out.push(`<rect x="${mx - 36}" y="${(y - 38).toFixed(1)}" width="2" height="68" fill="${C.ligne}"/>`);
    out.push(`<text x="${mx}" y="${(y - 12).toFixed(1)}" ${FONT.outfit600} font-size="17" letter-spacing="3.4" fill="${C.violet}">${xml(label)}</text>`);
    out.push(`<text x="${mx}" y="${(y + 28).toFixed(1)}" ${FONT.outfit600} font-size="30" fill="${C.nuit}">${xml(value)}</text>`);
    mx += colW + 72;
  });
  y += 80;

  // Mention sur UNE ligne (la signature est calée en bas de page).
  if (propre(d.mention)) {
    const m = fitLines(d.mention, 'outfit400', 21, 15, CW, 1);
    m.lines.forEach((l, i) => out.push(`<text x="${LX}" y="${(y + i * m.size * 1.4).toFixed(1)}" ${FONT.outfit400} font-size="${m.size}" fill="${C.inkSoft}">${xml(l)}</text>`));
  }
  const yApres = y;

  // Signature (bas gauche) + pied de page
  // Calée en bas, mais jamais sur la mention (nom sur deux lignes).
  const sy = Math.min(1080, Math.max(1052, yApres + 118));
  out.push(`<rect x="${LX}" y="${sy - 58}" width="300" height="2" fill="${C.ligne}"/>`);
  out.push(`<text x="${LX}" y="${sy - 8}" ${FONT.playfair600i} font-size="36" fill="${C.nuit}">${xml(casseNom(d.signataire))}</text>`);
  out.push(`<text x="${LX}" y="${sy + 26}" ${FONT.outfit400} font-size="20" fill="${C.inkSoft}">${xml(d.qualite)}</text>`);
  out.push(`<text x="${LX}" y="${H - 48}" ${FONT.outfit400} font-size="17" fill="${C.inkSoft}">Eneko · M&amp;BOCA · Organisme de formation, déclaration d’activité n° 75400178140 · eneko.ai</text>`);

  // Sceau : disque dégradé, devise circulaire, année
  out.push(`
  <g filter="url(#${p}soft)">
    <circle cx="${PC}" cy="${sealY}" r="${R + 44}" fill="url(#${p}seal)"/>
  </g>
  <circle cx="${PC}" cy="${sealY}" r="${R + 30}" fill="none" stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="2"/>
  <circle cx="${PC}" cy="${sealY}" r="${R - 30}" fill="none" stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="2"/>
  <text ${FONT.outfit600} font-size="19" letter-spacing="4.2" fill="#FFFFFF"><textPath href="#${p}ring">${xml(deviseTxt)}</textPath></text>
  <text x="${PC}" y="${sealY - 22}" text-anchor="middle" ${FONT.outfit600} font-size="15" letter-spacing="3.5" fill="#FFFFFF" fill-opacity="0.85">FORMATION</text>
  <text x="${PC}" y="${sealY + 30}" text-anchor="middle" ${FONT.playfair700i} font-size="56" fill="#FFFFFF">${xml(d.annee)}</text>
  <text x="${PC}" y="${sealY + 58}" text-anchor="middle" ${FONT.outfit600} font-size="15" letter-spacing="3.5" fill="#FFFFFF" fill-opacity="0.85">ENEKO</text>`);

  // Carte de vérification : QR + identifiant
  const cardW = 340, cardH = 392, cx = PC - cardW / 2, cy = 690;
  const qrS = 236;
  out.push(`
  <rect x="${cx}" y="${cy}" width="${cardW}" height="${cardH}" rx="28" fill="#FFFFFF"/>
  ${qrPath(d.verifyUrl, PC - qrS / 2, cy + 30, qrS)}
  <text x="${PC}" y="${cy + qrS + 72}" text-anchor="middle" ${FONT.outfit600} font-size="19" fill="${C.nuit}">Scannez pour vérifier</text>
  <text x="${PC}" y="${cy + qrS + 100}" text-anchor="middle" ${FONT.outfit500} font-size="16" letter-spacing="1.5" fill="${C.violet}">${xml(d.id)}</text>
  <text x="${PC}" y="${cy + qrS + 126}" text-anchor="middle" ${FONT.outfit400} font-size="14" fill="${C.inkSoft}">${xml(d.verifyLabel)}</text>`);

  return out.join('\n');
}

export function certificatSvg(d) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${certificatBody(d, 'c-')}</svg>`;
}

/* ─── Visuel de partage 1200×627 (aperçu du lien) ────────────── */

export function ogSvg(d) {
  const OW = 1200, OH = 627;
  const ch = 500, cw = ch * W / H;           // certificat réduit
  const cx = 56, cy = (OH - ch) / 2;
  const RX = cx + cw + 44, RW = OW - RX - 48;
  const nom = fitLines(d.nom, 'playfair600i', 46, 32, RW, 2);
  const f = fitLines(d.formationCourte || d.formation, 'outfit600', 23, 18, RW, 3);
  let y = 170;
  const parts = [];
  parts.push(`<text x="${RX}" y="${y}" ${FONT.outfit700} font-size="15" letter-spacing="3.5" fill="${C.rose}">CERTIFICAT DE FORMATION</text>`);
  y += 22;
  nom.lines.forEach((l) => { y += nom.size * 1.12; parts.push(`<text x="${RX}" y="${y.toFixed(1)}" ${FONT.playfair600i} font-size="${nom.size}" fill="#FFFFFF">${xml(l)}</text>`); });
  y += 22;
  parts.push(`<rect x="${RX}" y="${y}" width="120" height="5" rx="2.5" fill="url(#o-bar)"/>`);
  y += 44;
  parts.push(`<text x="${RX}" y="${y}" ${FONT.outfit400} font-size="19" fill="#FFFFFF" fill-opacity="0.75">a terminé la formation</text>`);
  f.lines.forEach((l) => { y += f.size * 1.3; parts.push(`<text x="${RX}" y="${y.toFixed(1)}" ${FONT.outfit600} font-size="${f.size}" fill="#FFFFFF">${xml(l)}</text>`); });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OW}" height="${OH}" viewBox="0 0 ${OW} ${OH}">
  <defs>
    <linearGradient id="o-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.nuit}"/><stop offset="1" stop-color="${C.nuit2}"/></linearGradient>
    <linearGradient id="o-bar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.violet}"/><stop offset="1" stop-color="${C.rose}"/></linearGradient>
    <filter id="o-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="70"/></filter>
    <filter id="o-shadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#000" flood-opacity="0.45"/></filter>
    <clipPath id="o-clip"><rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="10"/></clipPath>
  </defs>
  <rect width="${OW}" height="${OH}" fill="url(#o-bg)"/>
  <circle cx="160" cy="80" r="220" fill="${C.violet}" opacity="0.6" filter="url(#o-blur)"/>
  <circle cx="1120" cy="600" r="220" fill="${C.rose}" opacity="0.35" filter="url(#o-blur)"/>
  <circle cx="900" cy="40" r="160" fill="${C.bleu}" opacity="0.5" filter="url(#o-blur)"/>
  <rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="10" fill="#FFFFFF" filter="url(#o-shadow)"/>
  <g clip-path="url(#o-clip)">
    <svg x="${cx}" y="${cy}" width="${cw}" height="${ch}" viewBox="0 0 ${W} ${H}">${certificatBody(d, 'oc-')}</svg>
  </g>
  ${parts.join('\n  ')}
  ${logo('blanc', 'o-lg-', RX, OH - 96, 44)}
</svg>`;
}

/* ─── Rendu ──────────────────────────────────────────────────── */

function toPng(svg, width) {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Outfit' },
    background: '#FFFFFF',
  });
  return r.render().asPng();
}

/**
 * @returns {Promise<{ png: Buffer, og: Buffer, pdf: Uint8Array }>}
 */
export async function renderCertificatFormation(d) {
  const png = toPng(certificatSvg(d), 2480);
  const og = toPng(ogSvg(d), 1200);

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Certificat de formation Eneko — ${propre(d.nom)}`);
  pdf.setAuthor('Eneko');
  pdf.setCreator('outils.eneko.ai');
  pdf.setSubject(propre(d.formation));
  pdf.setLanguage('fr-FR');
  const img = await pdf.embedPng(new Uint8Array(png));
  const page = pdf.addPage([841.89, 595.28]);
  page.drawImage(img, { x: 0, y: 0, width: 841.89, height: 595.28 });
  return { png, og, pdf: await pdf.save() };
}
