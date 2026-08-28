// ════════════════════════════════════════════════════════════════
//  api/_lib/pricing.js  —  Grille tarifaire du calculateur chatbot
//
//  ⚠️ SOURCE DE VÉRITÉ UNIQUE, CÔTÉ SERVEUR UNIQUEMENT.
//  Ce fichier ne doit JAMAIS être importé par une page : les prix
//  unitaires, la charge en jours, le TJM et la logique de marge
//  étaient auparavant lisibles dans le HTML public via
//  /simulateur-chatbot ("Afficher la source").
//
//  Le prospect ne reçoit qu'une FOURCHETTE et des libellés ;
//  le détail (prix unitaires, jours, marge) n'est renvoyé qu'à une
//  session interne authentifiée.
// ════════════════════════════════════════════════════════════════

/* ── Paramètres généraux ──────────────────────────────────────── */

export const BASE = 1900;          // socle (inclut charte graphique + transfert agent humain)
export const TJM_DEFAUT = 600;
export const URGENCE_PCT = 0.15;
export const HEURES_ETP_AN = 1600; // heures travaillées / an pour 1 ETP
export const JOURS_BASE = 1.5;     // socle de mise en place (config, déploiement, tests)

// Coût horaire chargé d'un collaborateur (salaire + charges), utilisé
// uniquement pour convertir le temps gagné en euros dans l'argumentaire ROI.
export const COUT_HORAIRE_CHARGE = 35;

// Largeur de la fourchette montrée au prospect (±12 %).
const FOURCHETTE_PCT = 0.12;

// Dégressivité sur les briques optionnelles (intégrations, canaux, options).
// Rationnel réel : le socle technique — authentification, mapping des données,
// recette, documentation — est mutualisé dès la 2e brique. Sans elle, l'addition
// linéaire faisait grimper le devis très vite, ce qui décourage les prospects.
// Les briques sont triées par prix décroissant : la plus lourde reste au plein tarif.
const DEGRESSIVITE = [1, 0.8, 0.65, 0.55]; // 1re : plein tarif, 2e : −20 %, 3e : −35 %, 4e et + : −45 %

/* ── Catalogue ────────────────────────────────────────────────── */

export const MOTEUR = {
  script:     { label: 'Script de qualification', prix: 0,    jours: 0,   retSocle: 80 },
  rag:        { label: 'RAG sur documents métier', prix: 1200, jours: 1,   retSocle: 150 },
  rag_script: { label: 'RAG + script combinés',    prix: 1600, jours: 1.5, retSocle: 180 },
};

export const INTEG = {
  crm:       { label: 'CRM (HubSpot, Pipedrive, Salesforce)',  prix: 600,  ret: 40, jours: 1 },
  agenda:    { label: 'Prise de RDV (Cal.com, Calendly)',      prix: 450,  ret: 30, jours: 0.75 },
  notif:     { label: 'Notif Slack / Teams / email',           prix: 250,  ret: 15, jours: 0.5 },
  db:        { label: 'Base de données / SI métier',           prix: 1100, ret: 55, jours: 2 },
  ecommerce: { label: 'E-commerce (Shopify, WooCommerce)',     prix: 900,  ret: 45, jours: 1.5 },
  ticketing: { label: 'Helpdesk / ticketing (Zendesk…)',       prix: 750,  ret: 40, jours: 1.5 },
  paiement:  { label: 'Paiement (Stripe)',                     prix: 700,  ret: 40, jours: 1 },
  sheets:    { label: 'Google Sheets / Airtable',              prix: 300,  ret: 20, jours: 0.5 },
  kb:        { label: 'Sources documentaires (Notion, Drive)', prix: 500,  ret: 35, jours: 1 },
  handoff:   { label: 'Transfert vers agent humain (inclus)',  prix: 0,    ret: 0,  jours: 0.5 },
  api:       { label: 'API métier sur mesure',                 prix: 1400, ret: 65, jours: 2.5 },
  webhook:   { label: 'Webhook / n8n (automatisations)',       prix: 400,  ret: 25, jours: 1 },
};

export const CANAUX = {
  whatsapp:  { label: 'WhatsApp Business',        prix: 900,  ret: 55, jours: 1.5 },
  messenger: { label: 'Messenger / Instagram DM', prix: 750,  ret: 45, jours: 1.5 },
  telegram:  { label: 'Telegram',                 prix: 500,  ret: 30, jours: 1 },
  teams:     { label: 'Slack / Teams (interne)',  prix: 700,  ret: 40, jours: 1.5 },
  email:     { label: 'Email automatisé',         prix: 500,  ret: 30, jours: 1 },
  mobile:    { label: 'Intégration app mobile',   prix: 1200, ret: 55, jours: 2 },
};

