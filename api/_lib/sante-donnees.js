// ════════════════════════════════════════════════════════════════
//  api/_lib/sante-donnees.js  —  Santé des données du CRM
//
//  Deux volets, servis par l'onglet « Santé » du cockpit :
//   1. CONTRÔLES sur la base DOSSIERS/CONTACTS (dossier sans stagiaire,
//      sans type, doublons probables, stagiaire sans email, en formation
//      sans session ni compte Circle…) — chaque anomalie porte, quand c'est
//      possible, une correction en un clic (`fix`) qui réutilise les actions
//      d'écriture existantes du cockpit.
//   2. RAPPROCHEMENT avec le suivi historique de Déborah (base Notion
//      « Suivi FORMATIONS ENEKO 2026 (déborah) », 2 tables stagiaires) :
//      ses lignes sont souvent plus à jour que le cockpit sur certains
//      dossiers. On rapproche par email puis par nom, et on liste les
//      ÉCARTS champ par champ avec « reprendre la valeur ».
//
//  Rien n'est écrit ici : ce module ne fait que lire et proposer.
// ════════════════════════════════════════════════════════════════

import { DB, queryAll, queryDataSource, listCrm, plain, sel, dateStart, rel } from './notion-crm.js';
import { readSnapshot } from './elearning-snapshot.js';

// Tables du suivi de Déborah (base 2e0d56ab…804d). Override possible par env.
export const SUIVI_DEBORAH = {
  cpf: process.env.NOTION_DS_SUIVI_CPF || '2e0d56ab-9c9a-8006-8bb7-000bd880adb1',
  nonCpf: process.env.NOTION_DS_SUIVI_NONCPF || '2e0d56ab-9c9a-803f-8e40-000bc9734a25',
};

const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Clé de nom insensible à l'ordre « Prénom NOM » / « NOM Prénom ».
const cleNom = (t) => norm(t).split(' ').filter(Boolean).sort().join(' ');
const isClos = (d) => /Clôturé|Refusé/.test(d.etape || '');
const isEnFormation = (d) => /En formation|Convocation envoyée|Formation terminée/.test(d.etape || '');
const jour = (iso) => (iso || '').slice(0, 10);
const nombre = (t) => {
  const m = String(t || '').replace(/\s/g, '').replace(',', '.').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};

/* ─── 1. Contrôles ───────────────────────────────────────────── */

