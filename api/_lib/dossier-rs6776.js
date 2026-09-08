// ════════════════════════════════════════════════════════════════
//  api/_lib/dossier-rs6776.js  —  Dossier d'inscription certification
//  RS6776 (InKréa) : spécification des champs, validation serveur et
//  génération du PDF définitif.
//
//  Source de vérité UNIQUE des énumérations : la page publique
//  /dossier-inscription reproduit ces libellés mais c'est ICI que la
//  validation fait foi — toute valeur hors liste est rejetée avant
//  d'atteindre le PDF ou Notion.
//
//  Le PDF reproduit la structure du dossier papier InKréa (3 pages :
//  identité, insertion professionnelle, objectif + consentement) avec
//  un encart de traçabilité du consentement électronique (horodatage
//  Paris + IP) — le formulaire d'origine ne comporte pas de signature
//  manuscrite, seulement « En envoyant ce formulaire, j'accepte… ».
// ════════════════════════════════════════════════════════════════

import crypto from 'node:crypto';
import { put } from '@vercel/blob';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { INKREA_LOGO_JPEG_B64 } from './inkrea-logo.js';

// Token de lien candidat : domaine de signature + durée de validité.
export const LINK_PURPOSE = 'dossier-rs6776';
export const LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000; // le candidat a 30 jours
export const FORM_URL = 'https://outils.eneko.ai/dossier-inscription/';

// Champs pré-remplissables du lien candidat (et leurs bornes).
const PREFILL_CAPS = { prenom: 80, nomUsage: 80, email: 200, telephone: 40, intitulePoste: 150, nomEntreprise: 150 };

// Crée un lien candidat court : le payload (prefill borné + expiration)
// est déposé dans le Blob privé `dossier-liens/<id>.json`, l'URL ne porte
// que l'identifiant `prenom-nom-<aléa>` (~50 bits, alphabet sans ambiguïté).
// Utilisé par /api/dossier-admin (page interne) et /api/cockpit-docs (fiche).
export async function createCandidateLink(prefill = {}, contactId = '') {
  const pf = {};
  for (const [key, max] of Object.entries(PREFILL_CAPS)) {
    pf[key] = typeof prefill[key] === 'string' ? prefill[key].trim().slice(0, max) : '';
  }
  const exp = Date.now() + LINK_TTL_MS;
  const slug = `${pf.prenom}-${pf.nomUsage}`
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'candidat';
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const rand = Array.from(crypto.randomBytes(10), b => alphabet[b % alphabet.length]).join('');
  const linkId = `${slug}-${rand}`;

  await put(
    `dossier-liens/${linkId}.json`,
    JSON.stringify({ v: 1, cert: 'RS6776', exp, cid: contactId, pf }),
    { access: 'private', contentType: 'application/json', addRandomSuffix: false }
  );
  return { url: `${FORM_URL}#${linkId}`, exp, pf };
}

export const CERT_RS6776 = {
  code: 'RS6776',
  organisme: 'InKréa Certifications',
  organismeSousTitre: 'SAS InKréa Formations - Siret : 90443623500017',
  organismeSite: 'www.inkrea-certifications.fr',
  intitule:
    "Création de contenus rédactionnels et visuels par l'usage responsable de l'intelligence artificielle générative",
};

export const OPTIONS = {
  situationPro: [
    'En poste (hors alternance)',
    'Inactif',
    "En recherche d'emploi ou interim",
    'Travailleur non salarié (indépendant)',
    'En formation / étudiant',
    "Dirigeant d'entreprise",
  ],
  niveauQualif: [
    'Non renseigné',
    'Sans diplôme ou diplôme National du Brevet (Niveau 2)',
    'CAP, BEP… (Niveau 3)',
    'BAC : BP, BT, bac pro ou techno (NIVEAU 4)',
    'BAC + 2 : DEUG, BT, DUT... (NIVEAU 5)',
    'BAC + 3 ou 4 : Licence, Master 1, Maîtrise... (NIVEAU 6)',
    'BAC + 5 : Grade master, DESS, DEA, ingénieur... (NIVEAU 7)',
    'BAC + 8 : Doctorat... (NIVEAU 8)',
  ],
  tempsTravail: ['50% (mi-temps)', '100% (temps complet)', 'Autre'],
  typeContrat: ['CDD', 'CDI', 'Intérim', 'Indépendant', 'Non concerné(e)'],
  statutCadre: ['Oui', 'Non'],
  objectif: [
    'Mobilité professionnelle',
    'Evolution professionnelle',
    'Adaptation au poste de travail',
    "Accès ou maintien dans l'emploi",
    'Développement des compétences',
    'Autre',
  ],
};

