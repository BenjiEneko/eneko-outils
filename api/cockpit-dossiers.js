// ════════════════════════════════════════════════════════════════
//  /api/cockpit-dossiers  —  Backoffice du Cockpit Dossiers Apprenants
//  (page interne /cockpit-dossiers, session obligatoire)
//
//  Le cockpit est une interface MINCE au-dessus du CRM Notion :
//  lecture en direct (aucune copie locale) et écritures limitées aux
//  propriétés de suivi de la base DOSSIERS. Notion reste la vérité.
//
//  Actions (toutes exigent une session interne valide) :
//   • meta   : options réelles des selects (lues sur le schéma Notion,
//     jamais dupliquées en dur → une option ajoutée dans Notion
//     apparaît dans le cockpit sans déploiement) ;
//   • list   : tous les dossiers + annuaires contacts/entreprises
//     résolus (3 requêtes Notion, pas de N+1) ;
//   • detail : un dossier + ses sessions liées + fiches Candidats
//     RS6776 des stagiaires ;
//   • update : écrit Étape admin / Statut dossier / Statut paiement.
//     ⚠️ Notion CRÉE silencieusement toute option de select inconnue :
//     chaque valeur est donc validée contre le schéma live avant écriture.
//
//  ⚠️ L'intégration Notion doit être connectée à la page parente
//  « CRM & Suivi Apprenants » (couvre DOSSIERS, CONTACTS, ENTREPRISES,
//  SESSIONS et Candidats d'un coup).
// ════════════════════════════════════════════════════════════════

import { guardPost, capString } from './_lib/guard.js';
import { isAuthorized } from './_lib/token.js';
import {
  DB, notion, queryAll, plain, sel, rel, dateStart, titleOf, dossierFromPage, listDossiers,
} from './_lib/notion-crm.js';
import { circleConfigured, elearningForStagiaires, summarizeElearning } from './_lib/circle.js';
import { gatherRelances, markRelanceDone } from './_lib/relances-sources.js';
import { readSnapshot } from './_lib/elearning-snapshot.js';
import { parcoursAmont } from './_lib/parcours-amont.js';
import { santeDonnees } from './_lib/sante-donnees.js';
import { upsertLignes, emargementsDossier, TYPES as TYPES_SEANCE, STATUTS as STATUTS_SEANCE } from './_lib/emargements-registre.js';
import { googleConfigured, listerDossierDrive } from './_lib/google.js';

// Propriétés de DOSSIERS que le cockpit a le droit d'écrire, avec leur type
// attendu. Les selects sont validés contre le schéma Notion live (Notion crée
// silencieusement toute option inconnue). « Étape admin » est l'axe de
// progression unique (sa forme réelle, select ou multi-select, est lue dans
// `meta.etapeType`), « Statut paiement » l'axe financier, indépendant.
const WRITABLE = {
  'Étape admin': 'select',
  'Statut paiement': 'select',
  'Financement': 'select',
  'Type de formation': 'select',
  'Session': 'select',
  'Plateforme e-learning': 'select',
  'Date début formation': 'date',
  'Date fin formation': 'date',
  'Date accès e-learning': 'date',
  'Date limite facturation': 'date',
  'Montant total HT': 'number',
  'Montant acompte HT': 'number',
  'Heures tutorat': 'number',
  'N° dossier EDOF': 'text',
  'N° dossier OPCO': 'text',
  'N° facture': 'text',
  'Notes': 'text',
  'Lien Drive dossier': 'url',
};
// Clé du schéma live (`meta`) qui porte les options de chaque select.
const SELECT_META = {
  'Étape admin': 'etapes', 'Statut paiement': 'statutsPaiement', 'Financement': 'financements',
  'Type de formation': 'typesFormation', 'Session': 'sessions', 'Plateforme e-learning': 'plateformes',
};

/* ─── Schéma live (cache 10 min par instance chaude) ─────────── */

let metaCache = { at: 0, data: null };