export const OPTIONS = {
  multilingue: { label: 'Multilingue',                            prix: 700, ret: 35, jours: 1 },
  design:      { label: 'Charte graphique / design (inclus)',     prix: 0,   ret: 0,  jours: 0.5 },
  voix_io:     { label: 'Entrée / sortie vocale (STT-TTS)',       prix: 900, ret: 45, jours: 1.5 },
  analytics:   { label: 'Dashboard analytics & reporting',        prix: 650, ret: 50, jours: 1 },
  memoire:     { label: 'Mémoire / personnalisation utilisateur', prix: 700, ret: 35, jours: 1.5 },
  abtest:      { label: 'A/B testing des réponses',               prix: 500, ret: 25, jours: 1 },
  rgpd:        { label: 'Hébergement EU / conformité RGPD',       prix: 600, ret: 35, jours: 1 },
};

export const VOLUME = {
  faible:     { label: '< 500 conv / mois',          api: 15,  hosting: 20 },
  moyen:      { label: '500 - 2 000 conv / mois',    api: 40,  hosting: 40 },
  eleve:      { label: '2 000 - 10 000 conv / mois', api: 150, hosting: 100 },
  tres_eleve: { label: '> 10 000 conv / mois',       api: 600, hosting: 300 },
};

export const CONFIG_DEFAUT = {
  usage: 'externe',
  moteur: 'rag',
  integrations: ['notif', 'handoff'],
  canaux: [],
  options: ['design'],
  volume: 'moyen',
  urgence: false,
  roi: { convMois: 800, minutesParConv: 6, tauxAuto: 70 },
  synthese: '',
};

/* ── Catalogues exposés au client ─────────────────────────────── */

// Version publique : libellés seuls. Le champ `inclus` permet au front
// d'afficher « inclus » sans connaître les prix.
function sansPrix(cat) {
  return Object.fromEntries(
    Object.entries(cat).map(([k, v]) => [k, { label: v.label, inclus: v.prix === 0 }])
  );
}

export function cataloguePublic() {
  return {
    moteur: sansPrix(MOTEUR),
    integrations: sansPrix(INTEG),
    canaux: sansPrix(CANAUX),
    options: sansPrix(OPTIONS),
    volume: Object.fromEntries(Object.entries(VOLUME).map(([k, v]) => [k, { label: v.label }])),
  };
}

export function catalogueComplet() {
  return {
    moteur: MOTEUR,
    integrations: INTEG,
    canaux: CANAUX,
    options: OPTIONS,
    // Le prospect ne voit jamais le coût refacturé ; l'interne oui.
    volume: Object.fromEntries(
      Object.entries(VOLUME).map(([k, v]) => [k, { ...v, refacture: v.api + v.hosting }])
    ),
    urgencePct: URGENCE_PCT,
  };
}

/* ── Normalisation d'une config reçue du client ───────────────── */

export function normaliserConfig(cfg) {
  const c = cfg || {};
  const roiIn = c.roi || {};
  const num = (v, def, min, max) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.max(min, Math.min(max, n));
  };
  let taux = Number(roiIn.tauxAuto);
  if (!Number.isFinite(taux)) taux = CONFIG_DEFAUT.roi.tauxAuto;
  if (taux > 0 && taux <= 1) taux *= 100;              // fraction → pourcentage
  taux = Math.max(0, Math.min(100, Math.round(taux)));

  const keys = (arr, cat) =>
    Array.isArray(arr) ? [...new Set(arr.filter(k => cat[k]))].slice(0, 40) : [];

  return {
    usage: c.usage === 'interne' ? 'interne' : 'externe',
    moteur: MOTEUR[c.moteur] ? c.moteur : CONFIG_DEFAUT.moteur,
    volume: VOLUME[c.volume] ? c.volume : CONFIG_DEFAUT.volume,
    integrations: keys(c.integrations, INTEG),
    canaux: keys(c.canaux, CANAUX),
    options: keys(c.options, OPTIONS),
    urgence: !!c.urgence,
    roi: {
      convMois: num(roiIn.convMois, CONFIG_DEFAUT.roi.convMois, 0, 1_000_000),
      minutesParConv: num(roiIn.minutesParConv, CONFIG_DEFAUT.roi.minutesParConv, 0, 600),
      tauxAuto: taux,
    },
    synthese: typeof c.synthese === 'string' ? c.synthese.slice(0, 1000) : '',
  };
}

/* ── Calcul ───────────────────────────────────────────────────── */

// Applique la dégressivité à une liste de prix de briques optionnelles.
function sommeDegressive(prix) {
  return prix
    .filter(p => p > 0)
    .sort((a, b) => b - a)
    .reduce((total, p, i) => {
      const coef = DEGRESSIVITE[Math.min(i, DEGRESSIVITE.length - 1)];
      return total + p * coef;
    }, 0);
}

