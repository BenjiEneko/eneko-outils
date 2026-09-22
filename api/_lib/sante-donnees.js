// ════════════════════════════════════════════════════════════════
//  api/_lib/sante-donnees.js  —  Santé des données du CRM
//
//  Deux volets, servis par l'onglet « Santé » du cockpit :
//   1. CONTRÔLES sur la base DOSSIERS/CONTACTS (dossier sans stagiaire,
//      sans type, doublons probables, stagiaire sans email, en formation
//      sans session ni compte Circle…) — chaque anomalie porte, quand c'est
//      possible, une correction en un clic (`fix`) qui réutilise les actions
//      d'écriture existantes du cockpit.
//  Rien n'est écrit ici : ce module ne fait que lire et proposer.
//  (Le rapprochement avec le suivi historique de Déborah a été fait UNE fois
//  le 2026-09-22, à la demande de Benjamin ; il n'est pas maintenu ici.)
// ════════════════════════════════════════════════════════════════

import { DB, queryAll, listCrm, rel } from './notion-crm.js';
import { readSnapshot } from './elearning-snapshot.js';

const norm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const isClos = (d) => /Clôturé|Refusé/.test(d.etape || '');
const isEnFormation = (d) => /En formation|Convocation envoyée|Formation terminée/.test(d.etape || '');
const jour = (iso) => (iso || '').slice(0, 10);

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

  const ordre = { haute: 0, moyenne: 1, basse: 2 };
  items.sort((a, b) => ordre[a.gravite] - ordre[b.gravite] || a.reference.localeCompare(b.reference));
  return { generatedAt: new Date().toISOString(), items };
}