async function getMeta() {
  if (metaCache.data && Date.now() - metaCache.at < 10 * 60_000) return metaCache.data;
  const db = await notion(`databases/${DB.dossiers}`);
  const opts = (name) => {
    const prop = db.properties?.[name];
    const list = prop?.select?.options || prop?.multi_select?.options || [];
    return list.map(o => o.name);
  };
  const data = {
    etapes: opts('Étape admin'),
    // Type réel de la propriété : le cockpit écrit dans la bonne forme,
    // avant comme après la conversion multi-select → select dans Notion.
    etapeType: db.properties?.['Étape admin']?.type || 'select',
    statutsPaiement: opts('Statut paiement'),
    financements: opts('Financement'),
    typesFormation: opts('Type de formation'),
    sessions: opts('Session'),
    plateformes: opts('Plateforme e-learning'),
  };
  metaCache = { at: Date.now(), data };
  return data;
}

/* ─── Actions ────────────────────────────────────────────────── */

async function actionList() {
  const [dossiers, meta] = await Promise.all([listDossiers(), getMeta()]);
  return { dossiers, meta };
}

async function actionDetail(dossierId) {
  const pg = await notion(`pages/${dossierId}`);
  const d = dossierFromPage(pg);

  // Stagiaires complets (peu nombreux : fetchs individuels acceptables).
  const stagiaires = await Promise.all(
    d.stagiaireIds.slice(0, 25).map(async (id) => {
      try {
        const c = await notion(`pages/${id}`);
        return {
          id,
          nom: titleOf(c),
          email: c.properties?.['Email']?.email || '',
          emailElearning: c.properties?.['Email e-learning']?.email || '',
          telephone: c.properties?.['Téléphone']?.phone_number || '',
          poste: plain(c.properties?.['Poste']?.rich_text),
          notionUrl: c.url,
        };
      } catch { return { id, nom: '?', email: '', telephone: '', notionUrl: '' }; }
    })
  );

  const entreprises = await Promise.all(
    d.entrepriseIds.slice(0, 5).map(async (id) => {
      try { return titleOf(await notion(`pages/${id}`)); } catch { return '?'; }
    })
  );

  // Sessions liées à ce dossier (planning, émargement, éval à chaud).
  let sessions = [];
  try {
    const pages = await queryAll(DB.sessions, {
      filter: { property: 'Dossiers apprenants', relation: { contains: dossierId } },
      sorts: [{ property: 'Date début', direction: 'ascending' }],
    }, 2);
    sessions = pages.map(s => {
      const p = s.properties || {};
      return {
        intitule: plain(p['Intitulé session']?.title),
        module: sel(p['Module']),
        type: sel(p['Type de session']),
        statut: sel(p['Statut']),
        dateDebut: dateStart(p['Date début']),
        emargementOk: p['Émargement OK']?.checkbox === true,
        evalChaudFaite: p['Évaluation à chaud faite']?.checkbox === true,
        lienVisio: p['Lien visio']?.url || '',
        notionUrl: s.url,
      };
    });
  } catch (e) {
    console.error('cockpit sessions error:', e.message);
  }

  // Volet certification RS6776 : fiche Candidats du/des stagiaire(s).
  // (conçu pour accueillir une 2e certification plus tard : une certif = une base)
  const candidats = [];
  for (const st of stagiaires) {
    if (!st.nom || st.nom === '?') continue;
    try {
      const found = await queryAll(DB.candidats, {
        filter: { property: 'Nom Candidat', title: { equals: st.nom } },
      }, 1);
      if (found[0]) {
        const p = found[0].properties || {};
        candidats.push({
          stagiaire: st.nom,
          statut: sel(p['Certification']),
          dateOral: dateStart(p['Date oral']),
          notionUrl: found[0].url,
        });
      }
    } catch (e) {
      console.error('cockpit candidats error:', e.message);
    }
  }

  return {
    dossier: { ...d, stagiaires: stagiaires.map(s => s.nom), entreprise: entreprises.join(', ') },
    stagiairesDetail: stagiaires,
    sessions,
    candidats,
  };
}