const arrondiBas = n => Math.floor(n / 100) * 100;
const arrondiHaut = n => Math.ceil(n / 100) * 100;

export function calculer(config, { tjm = TJM_DEFAUT, overrides = {} } = {}) {
  const c = normaliserConfig(config);

  const briques = [
    ...c.integrations.map(k => INTEG[k]),
    ...c.canaux.map(k => CANAUX[k]),
    ...c.options.map(k => OPTIONS[k]),
  ];

  const setupBriques = sommeDegressive(briques.map(b => b.prix));
  const setupHT = BASE + MOTEUR[c.moteur].prix + setupBriques;
  const setupAuto = Math.round(setupHT * (c.urgence ? 1 + URGENCE_PCT : 1));

  const joursAuto =
    JOURS_BASE + MOTEUR[c.moteur].jours + briques.reduce((s, b) => s + b.jours, 0);

  const retainerAuto =
    MOTEUR[c.moteur].retSocle + briques.reduce((s, b) => s + b.ret, 0);

  const refacture = VOLUME[c.volume].api + VOLUME[c.volume].hosting;

  // Overrides internes (le commercial peut forcer un montant).
  const nOr = (v, def) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? def : Number(v));
  const setupFinal = Math.max(0, nOr(overrides.setup, setupAuto));
  const retainerFinal = Math.max(0, nOr(overrides.retainer, retainerAuto));
  const jours = Math.max(0, nOr(overrides.jours, joursAuto));

  const tjmSafe = Number.isFinite(Number(tjm)) ? Math.max(0, Number(tjm)) : TJM_DEFAUT;
  const coutInterne = jours * tjmSafe;
  const marge = setupFinal - coutInterne;
  const margePct = setupFinal > 0 ? (marge / setupFinal) * 100 : 0;
  const niveau = setupFinal < 4000 ? 1 : setupFinal <= 8500 ? 2 : 3;
  const annee1 = setupFinal + (retainerFinal + refacture) * 12;

  // ROI
  const r = c.roi;
  const heuresMois = (r.convMois * r.minutesParConv * (r.tauxAuto / 100)) / 60;
  const heuresAn = heuresMois * 12;
  const etp = heuresAn / HEURES_ETP_AN;
  const economieMois = heuresMois * COUT_HORAIRE_CHARGE;
  const economieAn = economieMois * 12;
  const coutMensuel = retainerFinal + refacture;
  const gainNetMois = economieMois - coutMensuel;
  // Nombre de mois pour absorber le setup avec le gain net mensuel.
  const retourMois = gainNetMois > 0 ? setupFinal / gainNetMois : null;

  return {
    config: c,
    setupAuto, setupFinal, retainerAuto, retainerFinal, refacture,
    joursAuto, jours, coutInterne, marge, margePct, niveau, annee1,
    roi: { heuresMois, heuresAn, etp, economieMois, economieAn, gainNetMois, retourMois },
    fourchette: {
      setupMin: arrondiBas(setupFinal * (1 - FOURCHETTE_PCT)),
      setupMax: arrondiHaut(setupFinal * (1 + FOURCHETTE_PCT)),
      retainerMin: Math.max(0, Math.round((retainerFinal + refacture) * (1 - FOURCHETTE_PCT) / 10) * 10),
      retainerMax: Math.round((retainerFinal + refacture) * (1 + FOURCHETTE_PCT) / 10) * 10,
    },
  };
}

/* ── Vues ─────────────────────────────────────────────────────── */

// Vue prospect : aucune donnée interne (ni prix unitaires, ni jours, ni marge,
// ni TJM, ni total année 1). Uniquement une fourchette et l'argumentaire ROI.
export function vueProspect(res) {
  const { roi, fourchette } = res;
  return {
    mode: 'prospect',
    catalogue: cataloguePublic(),
    config: res.config,
    fourchette,
    roi: {
      etp: roi.etp,
      heuresMois: roi.heuresMois,
      heuresAn: roi.heuresAn,
      economieAn: Math.round(roi.economieAn),
      retourMois: roi.retourMois === null ? null : Math.round(roi.retourMois * 10) / 10,
      coutHoraire: COUT_HORAIRE_CHARGE,
    },
  };
}

// Note stratégique interne. Elle vit ici et non dans la page : même
// masquée par une condition d'affichage, une chaîne présente dans le
// bundle reste lisible par n'importe quel visiteur.
const NOTE_INTERNE =
  "Ce chatbot est une porte d'entrée. L'objectif réel : basculer ce client vers " +
  'une formation OPCO ou un groupe, où se fait la marge récurrente.';

// Vue interne : tout, y compris marge, charge et note stratégique.
export function vueInterne(res) {
  return {
    mode: 'interne',
    catalogue: catalogueComplet(),
    tjmDefaut: TJM_DEFAUT,
    noteInterne: NOTE_INTERNE,
    ...res,
  };
}
