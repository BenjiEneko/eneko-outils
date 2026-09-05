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

const NOTION_VERSION = '2022-06-28';
const DB = {
  dossiers: process.env.NOTION_DB_DOSSIERS || '936d5185234e46d29e968a2ade17589e',
  contacts: process.env.NOTION_DB_CONTACTS || 'db1c59272df24d7f8f0a9125c9a5b844',
  entreprises: process.env.NOTION_DB_ENTREPRISES || 'b4d305765f464e659cf2736f273c49b3',
  sessions: process.env.NOTION_DB_SESSIONS || '49937c8f77794196b816d4ebb494b9d3',
  candidats: process.env.NOTION_DB_CANDIDATS_RS6776 || '2fad56ab9c9a802f883dd769748a4ed1',
};

// Propriétés que le cockpit a le droit d'écrire, et leur type Notion.
const WRITABLE = {
  'Étape admin': 'multi_select',
  'Statut dossier': 'select',
  'Statut paiement': 'select',
};

/* ─── Helpers Notion ─────────────────────────────────────────── */

function notionHeaders() {
  return {
    'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

async function notion(path, { method = 'GET', body } = {}) {
  const res = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: notionHeaders(),
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Notion ${method} ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// Paginе une query de base (bornée à `maxPages` × 100 lignes).
async function queryAll(dbId, body = {}, maxPages = 6) {
  const results = [];
  let cursor;
  for (let i = 0; i < maxPages; i++) {
    const data = await notion(`databases/${dbId}/query`, {
      method: 'POST',
      body: { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}), ...body },
    });
    results.push(...(data.results || []));
    if (!data.has_more) break;
    cursor = data.next_cursor;
  }
  return results;
}

const plain = (arr) => (Array.isArray(arr) ? arr.map(t => t?.plain_text || '').join('') : '');
const sel = (p) => p?.select?.name || '';
const multi = (p) => (p?.multi_select || []).map(o => o.name);
const rel = (p) => (p?.relation || []).map(r => r.id);
const dateStart = (p) => p?.date?.start || '';

function titleOf(pageObj) {
  for (const prop of Object.values(pageObj?.properties || {})) {
    if (prop?.type === 'title') return plain(prop.title);
  }
  return '';
}

/* ─── Parsing d'un dossier ───────────────────────────────────── */

function dossierFromPage(pg) {
  const p = pg.properties || {};
  return {
    id: pg.id,
    url: pg.url,
    reference: plain(p['Référence dossier']?.title),
    stagiaireIds: rel(p['Stagiaire(s)']),
    entrepriseIds: rel(p['Entreprise']),
    etapes: multi(p['Étape admin']),
    statutDossier: sel(p['Statut dossier']),
    statutPaiement: sel(p['Statut paiement']),
    financement: sel(p['Financement']),
    typeFormation: sel(p['Type de formation']),
    session: sel(p['Session']),
    dateDebut: dateStart(p['Date début formation']),
    dateFin: dateStart(p['Date fin formation']),
    dateElearning: dateStart(p['Date accès e-learning']),
    dateLimiteFactu: dateStart(p['Date limite facturation']),
    montantHT: p['Montant total HT']?.number ?? null,
    numEdof: plain(p['N° dossier EDOF']?.rich_text),
    numOpco: plain(p['N° dossier OPCO']?.rich_text),
    numFacture: plain(p['N° facture']?.rich_text),
    lienDrive: p['Lien Drive dossier']?.url || '',
    notes: plain(p['Notes']?.rich_text),
    createdTime: pg.created_time,
  };
}

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
    statutsDossier: opts('Statut dossier'),
    statutsPaiement: opts('Statut paiement'),
    financements: opts('Financement'),
    typesFormation: opts('Type de formation'),
    sessions: opts('Session'),
  };
  metaCache = { at: Date.now(), data };
  return data;
}

/* ─── Actions ────────────────────────────────────────────────── */

async function actionList() {
  const [dossierPages, contactPages, entreprisePages] = await Promise.all([
    queryAll(DB.dossiers, { sorts: [{ timestamp: 'created_time', direction: 'descending' }] }),
    queryAll(DB.contacts),
    queryAll(DB.entreprises),
  ]);

  const contacts = {};
  for (const pg of contactPages) {
    contacts[pg.id] = {
      nom: titleOf(pg),
      email: pg.properties?.['Email']?.email || '',
      telephone: pg.properties?.['Téléphone']?.phone_number || '',
    };
  }
  const entreprises = {};
  for (const pg of entreprisePages) entreprises[pg.id] = titleOf(pg);

  const dossiers = dossierPages.map(dossierFromPage).map(d => ({
    ...d,
    stagiaires: d.stagiaireIds.map(id => contacts[id]?.nom || '?'),
    entreprise: d.entrepriseIds.map(id => entreprises[id] || '?').join(', '),
  }));

  return { dossiers, meta: await getMeta() };
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
          telephone: c.properties?.['Téléphone']?.phone_number || '',
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

async function actionUpdate(dossierId, updates) {
  if (!updates || typeof updates !== 'object') throw Object.assign(new Error('updates manquant'), { status: 400 });
  const meta = await getMeta();
  const allowedValues = {
    'Étape admin': meta.etapes,
    'Statut dossier': meta.statutsDossier,
    'Statut paiement': meta.statutsPaiement,
  };

  const properties = {};
  for (const [name, value] of Object.entries(updates)) {
    const type = WRITABLE[name];
    if (!type) throw Object.assign(new Error(`Propriété non modifiable : ${name}`), { status: 400 });
    if (type === 'multi_select') {
      if (!Array.isArray(value) || value.some(v => !allowedValues[name].includes(v))) {
        throw Object.assign(new Error(`Valeur inconnue pour ${name}`), { status: 400 });
      }
      properties[name] = { multi_select: value.map(v => ({ name: v })) };
    } else {
      if (value !== '' && !allowedValues[name].includes(value)) {
        throw Object.assign(new Error(`Valeur inconnue pour ${name}`), { status: 400 });
      }
      properties[name] = { select: value === '' ? null : { name: value } };
    }
  }
  if (!Object.keys(properties).length) throw Object.assign(new Error('Aucune modification'), { status: 400 });

  await notion(`pages/${dossierId}`, { method: 'PATCH', body: { properties } });
  return { ok: true };
}

/* ─── Handler ────────────────────────────────────────────────── */

export default async function handler(req, res) {
  if (!(await guardPost(req, res, { maxBodyChars: 8_000, limit: 120, windowMs: 60_000 }))) return;

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
    return res.status(400).json({ error: 'Action inconnue.' });
  } catch (err) {
    console.error('cockpit-dossiers error:', err.message);
    const status = err.status || 500;
    return res.status(status).json({
      error: status === 400
        ? err.message
        : 'Lecture Notion impossible. Vérifiez que la page « CRM & Suivi Apprenants » est bien connectée à l\'intégration.',
    });
  }
}