/* ── Validation ───────────────────────────────────────────────── */

const cap = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// "2026-09-04" (input type=date) → "04/09/2026" ; sinon '' si invalide.
function frDate(v) {
  const s = cap(v, 20);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const [, y, mo, d] = m;
  const t = new Date(`${y}-${mo}-${d}T12:00:00Z`);
  if (Number.isNaN(t.getTime()) || y < 1900 || y > 2100) return '';
  return `${d}/${mo}/${y}`;
}

// Valide et normalise la soumission. Renvoie { error } (message français,
// première erreur rencontrée) ou { clean } prêt pour le PDF et Notion.
export function validateDossier(input) {
  const f = input && typeof input === 'object' ? input : {};
  const clean = {
    prenom: cap(f.prenom, 80),
    prenom2: cap(f.prenom2, 80),
    prenom3: cap(f.prenom3, 80),
    nomNaissance: cap(f.nomNaissance, 80),
    nomUsage: cap(f.nomUsage, 80),
    email: cap(f.email, 200),
    telephone: cap(f.telephone, 40),
    dateNaissance: frDate(f.dateNaissance),
    cpVilleNaissance: cap(f.cpVilleNaissance, 120),
    paysNaissance: cap(f.paysNaissance, 80),
    situationPro: cap(f.situationPro, 80),
    niveauQualif: cap(f.niveauQualif, 120),
    niveauDepuis: frDate(f.niveauDepuis),
    derniereCertif: cap(f.derniereCertif, 300),
    posteNonConcerne: f.posteNonConcerne === true,
    intitulePoste: cap(f.intitulePoste, 150),
    nomEntreprise: cap(f.nomEntreprise, 150),
    tempsTravail: cap(f.tempsTravail, 40),
    tempsTravailAutre: cap(f.tempsTravailAutre, 20),
    typeContrat: cap(f.typeContrat, 40),
    statutCadre: cap(f.statutCadre, 10),
    objectif: cap(f.objectif, 80),
    objectifAutre: cap(f.objectifAutre, 300),
    consentement: f.consentement === true,
  };

  const manquant = (label) => ({ error: `Champ manquant ou invalide : ${label}.` });

  if (!clean.prenom) return manquant('prénom');
  if (!clean.nomNaissance) return manquant('nom de naissance');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email)) return manquant('email');
  if (!clean.telephone) return manquant('numéro de téléphone');
  if (!clean.dateNaissance) return manquant('date de naissance');
  if (!clean.cpVilleNaissance) return manquant('code postal + ville de naissance');
  if (!clean.paysNaissance) return manquant('pays de naissance');
  if (!OPTIONS.situationPro.includes(clean.situationPro)) return manquant('situation professionnelle');
  if (!OPTIONS.niveauQualif.includes(clean.niveauQualif)) return manquant('niveau de qualification');
  if (!clean.niveauDepuis) return manquant('niveau de qualification — depuis le');
  if (!clean.derniereCertif) return manquant('dernière certification obtenue');

  if (!clean.posteNonConcerne) {
    if (!clean.intitulePoste) return manquant('intitulé du poste');
    if (!clean.nomEntreprise) return manquant("nom de l'entreprise");
    if (!OPTIONS.tempsTravail.includes(clean.tempsTravail)) return manquant('temps de travail');
    if (clean.tempsTravail === 'Autre' && !clean.tempsTravailAutre) {
      return manquant('temps de travail — précisez le pourcentage');
    }
    if (!OPTIONS.typeContrat.includes(clean.typeContrat)) return manquant('type de contrat');
    if (!OPTIONS.statutCadre.includes(clean.statutCadre)) return manquant('statut cadre');
  }

  if (!OPTIONS.objectif.includes(clean.objectif)) return manquant('objectif poursuivi');
  if (!clean.consentement) {
    return { error: 'Le consentement est obligatoire pour envoyer le dossier.' };
  }

  return { clean };
}

