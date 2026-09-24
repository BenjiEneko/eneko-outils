// ════════════════════════════════════════════════════════════════
//  api/_lib/documents-dossiers.js  —  Registre des documents générables
//  depuis le cockpit (fusion de modèles Google Docs → PDF)
//
//  UNE source de vérité par document : le modèle Drive (mise en page,
//  aux mains de Déborah) + la spec ci-dessous (champs et leur
//  pré-remplissage depuis le CRM). Ajouter un document = ajouter une
//  entrée ici + créer le modèle dans Drive + partager avec le compte
//  de service. Les libellés de champs sont EXACTS (matchCase) : ils
//  doivent exister tels quels dans le modèle.
//
//  Modèles sans défaut (convention CPF, convocation) : l'entrée reste
//  visible dans le cockpit avec un état « modèle à préparer » tant que
//  la variable d'environnement du modèle n'est pas renseignée.
// ════════════════════════════════════════════════════════════════

import { renderCertificatRealisation, formatDuree } from './certificat-realisation.js';
import { createQuizLink } from './quiz-fin-rs6776.js';

// Intitulés longs des formations (pré-remplissage, modifiable dans l'UI).
const FORMATION_TITRES = {
  '🤖 IA Générative IAG':
    "Création de contenus rédactionnels et visuels par l'usage responsable de l'intelligence artificielle générative",
  '⚙️ IA Automatisation IAA':
    "Déployer des solutions d'automatisation par l'usage responsable d'outils no-code et d'agents IA",
};

const frDate = (iso) => iso
  ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  : '';
const euro = (n) => (n == null ? '' : `${n.toLocaleString('fr-FR')} € HT`);
const datesRange = (d) => d.dateDebut
  ? `du ${frDate(d.dateDebut)}${d.dateFin ? ` au ${frDate(d.dateFin)}` : ''}`
  : '';
const todayFr = () => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
// « CORNIC Claire » : forme NOM Prénom des documents officiels.
const nomOfficiel = (s) => s ? `${(s.nomUsage || '').toUpperCase()} ${s.prenom || ''}`.trim() || s.nom : '';
const DATE_FR = /^\d{2}\/\d{2}\/\d{4}$/;
// 21 → « 21 heures » (pré-remplissage des conventions depuis le dossier).
const heuresTexte = (n) => (n == null ? '' : `${String(n).replace('.', ',')} heures`);
// « 21 heures », « 17h30 », « 17,5 » → nombre d'heures (null si illisible).
export function parseHeures(texte) {
  const s = String(texte ?? '').trim();
  if (!s) return null;
  const hm = s.match(/^(\d{1,3})\s*h\s*(\d{1,2})?\s*(?:min)?\.?$/i);
  if (hm) return Number(hm[1]) + (hm[2] ? Number(hm[2]) / 60 : 0);
  const m = s.match(/(\d{1,3}(?:[.,]\d{1,2})?)/);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n <= 2000 ? Math.round(n * 100) / 100 : null;
}

