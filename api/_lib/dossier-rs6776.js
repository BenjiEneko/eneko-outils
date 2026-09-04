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

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Token de lien candidat : domaine de signature + durée de validité.
export const LINK_PURPOSE = 'dossier-rs6776';
export const LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000; // le candidat a 30 jours

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

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 56;
const INK = rgb(0.1, 0.1, 0.12);
const SOFT = rgb(0.42, 0.42, 0.45);
const LINE = rgb(0.82, 0.81, 0.79);

export async function buildDossierPdf(clean, { submittedAt = new Date(), ip = '' } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const oblique = await doc.embedFont(StandardFonts.HelveticaOblique);

  doc.setTitle(`Dossier d'inscription ${CERT_RS6776.code} — ${clean.prenom} ${clean.nomUsage || clean.nomNaissance}`);
  doc.setCreator('outils.eneko.ai');

  let page;
  let y;

  const drawHeader = () => {
    page.drawText(CERT_RS6776.organisme, { x: MARGIN, y: A4.h - 46, size: 11, font: bold, color: INK });
    page.drawText(CERT_RS6776.organismeSousTitre, { x: MARGIN, y: A4.h - 60, size: 8, font, color: SOFT });
    page.drawText(CERT_RS6776.organismeSite, { x: MARGIN, y: A4.h - 71, size: 8, font, color: SOFT });
    page.drawLine({
      start: { x: MARGIN, y: A4.h - 80 },
      end: { x: A4.w - MARGIN, y: A4.h - 80 },
      thickness: 0.5,
      color: LINE,
    });
    y = A4.h - 100;
  };

  const newPage = () => {
    page = doc.addPage([A4.w, A4.h]);
    drawHeader();
  };

  const ensure = (needed) => {
    if (y - needed < MARGIN) newPage();
  };

  // Découpe un texte en lignes tenant dans maxWidth.
  const wrap = (text, f, size, maxWidth) => {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let current = '';
    for (const word of words) {
      const attempt = current ? `${current} ${word}` : word;
      if (f.widthOfTextAtSize(attempt, size) <= maxWidth) {
        current = attempt;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [''];
  };

  const text = (str, { size = 10, f = font, color = INK, x = MARGIN, gap = 4, maxWidth = A4.w - 2 * MARGIN } = {}) => {
    for (const line of wrap(str, f, size, maxWidth - (x - MARGIN))) {
      ensure(size + gap);
      page.drawText(line, { x, y: y - size, size, font: f, color });
      y -= size + gap;
    }
  };

  const space = (h) => { y -= h; };

  const sectionTitle = (label) => {
    ensure(30);
    space(10);
    page.drawText(label, { x: MARGIN, y: y - 11, size: 11, font: bold, color: INK });
    y -= 26;
  };

  // « Label : valeur » — valeur en gras, retour à la ligne si trop long.
  const field = (label, value) => {
    const size = 10;
    const labelStr = `${label} : `;
    const labelW = font.widthOfTextAtSize(labelStr, size);
    const valueStr = value || '—';
    const maxW = A4.w - 2 * MARGIN;
    if (labelW + bold.widthOfTextAtSize(valueStr, size) <= maxW) {
      ensure(size + 7);
      page.drawText(labelStr, { x: MARGIN, y: y - size, size, font, color: INK });
      page.drawText(valueStr, { x: MARGIN + labelW, y: y - size, size, font: bold, color: INK });
      y -= size + 7;
    } else {
      text(labelStr, { size });
      text(valueStr, { size, f: bold, x: MARGIN + 14 });
      space(2);
    }
  };

  // Case 8×8 + croix si cochée, suivie du libellé.
  const checkRow = (label, checked, { x = MARGIN } = {}) => {
    const size = 10;
    ensure(size + 6);
    const boxY = y - size + 0.5;
    page.drawRectangle({ x, y: boxY, width: 8.5, height: 8.5, borderColor: INK, borderWidth: 0.8 });
    if (checked) {
      page.drawLine({ start: { x: x + 1.6, y: boxY + 1.6 }, end: { x: x + 6.9, y: boxY + 6.9 }, thickness: 1.1, color: INK });
      page.drawLine({ start: { x: x + 1.6, y: boxY + 6.9 }, end: { x: x + 6.9, y: boxY + 1.6 }, thickness: 1.1, color: INK });
    }
    page.drawText(label, { x: x + 14, y: y - size, size, font: checked ? bold : font, color: INK });
    y -= size + 6;
  };

  const radioGroup = (label, options, selected, { x = MARGIN } = {}) => {
    text(label, { size: 10, gap: 6, x });
    for (const opt of options) checkRow(opt, opt === selected, { x: x + 8 });
    space(4);
  };

  /* ── Contenu ── */
  newPage();

  // Titre
  const center = (str, size, f, dy) => {
    const w = f.widthOfTextAtSize(str, size);
    page.drawText(str, { x: (A4.w - w) / 2, y: y - size, size, font: f, color: INK });
    y -= size + dy;
  };
  space(8);
  center("Dossier d'inscription", 20, bold, 8);
  center('Certification', 14, bold, 14);
  text(`Numéro d'enregistrement au Répertoire Spécifique : ${CERT_RS6776.code}`, { size: 10, f: bold });
  text(`Intitulé : « ${CERT_RS6776.intitule} ».`, { size: 10 });
  space(4);
  text('Toutes les réponses sont obligatoires.', { size: 9, f: oblique, color: SOFT });
  space(6);

  sectionTitle('CANDIDAT(E)');
  field('Prénom', clean.prenom);
  field('Deuxième prénom', clean.prenom2);
  field('Troisième prénom', clean.prenom3);
  field('Nom de naissance', clean.nomNaissance);
  field("Nom d'usage", clean.nomUsage);
  field('Email', clean.email);
  field('Numéro de téléphone', clean.telephone);
  field('Date de naissance', clean.dateNaissance);
  field('Code postal + Ville de naissance', clean.cpVilleNaissance);
  field('Pays de naissance', clean.paysNaissance);
  space(6);
  radioGroup('Situation professionnelle actuelle :', OPTIONS.situationPro, clean.situationPro);

  sectionTitle("SUIVI DE L'INSERTION PROFESSIONNELLE");
  radioGroup('Niveau de qualification* :', OPTIONS.niveauQualif, clean.niveauQualif);
  field('Depuis le (JJ/MM/AAAA)*', clean.niveauDepuis);
  field('Nom de la dernière certification obtenue*', clean.derniereCertif);
  space(8);

  text('Si en poste :', { size: 10, f: bold, gap: 6 });
  checkRow('Non concerné(e)', clean.posteNonConcerne, { x: MARGIN + 8 });
  if (!clean.posteNonConcerne) {
    field('- Intitulé du poste*', clean.intitulePoste);
    field("- Nom de l'entreprise*", clean.nomEntreprise);
    const ttSelected = clean.tempsTravail === 'Autre'
      ? `Autre (précisez le pourcentage) : ${clean.tempsTravailAutre}`
      : clean.tempsTravail;
    const ttOptions = OPTIONS.tempsTravail.map(o =>
      o === 'Autre' ? `Autre (précisez le pourcentage) : ${clean.tempsTravail === 'Autre' ? clean.tempsTravailAutre : ''}` : o
    );
    radioGroup('- Temps de travail* :', ttOptions, ttSelected);
    radioGroup('- Type de contrat* :', OPTIONS.typeContrat, clean.typeContrat);
    radioGroup('- Statut cadre* :', OPTIONS.statutCadre, clean.statutCadre);
  }
  space(4);

  const objSelected = clean.objectif === 'Autre' && clean.objectifAutre
    ? `Autre : ${clean.objectifAutre}`
    : clean.objectif;
  const objOptions = OPTIONS.objectif.map(o =>
    o === 'Autre' ? `Autre${clean.objectif === 'Autre' && clean.objectifAutre ? ` : ${clean.objectifAutre}` : ''}` : o
  );
  radioGroup("Objectif poursuivi lors de l'inscription à la certification* :", objOptions,
    clean.objectif === 'Autre' && clean.objectifAutre ? `Autre : ${clean.objectifAutre}` : objSelected);

  /* ── Consentement ── */
  ensure(130);
  space(10);
  checkRow(
    "En envoyant ce formulaire, j'accepte les conditions relatives au traitement de mes",
    true
  );
  text("données personnelles et je m'engage à passer l'examen visant à l'obtention de la certification", { size: 10, x: MARGIN + 14 });
  text(`« ${CERT_RS6776.intitule} ».`, { size: 10, x: MARGIN + 14 });
  space(14);

  const horodatage = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(submittedAt);
  const tracabilite =
    `Consentement recueilli électroniquement le ${horodatage} (heure de Paris) via le formulaire ` +
    `sécurisé outils.eneko.ai${ip ? ` — adresse IP ${ip}` : ''}. Document généré automatiquement ` +
    `à partir des réponses du candidat / de la candidate.`;
  const boxLines = wrap(tracabilite, oblique, 8.5, A4.w - 2 * MARGIN - 24);
  const boxH = boxLines.length * 12 + 20;
  ensure(boxH);
  page.drawRectangle({
    x: MARGIN, y: y - boxH, width: A4.w - 2 * MARGIN, height: boxH,
    borderColor: LINE, borderWidth: 0.8,
  });
  let ty = y - 18;
  for (const line of boxLines) {
    page.drawText(line, { x: MARGIN + 12, y: ty, size: 8.5, font: oblique, color: SOFT });
    ty -= 12;
  }
  y -= boxH;

  return doc.save();
}
