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
// (`stagiaire` = celui sélectionné pour un document individuel)
export const DOCUMENTS = {
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

  'attestation': {
    label: 'Attestation de réalisation',
    templateId: () => process.env.GDOC_TPL_ATTESTATION || '1kxuJ3u6OUbS9_eFEhOrIvc-kRWHReiPP7t1yeWPNxA4',
    perStagiaire: true,
    fileName: (ctx) => `ATTESTATION — ${ctx.stagiaire?.nom || ctx.dossier.reference}`,
    fields: [
      { ph: '{{nom-apprenant}}', label: 'Apprenant', prefill: c => c.stagiaire?.nom || '', perStagiaire: true },
      { ph: '{{siret}}', label: 'SIRET (apprenant/entreprise, sinon —)', prefill: c => c.entreprise.siret || '—' },
      { ph: '{{nom-formation-1}}', label: 'Formation (ligne 1)', prefill: c => FORMATION_TITRES[c.dossier.typeFormation] || '' },
      { ph: '{{nom-formation-2}}', label: 'Formation (ligne 2, optionnel)', prefill: () => '' },
      { ph: '{{nom-formation-3}}', label: 'Formation (ligne 3, optionnel)', prefill: () => '' },
      // Champs automatiques, jamais montrés dans l'UI :
      { ph: '{{SIGNATURE-GRANDE}}', auto: (c) => c.stagiaire?.nom || '' },
      { ph: '{{DATE}}', auto: () => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short' }).format(new Date()) },
      { ph: '{{HEURE}}', auto: () => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', timeStyle: 'short' }).format(new Date()) },
    ],
  },
};

// Vue « registre » pour l'UI : champs pré-remplis, état des modèles.
export function buildRegistry(ctx) {
  return Object.entries(DOCUMENTS).map(([type, doc]) => {
    const templateId = doc.templateId();
    return {
      type,
      label: doc.label,
      enabled: !!templateId,
      templateHint: templateId ? '' : (doc.templateHint || ''),
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