// Construit les propriétés Notion à partir d'un objet { nom: valeur } venant
// de la page. Chaque valeur est typée et validée ; une chaîne vide efface.
async function buildProperties(updates) {
  if (!updates || typeof updates !== 'object') throw Object.assign(new Error('updates manquant'), { status: 400 });
  const meta = await getMeta();
  const bad = (m) => { throw Object.assign(new Error(m), { status: 400 }); };
  const properties = {};
  for (const [name, raw] of Object.entries(updates)) {
    const type = WRITABLE[name];
    if (!type) bad(`Propriété non modifiable : ${name}`);
    if (type === 'select') {
      if (typeof raw !== 'string') bad(`Valeur invalide pour ${name}`);
      const value = raw.trim();
      if (value !== '' && !(meta[SELECT_META[name]] || []).includes(value)) bad(`Valeur inconnue pour ${name}`);
      const real = name === 'Étape admin' ? meta.etapeType : 'select';
      properties[name] = real === 'multi_select'
        ? { multi_select: value === '' ? [] : [{ name: value }] }
        : { select: value === '' ? null : { name: value } };
    } else if (type === 'date') {
      const value = raw == null ? '' : String(raw).trim();
      if (value !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) bad(`Date invalide pour ${name} (AAAA-MM-JJ)`);
      properties[name] = { date: value === '' ? null : { start: value } };
    } else if (type === 'number') {
      if (raw === '' || raw == null) { properties[name] = { number: null }; continue; }
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/\s/g, '').replace(',', '.'));
      if (!Number.isFinite(n) || n < 0 || n > 1e7) bad(`Nombre invalide pour ${name}`);
      properties[name] = { number: n };
    } else if (type === 'text') {
      const value = capString(raw == null ? '' : String(raw), 2000);
      properties[name] = { rich_text: value === '' ? [] : [{ text: { content: value } }] };
    } else if (type === 'url') {
      const value = capString(raw == null ? '' : String(raw), 500).trim();
      if (value !== '' && !/^https?:\/\//i.test(value)) bad(`Lien invalide pour ${name}`);
      properties[name] = { url: value === '' ? null : value };
    }
  }
  if (!Object.keys(properties).length) bad('Aucune modification');
  return properties;
}

async function actionUpdate(dossierId, updates) {
  const properties = await buildProperties(updates);
  await notion(`pages/${dossierId}`, { method: 'PATCH', body: { properties } });
  return { ok: true };
}

// Met à la corbeille Notion (récupérable 30 j) un dossier, dans deux cas
// seulement : une COQUILLE vide (doublon créé par une automatisation), ou un
// dossier créé il y a moins de 24 h (création par erreur depuis l'assistant).
// Tout autre dossier est refusé : la suppression se fait dans Notion.
const RECENT_MS = 24 * 3600 * 1000;
async function actionCorbeille(dossierId) {
  const pg = await notion(`pages/${dossierId}`);
  if (pg.parent?.database_id?.replace(/-/g, '') !== DB.dossiers.replace(/-/g, '')) {
    throw Object.assign(new Error('Ce n\'est pas un dossier.'), { status: 400 });
  }
  const d = dossierFromPage(pg);
  if (Date.now() - new Date(pg.created_time).getTime() < RECENT_MS) {
    await notion(`pages/${dossierId}`, { method: 'PATCH', body: { archived: true } });
    return { ok: true, reference: d.reference, recent: true };
  }
  const renseigne = [
    d.stagiaireIds.length, d.entrepriseIds.length, d.montantHT != null, d.notes.trim(),
    d.dateDebut, d.dateFin, d.dateElearning, d.dateLimiteFactu,
    d.numEdof, d.numOpco, d.numFacture, d.lienDrive, d.financement, d.typeFormation, d.session,
  ].some(Boolean);
  if (renseigne) {
    throw Object.assign(new Error('Ce dossier contient des informations : suppression refusée (à faire dans Notion).'), { status: 400 });
  }
  const blocs = await notion(`blocks/${dossierId}/children?page_size=1`);
  if ((blocs.results || []).length) {
    throw Object.assign(new Error('La fiche a du contenu : suppression refusée (à faire dans Notion).'), { status: 400 });
  }
  await notion(`pages/${dossierId}`, { method: 'PATCH', body: { archived: true } });
  return { ok: true, reference: d.reference };
}

/* ─── Contacts, entreprises, création de dossier ─────────────── */

const sansAccents = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const contactLight = (pg) => ({
  id: pg.id,
  nom: titleOf(pg),
  email: pg.properties?.['Email']?.email || '',
  emailElearning: pg.properties?.['Email e-learning']?.email || '',
  telephone: pg.properties?.['Téléphone']?.phone_number || '',
  poste: plain(pg.properties?.['Poste']?.rich_text),
  type: sel(pg.properties?.['Type']),
  statut: sel(pg.properties?.['Statut pipeline']),
  notionUrl: pg.url,
});