function controles({ dossiers, contacts, sessionsParDossier, snapshot }) {
  const items = [];
  const push = (o) => items.push({ gravite: 'moyenne', ...o });
  const refD = (d) => ({ dossierId: d.id, reference: d.reference || '(sans référence)', stagiaires: d.stagiaires, etape: d.etape || '', notionUrl: d.url });

  // Doublons de dossiers : même stagiaire sur plusieurs dossiers ouverts,
  // ou paire « préfixe- » / « préfixe-Nom » créée à la même minute.
  const parStagiaire = new Map();
  for (const d of dossiers) if (!isClos(d)) for (const id of d.stagiaireIds) {
    if (!parStagiaire.has(id)) parStagiaire.set(id, []);
    parStagiaire.get(id).push(d);
  }
  for (const [id, list] of parStagiaire) if (list.length > 1) {
    push({ type: 'doublon-stagiaire', gravite: 'haute', ...refD(list[0]),
      detail: `${contacts[id]?.nom || '?'} est stagiaire de ${list.length} dossiers ouverts : ${list.map(d => d.reference).join(', ')}`,
      lies: list.map(d => ({ dossierId: d.id, reference: d.reference })) });
  }
  const parMinute = new Map();
  for (const d of dossiers) {
    const k = (d.createdTime || '').slice(0, 16);
    if (!parMinute.has(k)) parMinute.set(k, []);
    parMinute.get(k).push(d);
  }
  for (const list of parMinute.values()) if (list.length > 1) {
    const coquilles = list.filter(d => !d.stagiaireIds.length && d.montantHT == null && !d.notes && !d.dateDebut);
    for (const c of coquilles) push({ type: 'coquille-vide', gravite: 'haute', ...refD(c),
      detail: `Créé à la même minute que ${list.filter(x => x !== c).map(x => x.reference).join(', ')} et vide : doublon probable`,
      fix: { action: 'corbeille', label: 'Mettre à la corbeille', payload: { dossierId: c.id } } });
  }

  for (const d of dossiers) {
    const actif = !isClos(d);
    if (!d.stagiaireIds.length) push({ type: 'sans-stagiaire', gravite: actif ? 'haute' : 'basse', ...refD(d),
      detail: 'Aucun stagiaire relié : ni e-learning, ni documents, ni émargement possibles',
      fix: { action: 'ouvrir-fiche', label: 'Relier un stagiaire', payload: { dossierId: d.id } } });
    if (!actif) continue;
    if (!d.etape) push({ type: 'sans-etape', gravite: 'haute', ...refD(d), detail: 'Dossier sans étape : invisible dans « Ma journée » et les relances',
      fix: { action: 'ouvrir-fiche', label: 'Qualifier', payload: { dossierId: d.id } } });
    if (!d.typeFormation) push({ type: 'sans-type', ...refD(d), detail: 'Type de formation manquant (documents et e-learning en dépendent)',
      fix: { action: 'ouvrir-fiche', label: 'Compléter', payload: { dossierId: d.id } } });
    if (!d.financement) push({ type: 'sans-financement', ...refD(d), detail: 'Financement non renseigné',
      fix: { action: 'ouvrir-fiche', label: 'Compléter', payload: { dossierId: d.id } } });
    for (const s of d.stagiairesDetail) if (!s.email) push({ type: 'stagiaire-sans-email', gravite: 'haute', ...refD(d),
      detail: `${s.nom} : pas d'email sur la fiche contact (convocation, e-learning, relances impossibles)`,
      fix: { action: 'ouvrir-fiche', label: 'Renseigner', payload: { dossierId: d.id } } });
    if (d.dateDebut && d.dateFin && jour(d.dateFin) < jour(d.dateDebut)) push({ type: 'dates-incoherentes', ...refD(d),
      detail: `Fin (${jour(d.dateFin)}) avant début (${jour(d.dateDebut)})`, fix: { action: 'ouvrir-fiche', label: 'Corriger', payload: { dossierId: d.id } } });
    if (isEnFormation(d)) {
      if (!d.dateDebut) push({ type: 'sans-date-debut', ...refD(d), detail: 'En formation sans date de début',
        fix: { action: 'ouvrir-fiche', label: 'Dater', payload: { dossierId: d.id } } });
      if (!(sessionsParDossier.get(d.id) || 0)) push({ type: 'sans-session-planning', ...refD(d),
        detail: 'Aucune session du Planning ne relie ce dossier : pas d\'émargement possible', notionUrl: d.url });
      const e = snapshot?.results?.[d.id];
      if (d.plateforme !== 'Digiforma' && e?.statut === 'non-membre') push({ type: 'circle-non-inscrit', ...refD(d),
        detail: 'En formation mais aucun compte Circle avec l\'email connu (vérifier « Email e-learning » ou créer l\'accès)',
        fix: { action: 'ouvrir-fiche', label: 'Voir la fiche', payload: { dossierId: d.id } } });
      if (d.plateforme !== 'Digiforma' && e?.statut === 'ok' && e.pct === 0 && d.dateDebut && (Date.now() - new Date(d.dateDebut)) > 14 * 86400000)
        push({ type: 'circle-zero', gravite: 'basse', ...refD(d), detail: 'Formation démarrée depuis plus de 14 jours, e-learning à 0 %' });
    }
  }

  // Contacts en double (même email) — seulement ceux reliés à un dossier.
  const parEmail = new Map();
  for (const c of Object.values(contacts)) if (c.email) {
    const k = c.email.toLowerCase();
    if (!parEmail.has(k)) parEmail.set(k, []);
    parEmail.get(k).push(c);
  }
  const relies = new Set(dossiers.flatMap(d => d.stagiaireIds));
  for (const [emailK, list] of parEmail) if (list.length > 1 && list.some(c => relies.has(c.id))) {
    push({ type: 'contact-doublon', gravite: 'basse', reference: emailK, stagiaires: list.map(c => c.nom), etape: '',
      detail: `${list.length} fiches CONTACTS partagent l'email ${emailK} : ${list.map(c => c.nom).join(' / ')}`, notionUrl: list[0].notionUrl });
  }
  return items;
}

/* ─── 2. Rapprochement avec le suivi de Déborah ──────────────── */

