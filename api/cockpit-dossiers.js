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
  DB, notion, queryAll, plain, sel, dateStart, titleOf, dossierFromPage, listDossiers,
} from './_lib/notion-crm.js';
import { circleConfigured, elearningForStagiaires, summarizeElearning } from './_lib/circle.js';
import { gatherRelances, markRelanceDone } from './_lib/relances-sources.js';
import { readSnapshot } from './_lib/elearning-snapshot.js';

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

// Met à la corbeille Notion (récupérable 30 j) un dossier-COQUILLE uniquement :
// aucune donnée métier. Sert à éliminer les doublons vides créés en double par
// une automatisation ; un dossier qui porte la moindre information est refusé.
async function actionCorbeille(dossierId) {
  const pg = await notion(`pages/${dossierId}`);
  if (pg.parent?.database_id?.replace(/-/g, '') !== DB.dossiers.replace(/-/g, '')) {
    throw Object.assign(new Error('Ce n\'est pas un dossier.'), { status: 400 });
  }
  const d = dossierFromPage(pg);
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
      error: status === 400
        ? err.message
        : 'Lecture Notion impossible. Vérifiez que la page « CRM & Suivi Apprenants » est bien connectée à l\'intégration.',
    });
  }
}