// Recherche de contacts par nom OU email (contient, insensible à la casse
// côté Notion). Sert au choix du stagiaire et à la détection de doublons.
async function actionContactsSearch(q) {
  const query = capString(q, 80).trim();
  if (query.length < 2) return { contacts: [] };
  const pages = await queryAll(DB.contacts, {
    filter: { or: [
      { property: 'Nom complet', title: { contains: query } },
      { property: 'Email', email: { contains: query } },
    ] },
    page_size: 20,
  }, 1);
  return { contacts: pages.slice(0, 20).map(contactLight) };
}

let contactsMetaCache = { at: 0, data: null };
async function contactsMeta() {
  if (contactsMetaCache.data && Date.now() - contactsMetaCache.at < 10 * 60_000) return contactsMetaCache.data;
  const db = await notion(`databases/${DB.contacts}`);
  const opts = (n) => (db.properties?.[n]?.select?.options || []).map(o => o.name);
  contactsMetaCache = { at: Date.now(), data: { types: opts('Type'), statuts: opts('Statut pipeline') } };
  return contactsMetaCache.data;
}

const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

// Crée une fiche CONTACTS — après avoir vérifié qu'aucune fiche ne porte
// déjà cet email : dans ce cas on renvoie la fiche existante (409) plutôt
// que d'en créer une seconde.
async function actionContactCreate(body) {
  const nom = capString(body?.nom, 120).trim().replace(/\s+/g, ' ');
  const email = capString(body?.email, 200).trim().toLowerCase();
  const telephone = capString(body?.telephone, 40).trim();
  const poste = capString(body?.poste, 120).trim();
  if (nom.length < 3 || !/\s/.test(nom)) throw Object.assign(new Error('Indiquez prénom ET nom.'), { status: 400 });
  if (email && !emailOk(email)) throw Object.assign(new Error('Email invalide.'), { status: 400 });
  if (email) {
    const dup = await queryAll(DB.contacts, { filter: { property: 'Email', email: { equals: email } }, page_size: 5 }, 1);
    if (dup[0]) throw Object.assign(new Error('Une fiche contact porte déjà cet email.'), { status: 409, contact: contactLight(dup[0]) });
  }
  const meta = await contactsMeta();
  const properties = { 'Nom complet': { title: [{ text: { content: nom } }] } };
  if (email) properties['Email'] = { email };
  if (telephone) properties['Téléphone'] = { phone_number: telephone };
  if (poste) properties['Poste'] = { rich_text: [{ text: { content: poste } }] };
  if (meta.types.includes('👤 Particulier')) properties['Type'] = { select: { name: '👤 Particulier' } };
  if (meta.statuts.includes('✅ Inscrit')) properties['Statut pipeline'] = { select: { name: '✅ Inscrit' } };
  const pg = await notion('pages', { method: 'POST', body: { parent: { database_id: DB.contacts }, properties } });
  return { ok: true, contact: contactLight(pg) };
}

const CONTACT_WRITABLE = { 'Email': 'email', 'Email e-learning': 'email', 'Téléphone': 'phone', 'Poste': 'text' };
async function actionContactUpdate(contactId, updates) {
  if (!updates || typeof updates !== 'object') throw Object.assign(new Error('updates manquant'), { status: 400 });
  const properties = {};
  for (const [name, raw] of Object.entries(updates)) {
    const type = CONTACT_WRITABLE[name];
    if (!type) throw Object.assign(new Error(`Propriété non modifiable : ${name}`), { status: 400 });
    const value = capString(raw == null ? '' : String(raw), 200).trim();
    if (type === 'email') {
      if (value && !emailOk(value)) throw Object.assign(new Error(`Email invalide (${name}).`), { status: 400 });
      properties[name] = { email: value ? value.toLowerCase() : null };
    } else if (type === 'phone') {
      properties[name] = { phone_number: value || null };
    } else {
      properties[name] = { rich_text: value ? [{ text: { content: value } }] : [] };
    }
  }
  if (!Object.keys(properties).length) throw Object.assign(new Error('Aucune modification'), { status: 400 });
  const pg = await notion(`pages/${contactId}`, { method: 'PATCH', body: { properties } });
  return { ok: true, contact: contactLight(pg) };
}

