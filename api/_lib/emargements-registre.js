// ════════════════════════════════════════════════════════════════
//  api/_lib/emargements-registre.js  —  Registre d'assiduité Notion
//
//  Base ÉMARGEMENTS (sous « CRM & Suivi Apprenants ») : UNE ligne = un
//  stagiaire × une séance, reliée à sa fiche CONTACTS et à son DOSSIER.
//  Deux sources l'alimentent par le même chemin (`upsertLignes`) :
//   • l'historique Edusign (export XLSX importé via le cockpit, action
//     `emargements-import`) — l'ancien outil, avant l'émargement Eneko ;
//   • chaque feuille clôturée par l'outil d'émargement Eneko (`cloturer()`).
//  Idempotence : la propriété « ID source » identifie la ligne dans sa
//  source ; un ré-import met à jour au lieu de dupliquer.
//
//  Rattachement : contact par email exact (puis nom), dossier parmi ceux du
//  contact — celui dont la session correspond à la feuille, sinon celui dont
//  les dates encadrent la séance, sinon le plus récent.
// ════════════════════════════════════════════════════════════════

import { DB, notion, queryAll, plain, sel, rel, dateStart, titleOf, listDossiers } from './notion-crm.js';

export const DB_EMARGEMENTS = process.env.NOTION_DB_EMARGEMENTS || '37ae7fb14ea742c3a072c08e40bfad9d';
export const TYPES = ['Live groupe', 'Tutorat', 'PEC besoins', 'Formation intra', 'Autre'];
export const STATUTS = ['Présent', 'Absent', 'Absence justifiée', 'En attente de signature'];

const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const mots = (t) => norm(t).split(' ').filter(m => m.length >= 3);
const nomInclus = (nomCrm, texte) => { const a = mots(nomCrm), b = new Set(mots(texte)); return a.length > 0 && a.every(m => b.has(m)); };
const heures = (debut, fin) => {
  const ms = new Date(fin) - new Date(debut);
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 36e4) / 10 : null;
};

// Type de séance déduit du titre de la feuille (Edusign) ou du type de session (Planning).
export function typeSeance(titre, typeSession = '') {
  const t = `${titre} ${typeSession}`;
  if (/tutorat|coaching/i.test(t)) return 'Tutorat';
  if (/PEC|besoins/i.test(t)) return 'PEC besoins';
  if (/GPE|live|groupe/i.test(t)) return 'Live groupe';
  if (/intra|formation[ _-]/i.test(t)) return 'Formation intra';
  return 'Autre';
}
// « Formation-GPE-IAG00011 » → « IAG-11 » (indice de session pour choisir le dossier).
const sessionDuTitre = (titre) => {
  const m = /(IAG|IAA)\s*0*(\d{1,2})\b/i.exec(titre || '');
  return m ? `${m[1].toUpperCase()}-${m[2].padStart(2, '0')}` : '';
};

/* ─── Rattachement ───────────────────────────────────────────── */

// Plusieurs fiches peuvent partager un email (couple, assistante…) : on
// préfère celle dont le nom correspond au signataire.
async function contactParEmail(email, prenom = '', nom = '') {
  if (!email) return null;
  const found = await queryAll(DB.contacts, { filter: { property: 'Email', email: { equals: email } }, page_size: 5 }, 1);
  if (!found.length) return null;
  const pg = found.find(x => nomInclus(`${prenom} ${nom}`, titleOf(x))) || found.find(x => nomInclus(nom, titleOf(x))) || found[0];
  return { id: pg.id, nom: titleOf(pg) };
}
async function contactParNom(prenom, nom) {
  if (!nom) return null;
  const found = await queryAll(DB.contacts, { filter: { property: 'Nom complet', title: { contains: nom } }, page_size: 10 }, 1);
  const exact = found.find(pg => nomInclus(`${prenom} ${nom}`, titleOf(pg)) || nomInclus(titleOf(pg), `${prenom} ${nom}`));
  return exact ? { id: exact.id, nom: titleOf(exact) } : null;
}