/* ── Génération du PDF ────────────────────────────────────────── */
//
//  Reproduction fidèle du dossier InKréa d'origine (mesures relevées
//  dans le PDF fourni) : logo en tête, bandeaux de section saumon,
//  typographie et pied de page identiques. Seule addition : la mention
//  de traçabilité du consentement électronique en fin de document.

const PAGE = { w: 595.32, h: 841.92 };
const ML = 70.8;                    // marge gauche/droite (2,5 cm)
const CONTENT_W = PAGE.w - ML * 2;
const INDENT = 106.8;               // sous-bloc « Si en poste »
const STEP = 22.05;                 // interligne des champs
const STEP_OPT = 22.6;              // interligne des cases à cocher
const TOP_NEXT = 103.35;            // première ligne des pages 2+
const MAX_Y = 762;                  // dernière ligne avant le pied de page

const NAVY = rgb(35 / 255, 51 / 255, 72 / 255);
const SALMON = rgb(234 / 255, 170 / 255, 145 / 255);
const WHITE = rgb(1, 1, 1);
const HIGHLIGHT = rgb(1, 0.95, 0.35);
const GRAY = rgb(0.45, 0.45, 0.48);

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
  'août', 'septembre', 'octobre', 'novembre', 'décembre'];

// "10/12/1974" → "10 décembre 1974" (forme utilisée dans le dossier d'origine).
function frDateLong(ddmmyyyy) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(ddmmyyyy || '');
  if (!m) return ddmmyyyy || '';
  const jour = Number(m[1]);
  return `${jour === 1 ? '1er' : jour} ${MOIS[Number(m[2]) - 1]} ${m[3]}`;
}