async function actionEntreprisesSearch(q) {
  const query = capString(q, 80).trim();
  if (query.length < 2) return { entreprises: [] };
  const db = await notion(`databases/${DB.entreprises}`);
  const titleProp = Object.entries(db.properties || {}).find(([, p]) => p.type === 'title')?.[0] || 'Nom';
  const pages = await queryAll(DB.entreprises, { filter: { property: titleProp, title: { contains: query } }, page_size: 15 }, 1);
  return { entreprises: pages.slice(0, 15).map(pg => ({ id: pg.id, nom: titleOf(pg), notionUrl: pg.url })) };
}

async function actionEntrepriseCreate(nomBrut) {
  const nom = capString(nomBrut, 120).trim().replace(/\s+/g, ' ');
  if (nom.length < 2) throw Object.assign(new Error('Nom d\'entreprise trop court.'), { status: 400 });
  const db = await notion(`databases/${DB.entreprises}`);
  const titleProp = Object.entries(db.properties || {}).find(([, p]) => p.type === 'title')?.[0] || 'Nom';
  const dup = await queryAll(DB.entreprises, { filter: { property: titleProp, title: { equals: nom } }, page_size: 2 }, 1);
  if (dup[0]) return { ok: true, entreprise: { id: dup[0].id, nom: titleOf(dup[0]), notionUrl: dup[0].url }, existante: true };
  const pg = await notion('pages', { method: 'POST', body: {
    parent: { database_id: DB.entreprises },
    properties: { [titleProp]: { title: [{ text: { content: nom } }] } },
  } });
  return { ok: true, entreprise: { id: pg.id, nom, notionUrl: pg.url } };
}

// Référence normalisée : DOS-<code session ou type>-<NOM>. Reproduit la
// convention des dossiers existants (DOS-IAG008-DELCOURT, DOS-IAA002-MASSON,
// DOS-INTRA-NOM…). La page affiche le même calcul en aperçu.
export function referenceDossier({ nomContact, session, typeFormation }) {
  const mots = sansAccents(nomContact).trim().split(/\s+/).filter(Boolean);
  const majs = mots.filter(m => m.length > 1 && m === m.toUpperCase());
  const nom = (majs.length ? majs : mots.slice(-1)).join('-').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const ses = /^(IAG|IAA)-(\d+)$/i.exec(session || '');
  let code;
  if (ses) code = `${ses[1].toUpperCase()}${ses[2].padStart(3, '0')}`;
  else if (/intra/i.test(session || '')) code = 'INTRA';
  else if (/présentiel|presentiel/i.test(session || '') || /Présentiel/.test(typeFormation || '')) code = 'PRES';
  else if (/IAG/.test(typeFormation || '')) code = 'IAG';
  else if (/IAA/.test(typeFormation || '')) code = 'IAA';
  else if (/mesure/i.test(typeFormation || '')) code = 'SM';
  else code = 'DOS';
  return `DOS-${code}-${nom || 'SANS-NOM'}`;
}

// Création d'un dossier proprement relié. Refuse un doublon (même stagiaire
// déjà sur un dossier ouvert de la même session).
async function actionDossierCreate(body) {
  const stagiaireId = capString(body?.stagiaireId, 60);
  if (!/^[0-9a-f-]{32,36}$/i.test(stagiaireId)) throw Object.assign(new Error('Stagiaire requis.'), { status: 400 });
  const entrepriseId = capString(body?.entrepriseId, 60);
  const champs = body?.champs && typeof body.champs === 'object' ? body.champs : {};
  const contact = await notion(`pages/${stagiaireId}`);
  const nomContact = titleOf(contact);
  if (!nomContact) throw Object.assign(new Error('Fiche contact introuvable.'), { status: 400 });

  const properties = await buildProperties({ 'Étape admin': '📋 Devis/Convention à envoyer', ...champs });
  const session = champs['Session'] || '';
  const existants = await queryAll(DB.dossiers, {
    filter: { property: 'Stagiaire(s)', relation: { contains: stagiaireId } },
  }, 1);
  const doublon = existants.map(dossierFromPage).find(d =>
    (d.session || '') === session && !/Clôturé|Refusé/.test(d.etape || ''));
  if (doublon) {
    throw Object.assign(new Error(`${nomContact} a déjà un dossier ouvert${session ? ` sur ${session}` : ''} : ${doublon.reference}.`), { status: 409, dossierId: doublon.id });
  }
  let reference = referenceDossier({ nomContact, session, typeFormation: champs['Type de formation'] || '' });
  const memeRef = await queryAll(DB.dossiers, { filter: { property: 'Référence dossier', title: { equals: reference } }, page_size: 2 }, 1);
  if (memeRef.length) reference += `-${existants.length + 2}`;

  properties['Référence dossier'] = { title: [{ text: { content: reference } }] };
  properties['Stagiaire(s)'] = { relation: [{ id: stagiaireId }] };
  if (/^[0-9a-f-]{32,36}$/i.test(entrepriseId)) properties['Entreprise'] = { relation: [{ id: entrepriseId }] };
  const pg = await notion('pages', { method: 'POST', body: { parent: { database_id: DB.dossiers }, properties } });
  return { ok: true, dossierId: pg.id, reference, url: pg.url };
}