function choisirDossier(dossiers, contactId, { dateSeance, titre }) {
  const nid = (x) => String(x || '').replace(/-/g, '');
  const miens = dossiers.filter(d => d.stagiaireIds.some(id => nid(id) === nid(contactId)));
  if (!miens.length) return null;
  if (miens.length === 1) return miens[0];
  const ses = sessionDuTitre(titre);
  const parSession = ses && miens.find(d => d.session === ses);
  if (parSession) return parSession;
  const j = (dateSeance || '').slice(0, 10);
  const parDates = miens.find(d => d.dateDebut && j >= d.dateDebut.slice(0, 10) && (!d.dateFin || j <= d.dateFin.slice(0, 10)));
  if (parDates) return parDates;
  const parType = /tutorat|GPE|IAG/i.test(titre) && miens.find(d => /IAG/.test(d.typeFormation || ''));
  return parType || [...miens].sort((a, b) => (b.createdTime || '').localeCompare(a.createdTime || ''))[0];
}

/* ─── Écriture ───────────────────────────────────────────────── */

function proprietes(l) {
  const p = {
    'Séance': { title: [{ text: { content: l.seance.slice(0, 200) } }] },
    'Date début': { date: { start: l.debut } },
    'Date fin': l.fin ? { date: { start: l.fin } } : { date: null },
    'Durée (h)': { number: l.duree ?? heures(l.debut, l.fin) },
    'Type': { select: { name: TYPES.includes(l.type) ? l.type : 'Autre' } },
    'Statut': { select: { name: STATUTS.includes(l.statut) ? l.statut : 'En attente de signature' } },
    'Signé le': l.signeLe ? { date: { start: l.signeLe } } : { date: null },
    'Retard (min)': { number: l.retard ?? null },
    'Intervenant': { rich_text: l.intervenant ? [{ text: { content: l.intervenant.slice(0, 200) } }] : [] },
    'Feuille': { rich_text: l.feuille ? [{ text: { content: l.feuille.slice(0, 200) } }] : [] },
    'Source': { select: { name: l.source === 'Cockpit' ? 'Cockpit' : 'Edusign' } },
    'ID source': { rich_text: [{ text: { content: l.idSource.slice(0, 100) } }] },
    'Stagiaire': { relation: l.contactId ? [{ id: l.contactId }] : [] },
    'Dossier': { relation: l.dossierId ? [{ id: l.dossierId }] : [] },
  };
  return p;
}