export async function buildDossierPdf(clean, { submittedAt = new Date(), ip = '' } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const boldItalic = await doc.embedFont(StandardFonts.HelveticaBoldOblique);
  const logo = await doc.embedJpg(Buffer.from(INKREA_LOGO_JPEG_B64, 'base64'));

  doc.setTitle(`Dossier d'inscription ${CERT_RS6776.code} — ${clean.prenom} ${clean.nomUsage || clean.nomNaissance}`);
  doc.setCreator('outils.eneko.ai');

  let page;
  let y;                            // ligne de base courante, mesurée DEPUIS LE HAUT
  const at = (yTop) => PAGE.h - yTop;

  /* ── Primitives ── */

  const wrap = (text, f, size, maxWidth) => {
    const words = String(text).split(/\s+/).filter(Boolean);
    const out = [];
    let cur = '';
    for (const w of words) {
      const attempt = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(attempt, size) <= maxWidth) cur = attempt;
      else { if (cur) out.push(cur); cur = w; }
    }
    if (cur) out.push(cur);
    return out.length ? out : [''];
  };

  const footer = () => {
    const rows = [
      [{ t: CERT_RS6776.organisme, f: bold }],
      [{ t: 'SAS InKréa Formations', f: bold }, { t: ' - Siret : 90443623500017', f: font }],
      [{ t: CERT_RS6776.organismeSite, f: font }],
    ];
    rows.forEach((runs, i) => {
      const size = 9;
      const total = runs.reduce((s, r) => s + r.f.widthOfTextAtSize(r.t, size), 0);
      let x = ML + (CONTENT_W - total) / 2;
      for (const r of runs) {
        page.drawText(r.t, { x, y: at(782.25 + i * 11), size, font: r.f, color: NAVY });
        x += r.f.widthOfTextAtSize(r.t, size);
      }
    });
  };

  const newPage = () => {
    page = doc.addPage([PAGE.w, PAGE.h]);
    footer();
    y = TOP_NEXT;
  };

  const ensure = () => { if (y > MAX_Y) newPage(); };

  // Ligne composée de plusieurs styles, centrée (titres et consentement).
  const centerRuns = (runs, yTop) => {
    const total = runs.reduce((s, r) => s + r.f.widthOfTextAtSize(r.t, r.size), 0);
    let x = ML + (CONTENT_W - total) / 2;
    for (const r of runs) {
      const w = r.f.widthOfTextAtSize(r.t, r.size);
      page.drawText(r.t, { x, y: at(yTop), size: r.size, font: r.f, color: r.color || NAVY });
      if (r.underline) {
        page.drawLine({
          start: { x, y: at(yTop + 1.9) }, end: { x: x + w, y: at(yTop + 1.9) },
          thickness: 0.7, color: NAVY,
        });
      }
      x += w;
    }
  };

  // Bandeau de section saumon, texte blanc centré.
  const band = (title) => {
    y += 14.8;
    ensure();
    page.drawRectangle({ x: ML, y: at(y + 6), width: CONTENT_W, height: 19, color: SALMON });
    const w = bold.widthOfTextAtSize(title, 11);
    page.drawText(title, { x: ML + (CONTENT_W - w) / 2, y: at(y), size: 11, font: bold, color: WHITE });
    y += 21.35;
  };

  // Ligne de texte simple (avec retour à la ligne suspendu si trop longue).
  const line = (text, { f = font, x = ML, size = 10 } = {}) => {
    const maxWidth = PAGE.w - ML - x;
    const parts = wrap(text, f, size, maxWidth);
    parts.forEach((part, i) => {
      ensure();
      page.drawText(part, { x: i === 0 ? x : x + 10, y: at(y), size, font: f, color: NAVY });
      y += i === parts.length - 1 ? STEP : 13.5;
    });
  };

  const field = (label, value, { f = font, x = ML } = {}) =>
    line(`${label} : ${value || ''}`.trimEnd(), { f, x });

  // Case à cocher : carré vide, ou « x » à la place du carré si cochée
  // (exactement la convention du dossier d'origine).
  const option = (label, checked, { x = ML } = {}) => {
    ensure();
    if (checked) {
      page.drawText('x', { x, y: at(y), size: 10, font, color: NAVY });
    } else {
      page.drawRectangle({
        x, y: at(y + 0.5), width: 7.5, height: 7.5,
        borderColor: NAVY, borderWidth: 0.7,
      });
    }
    page.drawText(label, { x: x + 10, y: at(y), size: 10, font, color: NAVY });
    y += STEP_OPT;
  };

  const gap = (n = 22) => { y += n; };

  /* ── Page 1 : en-tête ── */
  newPage();
  page.drawImage(logo, { x: (PAGE.w - 161.25) / 2, y: at(41 + 81.6), width: 161.25, height: 81.6 });
  centerRuns([{ t: 'Dossier d’inscription', f: bold, size: 12 }], 146.25);
  centerRuns([{ t: 'Certification', f: bold, size: 10, underline: true }], 169.35);
  centerRuns([{ t: `Numéro d’enregistrement au Répertoire Spécifique : ${CERT_RS6776.code}`, f: bold, size: 10 }], 191.4);

  const intitule = `Intitulé : « ${CERT_RS6776.intitule} ».`;
  wrap(intitule, italic, 10, CONTENT_W).forEach((l, i) => {
    const runs = i === 0 && l.startsWith('Intitulé')
      ? [{ t: 'Intitulé', f: italic, size: 10, underline: true }, { t: l.slice('Intitulé'.length), f: italic, size: 10 }]
      : [{ t: l, f: italic, size: 10 }];
    centerRuns(runs, 205.4 + i * 14.05);
  });
  centerRuns([
    { t: 'Toutes les réponses sont obligatoires', f: bold, size: 12, underline: true },
    { t: '.', f: font, size: 10 },
  ], 243.2);

  /* ── CANDIDAT(E) ── */
  y = 278.7;
  band('CANDIDAT(E)');
  field('Prénom', clean.prenom);
  field('Deuxième prénom', clean.prenom2);
  field('Troisième prénom', clean.prenom3);
  field('Nom de naissance', clean.nomNaissance);
  field('Nom d’usage', clean.nomUsage);
  field('Email', clean.email);
  field('Numéro de téléphone', clean.telephone);
  field('Date de naissance', frDateLong(clean.dateNaissance));
  field('Code postal + Ville de naissance', clean.cpVilleNaissance);
  field('Pays de naissance', clean.paysNaissance);

  /* ── SUIVI DE L'INSERTION PROFESSIONNELLE ── */
  band('SUIVI DE L’INSERTION PROFESSIONNELLE');
  line('Situation professionnelle actuelle :', { f: bold });
  for (const opt of OPTIONS.situationPro) option(opt, opt === clean.situationPro);

  gap();
  line('Niveau de qualification* :', { f: bold });
  for (const opt of OPTIONS.niveauQualif) option(opt, opt === clean.niveauQualif);

  gap(0);
  line(`Depuis le (JJ/MM/AAAA)* : ${clean.niveauDepuis}`, { f: bold });
  line('Nom de la dernière certification obtenue* :', { f: bold });
  line(clean.derniereCertif);

  gap();
  line('Si en poste :', { f: bold });
  option('Non concerné(e)', clean.posteNonConcerne);
  if (!clean.posteNonConcerne) {
    line(`- Intitulé du poste* : ${clean.intitulePoste}`, { f: bold, x: INDENT });
    line(`- Nom de l’entreprise* : ${clean.nomEntreprise}`, { f: bold, x: INDENT });
    line('- Temps de travail* :', { f: bold, x: INDENT });
    for (const opt of OPTIONS.tempsTravail) {
      const label = opt === 'Autre'
        ? `Autre (précisez le pourcentage) : ${clean.tempsTravail === 'Autre' ? clean.tempsTravailAutre : ''}`.trimEnd()
        : opt;
      option(label, opt === clean.tempsTravail, { x: INDENT });
    }
    line('- Type de contrat* :', { f: bold, x: INDENT });
    for (const opt of OPTIONS.typeContrat) option(opt, opt === clean.typeContrat, { x: INDENT });
    line('- Statut cadre* :', { f: bold, x: INDENT });
    for (const opt of OPTIONS.statutCadre) option(opt, opt === clean.statutCadre, { x: INDENT });
  }

  gap();
  line('Objectif poursuivi lors de l’inscription à la certification* :', { f: bold });
  for (const opt of OPTIONS.objectif) {
    const label = opt === 'Autre' && clean.objectifAutre ? `Autre : ${clean.objectifAutre}` : opt;
    option(label, opt === clean.objectif);
  }

  /* ── Consentement (centré, gras, comme dans l'original) ── */
  const PHRASE = 'je m’engage à passer l’examen';
  const consent = 'En envoyant ce formulaire, j’accepte les conditions relatives au traitement de mes '
    + `données personnelles et ${PHRASE} visant à l’obtention de la certification`;
  gap(68);
  for (const l of wrap(consent, bold, 12, CONTENT_W)) {
    ensure();
    const total = bold.widthOfTextAtSize(l, 12);
    const startX = ML + (CONTENT_W - total) / 2;
    const at0 = l.indexOf(PHRASE);
    if (at0 !== -1) {
      page.drawRectangle({
        x: startX + bold.widthOfTextAtSize(l.slice(0, at0), 12),
        y: at(y + 2.5),
        width: bold.widthOfTextAtSize(PHRASE, 12),
        height: 14,
        color: HIGHLIGHT,
      });
    }
    page.drawText(l, { x: startX, y: at(y), size: 12, font: bold, color: NAVY });
    y += 16.8;
  }
  for (const l of wrap(`« ${CERT_RS6776.intitule} ».`, boldItalic, 12, CONTENT_W)) {
    ensure();
    centerRuns([{ t: l, f: boldItalic, size: 12 }], y);
    y += 16.8;
  }

  /* ── Traçabilité du consentement électronique (ajout Eneko) ── */
  const horodatage = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short',
  }).format(submittedAt);
  const trace = `Consentement recueilli électroniquement le ${horodatage} (heure de Paris) via le formulaire `
    + `sécurisé outils.eneko.ai${ip ? ` — adresse IP ${ip}` : ''}. Document généré automatiquement à partir `
    + 'des réponses du candidat / de la candidate.';
  gap(24);
  for (const l of wrap(trace, italic, 8.5, CONTENT_W)) {
    ensure();
    centerRuns([{ t: l, f: italic, size: 8.5, color: GRAY }], y);
    y += 11.5;
  }

  return doc.save();
}