// Ajoute / retire des stagiaires d'un dossier (relation « Stagiaire(s) »).
async function actionDossierStagiaires(dossierId, add, remove) {
  const ids = (arr) => (Array.isArray(arr) ? arr : []).map(x => capString(x, 60)).filter(x => /^[0-9a-f-]{32,36}$/i.test(x));
  const pg = await notion(`pages/${dossierId}`);
  const actuels = new Set(rel(pg.properties?.['Stagiaire(s)']).map(id => id.replace(/-/g, '')));
  for (const id of ids(add)) actuels.add(id.replace(/-/g, ''));
  for (const id of ids(remove)) actuels.delete(id.replace(/-/g, ''));
  await notion(`pages/${dossierId}`, { method: 'PATCH', body: {
    properties: { 'Stagiaire(s)': { relation: [...actuels].map(id => ({ id })) } },
  } });
  return { ok: true, stagiaireIds: [...actuels] };
}

// Corbeille d'une fiche CONTACTS créée il y a moins de 24 h et qu'aucun
// dossier ne relie (création par erreur depuis l'assistant).
async function actionContactCorbeille(contactId) {
  const pg = await notion(`pages/${contactId}`);
  if (pg.parent?.database_id?.replace(/-/g, '') !== DB.contacts.replace(/-/g, '')) {
    throw Object.assign(new Error('Ce n\'est pas une fiche contact.'), { status: 400 });
  }
  if (Date.now() - new Date(pg.created_time).getTime() >= RECENT_MS) {
    throw Object.assign(new Error('Fiche créée il y a plus de 24 h : suppression à faire dans Notion.'), { status: 400 });
  }
  const lies = await queryAll(DB.dossiers, { filter: { property: 'Stagiaire(s)', relation: { contains: contactId } }, page_size: 2 }, 1);
  if (lies.length) throw Object.assign(new Error('Cette fiche est reliée à un dossier : retirez-la d\'abord.'), { status: 400 });
  await notion(`pages/${contactId}`, { method: 'PATCH', body: { archived: true } });
  return { ok: true, nom: titleOf(pg) };
}

/* ─── Handler ────────────────────────────────────────────────── */