function ligneSuivi(pg, table) {
  const p = pg.properties || {};
  const t = (n) => plain(p[n]?.rich_text);
  return {
    id: pg.id, table, notionUrl: pg.url,
    nom: plain(p['Stagiaire']?.title),
    email: (p['E-mail']?.email || '').toLowerCase(),
    telephone: p['Téléphone']?.phone_number || '',
    etat: p['État']?.status?.name || '',
    sessionCpf: sel(p['SESSION CPF']),
    paiement: p['paiement']?.status?.name || '',
    financement: table === 'cpf' ? t('financement') : sel(p['Financement']),
    montant: nombre(t('montant')),
    dateEntree: jour(dateStart(p['Date entrée formation']) || dateStart(p['date début'])),
    numDevisEdof: p['N° devis EDOF']?.number != null ? String(p['N° devis EDOF'].number) : '',
    hTutorat: nombre(t('h tutorat') || t('Nb h tutorat')),
    convocation: p['convocation']?.checkbox === true,
    dossierInscription: p['Dossier inscription']?.checkbox === true,
    certification: sel(p['certification']),
    facturation: t('Facturation'),
    infosOpco: t('infos dossiers OPCO'),
    url: p['URL']?.url || '',
    lastEdited: pg.last_edited_time || '',
  };
}

// « CPF IAG12 » / « CPFIAG13 » / « IAA003 » → « IAG-12 » / « IAG-13 » / « IAA-03 »
function sessionCockpit(sessionCpf) {
  const m = /^(?:CPF\s*)?(IAG|IAA)\s*0*(\d+)$/i.exec((sessionCpf || '').trim());
  return m ? `${m[1].toUpperCase()}-${m[2].padStart(2, '0')}` : '';
}

async function lireSuiviDeborah() {
  const [cpf, nonCpf] = await Promise.all([
    queryDataSource(SUIVI_DEBORAH.cpf, {}, 4),
    queryDataSource(SUIVI_DEBORAH.nonCpf, {}, 2),
  ]);
  return [...cpf.map(pg => ligneSuivi(pg, 'cpf')), ...nonCpf.map(pg => ligneSuivi(pg, 'nonCpf'))].filter(l => l.nom);
}

