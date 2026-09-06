// ════════════════════════════════════════════════════════════════
//  api/_lib/relances-sources.js  —  Collecte des signaux de relance
//
//  Assemble, à partir de Notion / Blob / Circle, le contexte par dossier
//  attendu par les règles de `relances.js`, puis calcule la file.
//  Volume borné pour rester dans les délais d'une fonction serverless :
//   • liens InKréa : listing Blob `dossier-liens/` (1 appel) + lecture des
//     seuls liens candidats (≥ 5 j, non remplis, non expirés, ≤ 30 lectures) ;
//   • « faits » : listing Blob `relances-faites/` (1 appel) ;
//   • sessions incomplètes : 1 requête Notion (60 derniers jours) ;
//   • e-learning Circle : dossiers proches du démarrage ou en formation
//     seulement (≤ 15 dossiers).
// ════════════════════════════════════════════════════════════════

import { list, get, put } from '@vercel/blob';
import { DB, notion, queryAll, plain, sel, dateStart, listDossiers } from './notion-crm.js';
import { FORM_URL, LINK_TTL_MS } from './dossier-rs6776.js';
import { circleConfigured, elearningForStagiaires } from './circle.js';
import { computeRelances, groupByRule, RULES } from './relances.js';

const DAY = 86_400_000;
const DONE_PREFIX = 'relances-faites/';
const LINKS_PREFIX = 'dossier-liens/';

async function listAll(prefix) {
  const out = [];
  let cursor;
  for (let i = 0; i < 10; i++) {
    const page = await list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
    out.push(...(page.blobs || []));
    if (!page.hasMore) break;
    cursor = page.cursor;
  }
  return out;
}

/* ── Relances marquées « faites » (Blob) ─────────────────────── */

async function loadDone() {
  const done = new Map();
  try {
    for (const b of await listAll(DONE_PREFIX)) {
      const m = b.pathname.slice(DONE_PREFIX.length).match(/^(.+?)__(.+)\.json$/);
      if (m) done.set(`${m[1]}|${m[2]}`, b.uploadedAt);
    }
  } catch (err) {
    console.error('relances done list:', err.message);
  }
  return done;
}

export async function markRelanceDone(dossierId, ruleId, by = '') {
  const rule = RULES.find(r => r.id === ruleId);
  if (!rule) throw Object.assign(new Error('Règle inconnue'), { status: 400 });
  await put(`${DONE_PREFIX}${dossierId}__${ruleId}.json`,
    JSON.stringify({ dossierId, ruleId, at: new Date().toISOString(), by }),
    { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true });
  const horodatage = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short' }).format(new Date());
  try {
    await notion(`blocks/${dossierId}/children`, {
      method: 'PATCH',
      body: { children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: {
        content: `✅ Relance « ${rule.label} » traitée le ${horodatage}${by ? ` par ${by}` : ''} via le cockpit.`,
      } }] } }] },
    });
  } catch (err) {
    console.error('relances trace Notion:', err.message);
  }
  return { snoozeDays: rule.snoozeDays };
}

/* ── Liens InKréa envoyés et non remplis ─────────────────────── */

async function loadPendingLinks() {
  const pending = [];
  try {
    const blobs = await listAll(LINKS_PREFIX);
    const doneIds = new Set(blobs.filter(b => b.pathname.endsWith('.done.json'))
      .map(b => b.pathname.slice(LINKS_PREFIX.length, -'.done.json'.length)));
    const candidates = blobs.filter(b => {
      if (b.pathname.endsWith('.done.json')) return false;
      const id = b.pathname.slice(LINKS_PREFIX.length, -'.json'.length);
      const age = Date.now() - new Date(b.uploadedAt).getTime();
      return !doneIds.has(id) && age >= 5 * DAY && age < LINK_TTL_MS;
    }).slice(0, 30);
    for (const b of candidates) {
      try {
        const found = await get(b.pathname, { access: 'private' });
        if (!found?.stream) continue;
        const payload = await new Response(found.stream).json();
        const id = b.pathname.slice(LINKS_PREFIX.length, -'.json'.length);
        pending.push({
          id,
          url: `${FORM_URL}#${id}`,
          cid: payload.cid || '',
          pf: payload.pf || {},
          ageDays: Math.floor((Date.now() - new Date(b.uploadedAt).getTime()) / DAY),
        });
      } catch (err) {
        console.error('relances lien lecture:', err.message);
      }
    }
  } catch (err) {
    console.error('relances liens list:', err.message);
  }
  return pending;
}

/* ── Sessions réalisées sans émargement / éval à chaud ───────── */

async function loadIncompleteSessions() {
  const byDossier = new Map();
  try {
    const since = new Date(Date.now() - 60 * DAY).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const pages = await queryAll(DB.sessions, {
      filter: { and: [
        { property: 'Date début', date: { on_or_after: since } },
        { property: 'Date début', date: { before: today } },
        { or: [
          { property: 'Émargement OK', checkbox: { equals: false } },
          { property: 'Évaluation à chaud faite', checkbox: { equals: false } },
        ] },
      ] },
    }, 3);
    for (const s of pages) {
      const p = s.properties || {};
      const statut = sel(p['Statut']);
      if (/annul/i.test(statut)) continue;
      const item = {
        intitule: sel(p['Module']) || plain(p['Intitulé session']?.title),
        dateDebut: dateStart(p['Date début']),
        emargementOk: p['Émargement OK']?.checkbox === true,
        evalChaudFaite: p['Évaluation à chaud faite']?.checkbox === true,
      };
      for (const rel of p['Dossiers apprenants']?.relation || []) {
        if (!byDossier.has(rel.id)) byDossier.set(rel.id, []);
        byDossier.get(rel.id).push(item);
      }
    }
  } catch (err) {
    console.error('relances sessions:', err.message);
  }
  return byDossier;
}

/* ── Assemblage ──────────────────────────────────────────────── */

export async function gatherRelances(dossiersInput) {
  const dossiers = dossiersInput || await listDossiers();
  const [done, links, sessions] = await Promise.all([loadDone(), loadPendingLinks(), loadIncompleteSessions()]);

  // Liens → dossier : par identifiant de contact, sinon par email.
  const linksByDossier = new Map();
  for (const d of dossiers) {
    const mine = links.filter(l =>
      (l.cid && d.stagiaireIds.includes(l.cid)) ||
      (l.pf.email && d.stagiaireEmails.some(e => e.toLowerCase() === l.pf.email.toLowerCase()))
    );
    if (mine.length) linksByDossier.set(d.id, mine);
  }

  // E-learning : uniquement les dossiers proches du démarrage / en formation.
  const elearningByDossier = new Map();
  if (circleConfigured()) {
    const eligible = dossiers.filter(d => {
      if (d.etapes.some(e => e.includes('Clôturé'))) return false;
      if (d.etapes.some(e => e.includes('En formation'))) return true;
      if (!d.dateDebut) return false;
      const delta = (new Date(d.dateDebut).getTime() - Date.now()) / DAY;
      return delta <= 7 && delta >= -30;
    }).slice(0, 15);
    for (const d of eligible) {
      try {
        elearningByDossier.set(d.id, await elearningForStagiaires(d.stagiairesDetail, d.typeFormation));
      } catch (err) {
        console.error('relances circle:', err.message);
      }
    }
  }

  const relances = computeRelances(dossiers, (d) => ({
    liens: linksByDossier.get(d.id) || [],
    elearning: elearningByDossier.get(d.id) || null,
    sessionsIncompletes: sessions.get(d.id) || [],
  }), done);

  return { relances, groups: groupByRule(relances), generatedAt: new Date().toISOString(), dossiers };
}