// ctx : { dossier, entreprise: {nom, siret, adresse}, stagiaires: [{nom,…}], stagiaire }
// (`stagiaire` = celui sélectionné pour un document individuel :
//  { id, nom, prenom, nomUsage, email, telephone, poste })
export const DOCUMENTS = {
  // Cas particulier : pas une fusion de modèle mais le LIEN candidat du
  // dossier d'inscription InKréa (formulaire pré-rempli, PDF généré à la
  // soumission par /api/dossier-submit). Réservé aux parcours RS6776.
  'dossier-rs6776': {
    kind: 'lien',
    label: "Dossier d'inscription RS6776 (InKréa) — lien candidat",
    enabledFor: (ctx) => !/IAA/.test(ctx.dossier.typeFormation || ''),
    disabledHint:
      "Le dossier InKréa concerne la certification RS6776 (parcours IA générative) — " +
      "la certification Automatisation est en cours d'obtention.",
    perStagiaire: true,
    fields: [
      { ph: 'prenom', label: 'Prénom', prefill: c => c.stagiaire?.prenom || '', perStagiaire: true },
      { ph: 'nomUsage', label: "Nom d'usage", prefill: c => c.stagiaire?.nomUsage || '', perStagiaire: true },
      { ph: 'email', label: 'Email', prefill: c => c.stagiaire?.email || '', perStagiaire: true },
      { ph: 'telephone', label: 'Téléphone', prefill: c => c.stagiaire?.telephone || '', perStagiaire: true },
      { ph: 'intitulePoste', label: 'Intitulé du poste', prefill: c => c.stagiaire?.poste || '', perStagiaire: true },
      { ph: 'nomEntreprise', label: 'Entreprise', prefill: c => c.entreprise.nom },
    ],
  },

  // Lien apprenant du quiz de fin de formation RS6776 (remplace Edusign) :
  // formulaire hébergé sur /quiz-fin-formation, notation serveur, PDF horodaté
  // → Drive du dossier + base Notion QUIZ FIN DE FORMATION + Slack
  // (voir _lib/quiz-fin-rs6776.js et /api/quiz-fin-submit).
  'quiz-fin-rs6776': {
    kind: 'lien',
    label: 'Quiz de fin de formation RS6776 — lien apprenant',
    enabledFor: (ctx) => !/IAA/.test(ctx.dossier.typeFormation || ''),
    disabledHint: 'Le quiz de fin de formation RS6776 concerne le parcours IA générative.',
    perStagiaire: true,
    createLink: (prefill, ctx) => createQuizLink(prefill, ctx),
    trace: (pf) => `🎯 Quiz de fin de formation RS6776 — lien apprenant généré pour ${pf.prenom} ${pf.nom}`,
    fields: [
      { ph: 'prenom', label: 'Prénom', prefill: c => c.stagiaire?.prenom || '', perStagiaire: true },
      { ph: 'nom', label: 'Nom', prefill: c => c.stagiaire?.nomUsage || '', perStagiaire: true },
      { ph: 'email', label: 'Email', prefill: c => (c.stagiaire?.email || '').split(/[\s,;]+/)[0], perStagiaire: true },
    ],
  },

  // Cas particulier : PDF généré NATIVEMENT (pdf-lib), sans modèle Google Docs.
  // Le certificat de réalisation est un formulaire réglementaire (ministère du
  // Travail) à mise en page fixe, reproduit depuis le certificat de référence
  // (voir _lib/certificat-realisation.js). Toujours disponible : aucune config.
  'certificat-realisation': {
    kind: 'pdf',
    label: 'Certificat de réalisation (modèle ministère du Travail)',
    perStagiaire: true,
    fileName: (ctx) => `CERTIFICAT_REALISATION — ${nomOfficiel(ctx.stagiaire) || ctx.dossier.reference}`,
    fields: [
      { ph: 'stagiaire', label: 'Stagiaire (NOM Prénom)', prefill: c => nomOfficiel(c.stagiaire), perStagiaire: true },
      { ph: 'formation', label: 'Intitulé de la formation', prefill: c => FORMATION_TITRES[c.dossier.typeFormation] || '' },
      { ph: 'dateDebut', label: 'Début de la formation (JJ/MM/AAAA)', prefill: c => frDate(c.dossier.dateDebut) },
      { ph: 'dateFin', label: 'Fin de la formation (JJ/MM/AAAA)', prefill: c => frDate(c.dossier.dateFin) },
      // Durée de la CONVENTION (« Durée convention (h) » du dossier, écrite à la
      // génération d'une convention, modifiable dans la fiche) ; à défaut, les
      // heures « Présent » du registre d'assiduité pour ce stagiaire.
      { ph: 'duree', label: 'Durée totale en heures (reprise de la convention, ex. 21 ou 17,5)',
        prefill: c => (c.dossier.dureeConvention != null ? String(c.dossier.dureeConvention)
          : c.heuresPresentes ? String(c.heuresPresentes) : '').replace('.', ','), perStagiaire: true },
      { ph: 'signataire', label: 'Signataire (représentant légal)', prefill: () => 'Benjamin SEGURA' },
      { ph: 'qualite', label: 'Qualité du signataire', prefill: () => 'Gérant Eneko' },
      { ph: 'lieu', label: 'Fait à', prefill: () => 'LE TEICH' },
      { ph: 'dateEmission', label: "Date d'émission (JJ/MM/AAAA)", prefill: () => todayFr() },
    ],
    // Message d'erreur (français) ou null.
    validate: (v) => {
      if (!v.stagiaire) return 'Le nom du stagiaire est obligatoire.';
      if (!v.formation) return "L'intitulé de la formation est obligatoire.";
      for (const [k, l] of [['dateDebut', 'de début'], ['dateFin', 'de fin'], ['dateEmission', "d'émission"]]) {
        if (!DATE_FR.test(v[k] || '')) return `La date ${l} doit être au format JJ/MM/AAAA.`;
      }
      if (!formatDuree(v.duree)) return 'La durée totale est obligatoire (ex. 17 ou 17,5).';
      return null;
    },
    render: (v) => renderCertificatRealisation({
      ...v,
      organisme: 'Eneko',
      nature: 'action de formation',
      duree: formatDuree(v.duree),
    }),
  },

  'convention-opco': {
    label: 'Convention de formation — OPCO / intra',
    templateId: () => process.env.GDOC_TPL_CONVENTION_OPCO || '1GWUd11oNJp8j69qE9sFrKF0eQuurW00f5nIVuoUBZb8',
    perStagiaire: false,
    fileName: (ctx) => `CONVENTION_OPCO — ${ctx.dossier.reference}`,
    // Après génération : la durée saisie devient « Durée convention (h) » du dossier.
    persistDuree: '{DURÉE}',
    fields: [
      { ph: '{ENTREPRISE}', label: 'Entreprise', prefill: c => c.entreprise.nom },
      { ph: '{ADRESSE}', label: "Adresse de l'entreprise", prefill: c => c.entreprise.adresse },
      { ph: '{SIRET}', label: 'SIRET', prefill: c => c.entreprise.siret },
      { ph: '{FORMATION}', label: 'Intitulé de la formation', prefill: c => FORMATION_TITRES[c.dossier.typeFormation] || '' },
      { ph: '{DURÉE}', label: 'Durée (ex. 21 heures)', prefill: c => heuresTexte(c.dossier.dureeConvention) },
      { ph: '{NB-SALARIES}', label: 'Participants (noms ou nombre)', prefill: c => c.stagiaires.map(s => s.nom).join(', ') },
      { ph: '{DATE}', label: 'Dates de la formation', prefill: c => datesRange(c.dossier) },
      { ph: '{PRIX}', label: 'Coût pédagogique', prefill: c => euro(c.dossier.montantHT) },
      { ph: '{OPCO}', label: "Nom de l'OPCO", prefill: () => '' },
    ],
  },

  'convention-cpf': {
    label: 'Convention de formation — CPF individuel',
    templateId: () => process.env.GDOC_TPL_CONVENTION_CPF || null,
    templateHint:
      'Dupliquer une convention CPF existante, remplacer les valeurs par les champs ' +
      '{{STAGIAIRE}} {{ADRESSE-STAGIAIRE}} {{FORMATION}} {{DUREE}} {{DATES}} {{PRIX}}, ' +
      "puis renseigner GDOC_TPL_CONVENTION_CPF avec l'ID du document.",
    perStagiaire: true,
    fileName: (ctx) => `CONVENTION_CPF — ${ctx.stagiaire?.nom || ctx.dossier.reference}`,
    persistDuree: '{{DUREE}}',
    fields: [
      { ph: '{{STAGIAIRE}}', label: 'Stagiaire', prefill: c => c.stagiaire?.nom || '', perStagiaire: true },
      { ph: '{{ADRESSE-STAGIAIRE}}', label: 'Adresse du stagiaire', prefill: () => '' },
      { ph: '{{FORMATION}}', label: 'Intitulé de la formation', prefill: c => FORMATION_TITRES[c.dossier.typeFormation] || '' },
      { ph: '{{DUREE}}', label: 'Durée (ex. 21 heures)', prefill: c => heuresTexte(c.dossier.dureeConvention) },
      { ph: '{{DATES}}', label: 'Dates de la formation', prefill: c => datesRange(c.dossier) },
      { ph: '{{PRIX}}', label: 'Coût pédagogique', prefill: c => euro(c.dossier.montantHT) },
    ],
  },

  'convocation': {
    label: 'Convocation / entrée en formation',
    templateId: () => process.env.GDOC_TPL_CONVOCATION || null,
    templateHint:
      'Créer le modèle de convocation avec les champs ' +
      '{{STAGIAIRE}} {{FORMATION}} {{SESSION}} {{DATES}} {{LIEU-OU-LIEN}} {{DATE-ELEARNING}}, ' +
      "puis renseigner GDOC_TPL_CONVOCATION avec l'ID du document.",
    perStagiaire: true,
    fileName: (ctx) => `CONVOCATION — ${ctx.stagiaire?.nom || ctx.dossier.reference}`,
    fields: [
      { ph: '{{STAGIAIRE}}', label: 'Stagiaire', prefill: c => c.stagiaire?.nom || '', perStagiaire: true },
      { ph: '{{FORMATION}}', label: 'Formation', prefill: c => FORMATION_TITRES[c.dossier.typeFormation] || '' },
      { ph: '{{SESSION}}', label: 'Session', prefill: c => c.dossier.session },
      { ph: '{{DATES}}', label: 'Dates', prefill: c => datesRange(c.dossier) },
      { ph: '{{LIEU-OU-LIEN}}', label: 'Lieu ou lien visio', prefill: () => '' },
      { ph: '{{DATE-ELEARNING}}', label: 'Ouverture e-learning', prefill: c => frDate(c.dossier.dateDebut) },
    ],
  },

  // ⚠️ L'ancien « Modèle Attestation Vierge » (sur l'honneur, BPI/FranceNum)
  // ne sert plus (décision Benjamin 2026-09-05) : entrée désactivée tant
  // qu'un vrai modèle d'attestation de fin de formation n'existe pas.
  'attestation': {
    label: 'Attestation de fin de formation',
    templateId: () => process.env.GDOC_TPL_ATTESTATION || null,
    templateHint:
      "Créer le modèle d'attestation de fin de formation avec les champs " +
      '{{STAGIAIRE}} {{FORMATION}} {{DATES}} {{DUREE}} {{DATE-EMISSION}}, ' +
      "puis renseigner GDOC_TPL_ATTESTATION avec l'ID du document.",
    perStagiaire: true,
    fileName: (ctx) => `ATTESTATION — ${ctx.stagiaire?.nom || ctx.dossier.reference}`,
    fields: [
      { ph: '{{STAGIAIRE}}', label: 'Stagiaire', prefill: c => c.stagiaire?.nom || '', perStagiaire: true },
      { ph: '{{FORMATION}}', label: 'Formation', prefill: c => FORMATION_TITRES[c.dossier.typeFormation] || '' },
      { ph: '{{DATES}}', label: 'Dates', prefill: c => datesRange(c.dossier) },
      { ph: '{{DUREE}}', label: 'Durée (ex. 21 heures)', prefill: c => heuresTexte(c.dossier.dureeConvention) },
      { ph: '{{DATE-EMISSION}}', auto: () => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long' }).format(new Date()) },
    ],
  },
};

// Vue « registre » pour l'UI : champs pré-remplis, état des modèles.
export function buildRegistry(ctx) {
  return Object.entries(DOCUMENTS).map(([type, doc]) => {
    const isLink = doc.kind === 'lien';
    const isPdf = doc.kind === 'pdf';
    const enabled = isLink ? doc.enabledFor(ctx) : isPdf ? true : !!doc.templateId();
    return {
      type,
      kind: isLink ? 'lien' : isPdf ? 'pdf' : 'document',
      label: doc.label,
      enabled,
      templateHint: enabled ? '' : (isLink ? doc.disabledHint : doc.templateHint) || '',
      perStagiaire: !!doc.perStagiaire,
      fields: doc.fields
        .filter(f => !f.auto)
        .map(f => ({
          ph: f.ph,
          label: f.label,
          perStagiaire: !!f.perStagiaire,
          value: (() => { try { return f.prefill(ctx) || ''; } catch { return ''; } })(),
        })),
    };
  });
}
