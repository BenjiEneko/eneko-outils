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

  'convention-opco': {
    label: 'Convention de formation — OPCO / intra',
    templateId: () => process.env.GDOC_TPL_CONVENTION_OPCO || '1GWUd11oNJp8j69qE9sFrKF0eQuurW00f5nIVuoUBZb8',
    perStagiaire: false,
    fileName: (ctx) => `CONVENTION_OPCO — ${ctx.dossier.reference}`,
    fields: [
      { ph: '{ENTREPRISE}', label: 'Entreprise', prefill: c => c.entreprise.nom },
      { ph: '{ADRESSE}', label: "Adresse de l'entreprise", prefill: c => c.entreprise.adresse },
      { ph: '{SIRET}', label: 'SIRET', prefill: c => c.entreprise.siret },
      { ph: '{FORMATION}', label: 'Intitulé de la formation', prefill: c => FORMATION_TITRES[c.dossier.typeFormation] || '' },
      { ph: '{DURÉE}', label: 'Durée (ex. 21 heures)', prefill: () => '' },
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
    fields: [
      { ph: '{{STAGIAIRE}}', label: 'Stagiaire', prefill: c => c.stagiaire?.nom || '', perStagiaire: true },
      { ph: '{{ADRESSE-STAGIAIRE}}', label: 'Adresse du stagiaire', prefill: () => '' },
      { ph: '{{FORMATION}}', label: 'Intitulé de la formation', prefill: c => FORMATION_TITRES[c.dossier.typeFormation] || '' },
      { ph: '{{DUREE}}', label: 'Durée (ex. 21 heures)', prefill: () => '' },
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
      { ph: '{{DATE-ELEARNING}}', label: 'Ouverture e-learning', prefill: c => frDate(c.dossier.dateElearning) },
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
      { ph: '{{DUREE}}', label: 'Durée (ex. 21 heures)', prefill: () => '' },
      { ph: '{{DATE-EMISSION}}', auto: () => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long' }).format(new Date()) },
    ],
  },
};

// Vue « registre » pour l'UI : champs pré-remplis, état des modèles.
export function buildRegistry(ctx) {
  return Object.entries(DOCUMENTS).map(([type, doc]) => {
    const isLink = doc.kind === 'lien';
    const enabled = isLink ? doc.enabledFor(ctx) : !!doc.templateId();
    return {
      type,
      kind: isLink ? 'lien' : 'document',
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