// lignes : [{ idSource, seance, feuille, debut, fin, type, statut, signeLe, retard,
//             intervenant, source, email, prenom, nom, contactId?, dossierId? }]
// Résout contact/dossier quand ils manquent, puis crée ou met à jour.
export async function upsertLignes(lignes, { dossiersCache } = {}) {
  const dossiers = dossiersCache || await listDossiers();
  const contacts = new Map();   // email|nom → { id, nom } | null
  const bilan = { crees: 0, misAJour: 0, sansContact: [], sansDossier: [], erreurs: [] };

  // Lignes déjà présentes (par ID source) — une requête par lot de 100 ids.
  const existants = new Map();
  const ids = [...new Set(lignes.map(l => l.idSource))];
  for (let i = 0; i < ids.length; i += 100) {
    const lot = ids.slice(i, i + 100);
    const filter = lot.length === 1 ? { property: 'ID source', rich_text: { equals: lot[0] } }
      : { or: lot.map(id => ({ property: 'ID source', rich_text: { equals: id } })) };
    try {
      for (const pg of await queryAll(DB_EMARGEMENTS, { filter }, 2)) existants.set(plain(pg.properties?.['ID source']?.rich_text), pg.id);
    } catch (err) { console.error('emargements existants:', err.message); }
  }

  for (const l of lignes) {
    try {
      if (!l.contactId) {
        const cle = (l.email || `${l.prenom} ${l.nom}`).toLowerCase();
        if (!contacts.has(cle)) contacts.set(cle, (await contactParEmail((l.email || '').toLowerCase(), l.prenom, l.nom)) || (await contactParNom(l.prenom, l.nom)));
        const c = contacts.get(cle);
        if (c) l.contactId = c.id; else bilan.sansContact.push(`${l.prenom} ${l.nom} <${l.email || '—'}>`);
      }
      if (l.contactId && !l.dossierId) {
        const d = choisirDossier(dossiers, l.contactId, { dateSeance: l.debut, titre: l.feuille || l.seance });
        if (d) l.dossierId = d.id; else bilan.sansDossier.push(`${l.prenom} ${l.nom}`);
      }
      const props = proprietes(l);
      const pageId = existants.get(l.idSource);
      if (pageId) { await notion(`pages/${pageId}`, { method: 'PATCH', body: { properties: props } }); bilan.misAJour++; }
      else { await notion('pages', { method: 'POST', body: { parent: { database_id: DB_EMARGEMENTS }, properties: props } }); bilan.crees++; }
    } catch (err) {
      console.error('emargements upsert:', err.message);
      bilan.erreurs.push(l.idSource);
    }
  }
  bilan.sansContact = [...new Set(bilan.sansContact)];
  bilan.sansDossier = [...new Set(bilan.sansDossier)];
  return bilan;
}

/* ─── Lecture ────────────────────────────────────────────────── */

function ligneDepuisPage(pg) {
  const p = pg.properties || {};
  return {
    id: pg.id, notionUrl: pg.url,
    seance: plain(p['Séance']?.title), feuille: plain(p['Feuille']?.rich_text),
    debut: dateStart(p['Date début']), fin: dateStart(p['Date fin']),
    duree: p['Durée (h)']?.number ?? null, type: sel(p['Type']), statut: sel(p['Statut']),
    signeLe: dateStart(p['Signé le']), retard: p['Retard (min)']?.number ?? null,
    intervenant: plain(p['Intervenant']?.rich_text), source: sel(p['Source']),
    contactIds: rel(p['Stagiaire']), dossierIds: rel(p['Dossier']),
  };
}

// Séances d'un dossier (relation Dossier) + celles de ses stagiaires non
// rattachées à un dossier — avec un résumé : heures présentes, absences.
export async function emargementsDossier(dossierId, contactIds = []) {
  const or = [{ property: 'Dossier', relation: { contains: dossierId } }];
  for (const id of contactIds.slice(0, 10)) or.push({ property: 'Stagiaire', relation: { contains: id } });
  const pages = await queryAll(DB_EMARGEMENTS, {
    filter: or.length === 1 ? or[0] : { or },
    sorts: [{ property: 'Date début', direction: 'ascending' }],
  }, 2);
  const nid = (x) => String(x || '').replace(/-/g, '');
  const lignes = pages.map(ligneDepuisPage)
    // Une séance d'un stagiaire rattachée à un AUTRE dossier reste hors de cette fiche.
    .filter(l => !l.dossierIds.length || l.dossierIds.some(id => nid(id) === nid(dossierId)));
  const presentes = lignes.filter(l => l.statut === 'Présent');
  const resume = {
    seances: lignes.length,
    presences: presentes.length,
    absences: lignes.filter(l => /Absent/.test(l.statut)).length,
    enAttente: lignes.filter(l => l.statut === 'En attente de signature').length,
    heuresPresentes: Math.round(presentes.reduce((t, l) => t + (l.duree || 0), 0) * 10) / 10,
    parType: {},
  };
  for (const l of presentes) resume.parType[l.type] = Math.round(((resume.parType[l.type] || 0) + (l.duree || 0)) * 10) / 10;
  return { lignes, resume };
}