export default async function handler(req, res) {
  if (!(await guardPost(req, res, { maxBodyChars: 60_000, limit: 120, windowMs: 60_000 }))) return;

  const { action, auth } = req.body || {};
  if (!auth || !isAuthorized(auth.email, auth.token)) {
    return res.status(401).json({ error: 'Session interne requise.' });
  }
  if (!process.env.NOTION_TOKEN) {
    console.error('cockpit-dossiers : NOTION_TOKEN non configuré.');
    return res.status(500).json({ error: 'Service momentanément indisponible.' });
  }

  const dossierId = capString(req.body.dossierId, 60);
  const idOk = /^[0-9a-f-]{32,36}$/i.test(dossierId);

  try {
    if (action === 'meta') return res.status(200).json({ meta: await getMeta() });
    if (action === 'list') return res.status(200).json(await actionList());
    if (action === 'detail') {
      if (!idOk) return res.status(400).json({ error: 'Dossier invalide.' });
      return res.status(200).json(await actionDetail(dossierId));
    }
    if (action === 'update') {
      if (!idOk) return res.status(400).json({ error: 'Dossier invalide.' });
      return res.status(200).json(await actionUpdate(dossierId, req.body.updates));
    }
    if (action === 'contacts-search') return res.status(200).json(await actionContactsSearch(req.body.q));
    if (action === 'contact-create') return res.status(200).json(await actionContactCreate(req.body));
    if (action === 'contact-update') {
      const contactId = capString(req.body.contactId, 60);
      if (!/^[0-9a-f-]{32,36}$/i.test(contactId)) return res.status(400).json({ error: 'Contact invalide.' });
      return res.status(200).json(await actionContactUpdate(contactId, req.body.updates));
    }
    if (action === 'entreprises-search') return res.status(200).json(await actionEntreprisesSearch(req.body.q));
    if (action === 'entreprise-create') return res.status(200).json(await actionEntrepriseCreate(req.body.nom));
    if (action === 'dossier-create') return res.status(200).json(await actionDossierCreate(req.body));
    if (action === 'dossier-stagiaires') {
      if (!idOk) return res.status(400).json({ error: 'Dossier invalide.' });
      return res.status(200).json(await actionDossierStagiaires(dossierId, req.body.add, req.body.remove));
    }
    if (action === 'contact-corbeille') {
      const contactId = capString(req.body.contactId, 60);
      if (!/^[0-9a-f-]{32,36}$/i.test(contactId)) return res.status(400).json({ error: 'Contact invalide.' });
      return res.status(200).json(await actionContactCorbeille(contactId));
    }
    if (action === 'corbeille') {
      if (!idOk) return res.status(400).json({ error: 'Dossier invalide.' });
      return res.status(200).json(await actionCorbeille(dossierId));
    }
    if (action === 'relances') {
      // File de relances : mêmes règles que le récap Slack du lundi.
      const { relances, groups, generatedAt } = await gatherRelances();
      return res.status(200).json({ relances, groups, generatedAt });
    }
    if (action === 'relance-done') {
      if (!idOk) return res.status(400).json({ error: 'Dossier invalide.' });
      const ruleId = capString(req.body.ruleId, 60);
      if (!/^[a-z0-9-]+$/.test(ruleId)) return res.status(400).json({ error: 'Règle invalide.' });
      return res.status(200).json(await markRelanceDone(dossierId, ruleId, auth.email));
    }
    if (action === 'sante') return res.status(200).json(await santeDonnees());
    if (action === 'drive-pieces') {
      // Pièces du dossier Drive lié (champ « Lien Drive dossier »).
      if (!googleConfigured()) return res.status(200).json({ configured: false, pieces: [] });
      const lien = capString(req.body.lien, 300);
      const m = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(lien);
      if (!m) return res.status(400).json({ error: 'Le lien Drive ne pointe pas vers un dossier.' });
      try {
        return res.status(200).json({ configured: true, pieces: await listerDossierDrive(m[1]) });
      } catch (err) {
        console.error('drive-pieces:', err.message);
        const acces = /40[34]/.test(err.message);
        return res.status(200).json({ configured: true, pieces: [], erreur: acces
          ? 'Dossier Drive non partagé avec le compte de service du cockpit (cockpit-eneko@eneko-outils.iam.gserviceaccount.com) : partager la racine « Dossiers apprenants » en lecture.'
          : 'Lecture du Drive momentanément impossible.' });
      }
    }
    if (action === 'emargements') {
      // Registre d'assiduité du dossier (Edusign historique + feuilles Eneko).
      if (!idOk) return res.status(400).json({ error: 'Dossier invalide.' });
      const contactIds = (Array.isArray(req.body.contactIds) ? req.body.contactIds : []).map(x => capString(x, 60)).filter(x => /^[0-9a-f-]{32,36}$/i.test(x));
      return res.status(200).json(await emargementsDossier(dossierId, contactIds));
    }
    if (action === 'emargements-import') {
      // Import d'un export Edusign (lignes déjà aplaties par le client) — idempotent.
      const lignes = (Array.isArray(req.body.lignes) ? req.body.lignes : []).slice(0, 250).map(l => ({
        idSource: capString(l?.idSource, 100), seance: capString(l?.seance, 200), feuille: capString(l?.feuille, 200),
        debut: capString(l?.debut, 40), fin: capString(l?.fin, 40),
        type: TYPES_SEANCE.includes(l?.type) ? l.type : 'Autre', statut: STATUTS_SEANCE.includes(l?.statut) ? l.statut : 'En attente de signature',
        signeLe: capString(l?.signeLe, 40), retard: Number.isFinite(l?.retard) ? l.retard : null,
        intervenant: capString(l?.intervenant, 120), source: 'Edusign',
        email: capString(l?.email, 200).toLowerCase(), prenom: capString(l?.prenom, 80), nom: capString(l?.nom, 80),
      })).filter(l => l.idSource && l.seance && /^\d{4}-\d{2}-\d{2}T/.test(l.debut));
      if (!lignes.length) return res.status(400).json({ error: 'Aucune ligne valide.' });
      return res.status(200).json(await upsertLignes(lignes));
    }
    if (action === 'parcours') {
      // Quiz de positionnement + diagnostic des stagiaires de la fiche.
      const stagiaires = (Array.isArray(req.body.stagiaires) ? req.body.stagiaires : []).slice(0, 25)
        .map(s => ({ id: capString(s?.id, 60), nom: capString(s?.nom, 120), email: capString(s?.email, 200) }))
        .filter(s => /^[0-9a-f-]{32,36}$/i.test(s.id) && s.nom);
      return res.status(200).json({ parcours: await parcoursAmont(stagiaires) });
    }
    if (action === 'elearning-snapshot') {
      // Progression préchargée par le cron (tous les dossiers, clôturés compris).
      const snap = await readSnapshot();
      return res.status(200).json(snap || { generatedAt: null, results: {} });
    }
    if (action === 'elearning-batch') {
      // Progression Circle pour plusieurs dossiers d'un coup (colonne de la
      // liste). Lots courts appelés en série par la page : la file se remplit
      // progressivement sans bloquer l'affichage.
      if (!circleConfigured()) return res.status(200).json({ configured: false, results: {} });
      const items = (Array.isArray(req.body.dossiers) ? req.body.dossiers : []).slice(0, 8);
      const results = {};
      await Promise.all(items.map(async (it) => {
        const id = capString(it?.dossierId, 60);
        if (!/^[0-9a-f-]{32,36}$/i.test(id)) return;
        const stagiaires = (Array.isArray(it?.stagiaires) ? it.stagiaires : []).slice(0, 10)
          .map(s => ({
            nom: capString(s?.nom, 120),
            email: capString(s?.email, 200).toLowerCase(),
            emailElearning: capString(s?.emailElearning, 200).toLowerCase(),
          }))
          .filter(s => s.email || s.emailElearning);
        if (!stagiaires.length) return;
        try {
          results[id] = summarizeElearning(await elearningForStagiaires(stagiaires, capString(it?.typeFormation, 60)));
        } catch (err) {
          console.error('elearning-batch:', err.message);
        }
      }));
      return res.status(200).json({ configured: true, results });
    }
    if (action === 'elearning') {
      // Progression Circle des stagiaires de la fiche (emails déjà servis
      // par `detail` à cette même session — pas de re-fetch Notion).
      if (!circleConfigured()) {
        return res.status(200).json({ configured: false, stagiaires: [] });
      }
      const stagiaires = (Array.isArray(req.body.stagiaires) ? req.body.stagiaires : [])
        .slice(0, 25)
        .map(s => ({
          nom: capString(s?.nom, 120),
          email: capString(s?.email, 200).toLowerCase(),
          emailElearning: capString(s?.emailElearning, 200).toLowerCase(),
        }))
        .filter(s => s.nom);
      const typeFormation = capString(req.body.typeFormation, 60);
      return res.status(200).json({
        configured: true,
        stagiaires: await elearningForStagiaires(stagiaires, typeFormation),
      });
    }
    return res.status(400).json({ error: 'Action inconnue.' });
  } catch (err) {
    console.error('cockpit-dossiers error:', err.message);
    const status = err.status || 500;
    return res.status(status).json({
      error: (status === 400 || status === 409)
        ? err.message
        : 'Lecture Notion impossible. Vérifiez que la page « CRM & Suivi Apprenants » est bien connectée à l\'intégration.',
      ...(status === 409 ? { contact: err.contact, dossierId: err.dossierId } : {}),
    });
  }
}
