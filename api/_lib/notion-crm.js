// ════════════════════════════════════════════════════════════════
//  api/_lib/notion-crm.js  —  Accès partagé au CRM Notion
//  (bases DOSSIERS / CONTACTS / ENTREPRISES / SESSIONS / Candidats)
//
//  Utilisé par /api/cockpit-dossiers (tableau de suivi) et
//  /api/cockpit-docs (génération de documents). Lecture en direct,
//  aucune copie locale : Notion reste la vérité.
// ════════════════════════════════════════════════════════════════

const NOTION_VERSION = '2022-06-28';

export const DB = {
  dossiers: process.env.NOTION_DB_DOSSIERS || '936d5185234e46d29e968a2ade17589e',
  contacts: process.env.NOTION_DB_CONTACTS || 'db1c59272df24d7f8f0a9125c9a5b844',
  entreprises: process.env.NOTION_DB_ENTREPRISES || 'b4d305765f464e659cf2736f273c49b3',
  sessions: process.env.NOTION_DB_SESSIONS || '49937c8f77794196b816d4ebb494b9d3',
  candidats: process.env.NOTION_DB_CANDIDATS_RS6776 || '2fad56ab9c9a802f883dd769748a4ed1',
};

function notionHeaders() {
  return {
    'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

export async function notion(path, { method = 'GET', body } = {}) {
  const res = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: notionHeaders(),
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Notion ${method} ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// Pagine une query de base (bornée à `maxPages` × 100 lignes).
export async function queryAll(dbId, body = {}, maxPages = 6) {
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

/* ── Extracteurs de propriétés ────────────────────────────────── */

export const plain = (arr) => (Array.isArray(arr) ? arr.map(t => t?.plain_text || '').join('') : '');
export const sel = (p) => p?.select?.name || '';
export const multi = (p) => (p?.multi_select || []).map(o => o.name);
export const rel = (p) => (p?.relation || []).map(r => r.id);
export const dateStart = (p) => p?.date?.start || '';

export function titleOf(pageObj) {
  for (const prop of Object.values(pageObj?.properties || {})) {
    if (prop?.type === 'title') return plain(prop.title);
  }
  return '';
}

// Retrouve une propriété texte par nom approximatif (ex. « SIRET »,
// « Adresse ») quel que soit son libellé exact dans la base.
export function fuzzyText(pageObj, regex) {
  for (const [name, prop] of Object.entries(pageObj?.properties || {})) {
    if (!regex.test(name)) continue;
    if (prop.type === 'rich_text') return plain(prop.rich_text);
    if (prop.type === 'title') return plain(prop.title);
    if (prop.type === 'phone_number') return prop.phone_number || '';
    if (prop.type === 'email') return prop.email || '';
    if (prop.type === 'url') return prop.url || '';
  }
  return '';
}

/* ── Parsing d'un dossier (base DOSSIERS) ─────────────────────── */

export function dossierFromPage(pg) {
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