function rapprocher(lignes, dossiers, contacts) {
  const parEmail = new Map(), parNom = new Map();
  for (const d of dossiers) {
    for (const s of d.stagiairesDetail) {
      if (s.email) { const k = s.email.toLowerCase(); if (!parEmail.has(k)) parEmail.set(k, []); parEmail.get(k).push(d); }
      const k = cleNom(s.nom); if (k) { if (!parNom.has(k)) parNom.set(k, []); parNom.get(k).push(d); }
    }
  }
  // Un dossier « ouvert » d'abord, sinon le plus récent.
  const choisir = (list) => list && (list.find(d => !isClos(d)) || [...list].sort((a, b) => (b.createdTime || '').localeCompare(a.createdTime || ''))[0]);

  const ecarts = [], absents = [], aJour = [];
  const dossiersVus = new Set();
  for (const l of lignes) {
    const d = choisir(parEmail.get(l.email)) || choisir(parNom.get(cleNom(l.nom)));
    if (!d) {
      const annule = /ANNULE/i.test(l.sessionCpf) || /Annulé/i.test(l.paiement);
      absents.push({ ligne: l, annule, contact: Object.values(contacts).find(c => (l.email && c.email?.toLowerCase() === l.email) || cleNom(c.nom) === cleNom(l.nom)) || null });
      continue;
    }
    dossiersVus.add(d.id);
    const diffs = [];
    const diff = (champ, deborah, cockpit, prop, valeur, note = '') => {
      if (deborah == null || deborah === '' || String(deborah) === String(cockpit ?? '')) return;
      diffs.push({ champ, deborah: String(deborah), cockpit: cockpit == null ? '' : String(cockpit), note,
        ...(prop ? { fix: { action: 'update', label: 'Reprendre', payload: { dossierId: d.id, updates: { [prop]: valeur } } } } : {}) });
    };
    diff('Date de début', l.dateEntree, jour(d.dateDebut), 'Date début formation', l.dateEntree);
    diff('N° dossier EDOF', l.numDevisEdof, d.numEdof, 'N° dossier EDOF', l.numDevisEdof);
    diff('Heures tutorat', l.hTutorat, d.heuresTutorat, 'Heures tutorat', String(l.hTutorat ?? ''));
    diff('Montant HT', l.montant, d.montantHT, 'Montant total HT', String(l.montant ?? ''));
    const ses = sessionCockpit(l.sessionCpf);
    if (ses) diff('Session', ses, d.session, 'Session', ses, `Déborah : « ${l.sessionCpf} »`);
    // Statut : signaux forts seulement (terminé / annulé / convocation).
    if (l.etat === 'Terminé' && !/Clôturé|Formation terminée/.test(d.etape || ''))
      diffs.push({ champ: 'Étape', deborah: 'Terminé', cockpit: d.etape || '(sans étape)', note: 'Déborah marque la formation terminée' });
    if ((/ANNULE/i.test(l.sessionCpf) || /Annulé/i.test(l.paiement)) && !/Refusé/.test(d.etape || ''))
      diffs.push({ champ: 'Étape', deborah: 'Annulé', cockpit: d.etape || '(sans étape)', note: 'Annulé chez Déborah',
        fix: { action: 'update', label: 'Passer en Refusé / annulé', payload: { dossierId: d.id, updates: { 'Étape admin': '🚫 Refusé / annulé' } } } });
    if (l.convocation && /Devis|financement en attente|convocation à envoyer/i.test(d.etape || ''))
      diffs.push({ champ: 'Étape', deborah: 'Convocation envoyée ✓', cockpit: d.etape, note: 'Déborah a coché « convocation »' });
    if (/Payé|CPF facturé|OPCO facturé|facturé/i.test(l.paiement) && !d.statutPaiement)
      diffs.push({ champ: 'Paiement', deborah: l.paiement, cockpit: '(vide)', note: 'Statut paiement à reporter' });
    // Contact : téléphone / email manquants côté CRM.
    const st = d.stagiairesDetail.find(s => (l.email && s.email?.toLowerCase() === l.email) || cleNom(s.nom) === cleNom(l.nom)) || d.stagiairesDetail[0];
    if (st) {
      if (l.email && !st.email) diffs.push({ champ: 'Email contact', deborah: l.email, cockpit: '(vide)',
        fix: { action: 'contact-update', label: 'Reprendre', payload: { contactId: st.id, updates: { 'Email': l.email } } } });
      if (l.telephone && !st.telephone) diffs.push({ champ: 'Téléphone contact', deborah: l.telephone, cockpit: '(vide)',
        fix: { action: 'contact-update', label: 'Reprendre', payload: { contactId: st.id, updates: { 'Téléphone': l.telephone } } } });
    }
    const item = { ligne: l, dossierId: d.id, reference: d.reference, etape: d.etape || '', stagiaires: d.stagiaires, notionUrl: d.url, diffs };
    (diffs.length ? ecarts : aJour).push(item);
  }
  const nonSuivis = dossiers.filter(d => !isClos(d) && !dossiersVus.has(d.id))
    .map(d => ({ dossierId: d.id, reference: d.reference, stagiaires: d.stagiaires, etape: d.etape || '', notionUrl: d.url }));
  return { ecarts, absents, aJour: aJour.length, nonSuivis, lignes: lignes.length };
}

/* ─── Point d'entrée ─────────────────────────────────────────── */

export async function santeDonnees() {
  const [{ dossiers, contacts }, snapshot, sessionPages] = await Promise.all([
    listCrm(),
    readSnapshot().catch(() => null),
    queryAll(DB.sessions, {}, 3).catch(() => []),
  ]);
  const sessionsParDossier = new Map();
  for (const s of sessionPages) for (const id of rel(s.properties?.['Dossiers apprenants'])) {
    sessionsParDossier.set(id, (sessionsParDossier.get(id) || 0) + 1);
  }
  const items = controles({ dossiers, contacts, sessionsParDossier, snapshot });

  let suivi = null, suiviErreur = '';
  try {
    suivi = rapprocher(await lireSuiviDeborah(), dossiers, contacts);
  } catch (err) {
    console.error('sante suivi-deborah:', err.message);
    suiviErreur = /40[34]/.test(err.message)
      ? 'La base « Suivi FORMATIONS ENEKO 2026 (déborah) » n\'est pas partagée avec l\'intégration Notion du cockpit (••• → Connexions).'
      : 'Lecture du suivi de Déborah impossible pour le moment.';
  }
  const ordre = { haute: 0, moyenne: 1, basse: 2 };
  items.sort((a, b) => ordre[a.gravite] - ordre[b.gravite] || a.reference.localeCompare(b.reference));
  return { generatedAt: new Date().toISOString(), items, suivi, suiviErreur };
}
