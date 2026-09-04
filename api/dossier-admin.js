// ════════════════════════════════════════════════════════════════
//  /api/dossier-admin  —  Backoffice du dossier d'inscription RS6776
//  (page interne /dossier-inscription-interne, session obligatoire)
//
//  Trois actions sur le même endpoint (toutes exigent une session
//  interne valide — email ALLOWED_EMAILS + token signé) :
//   • contacts : liste allégée de la base Notion CONTACTS (nom, email,
//     téléphone, poste, statut pipeline) pour le sélecteur ;
//   • prefill  : détail d'un contact + résolution du nom d'entreprise
//     (relation Notion) → champs pré-remplis éditables par Déborah ;
//   • lien     : dépose le payload (prefill borné + expiration 30 j)
//     dans Vercel Blob (`dossier-liens/<id>.json`, chemin non
//     devinable) et renvoie une URL courte dont le FRAGMENT (#…) ne
//     porte que l'identifiant `prenom-nom-<aléa>` : il n'atteint
//     jamais les logs serveur, et le lien reste digeste.
//
//  ⚠️ L'intégration Notion derrière NOTION_TOKEN doit être connectée
//  à la base CONTACTS (ouvrir la base → ••• → Connexions).
// ════════════════════════════════════════════════════════════════

import crypto from 'node:crypto';
import { put } from '@vercel/blob';
import { guardPost, capString } from './_lib/guard.js';
import { isAuthorized } from './_lib/token.js';
import { LINK_TTL_MS } from './_lib/dossier-rs6776.js';

const NOTION_VERSION = '2022-06-28';
// Base « CONTACTS » (sous « CRM & Suivi Apprenants »).
const CONTACTS_DB_ID = process.env.NOTION_DB_CONTACTS || 'db1c59272df24d7f8f0a9125c9a5b844';

const FORM_URL = 'https://outils.eneko.ai/dossier-inscription/';

/* ─── Helpers Notion ─────────────────────────────────────────── */

function notionHeaders() {
  return {
    'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

const plain = (arr) => (Array.isArray(arr) ? arr.map(t => t?.plain_text || '').join('') : '');

function contactFromPage(pageObj) {
  const p = pageObj?.properties || {};
  return {
    id: pageObj.id,
    nom: plain(p['Nom complet']?.title),
    email: p['Email']?.email || '',
    telephone: p['Téléphone']?.phone_number || '',
    poste: plain(p['Poste']?.rich_text),
    formation: plain(p['Formation souhaitée']?.rich_text),
    statut: p['Statut pipeline']?.select?.name || '',
    entrepriseId: p['Entreprise']?.relation?.[0]?.id || null,
  };
}

async function listContacts() {
  const contacts = [];
  let cursor;
  // Pagination bornée : 5 pages × 100 = 500 contacts max.
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`https://api.notion.com/v1/databases/${CONTACTS_DB_ID}/query`, {
      method: 'POST',
      headers: notionHeaders(),
      body: JSON.stringify({
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
        sorts: [{ property: 'Nom complet', direction: 'ascending' }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Notion query ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    for (const pageObj of data.results || []) contacts.push(contactFromPage(pageObj));
    if (!data.has_more) break;
    cursor = data.next_cursor;
  }
  return contacts.filter(c => c.nom);
}

async function fetchPage(pageId) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    headers: notionHeaders(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Notion page ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// Titre d'une page quelle que soit sa propriété title (ex. nom d'entreprise).
function pageTitle(pageObj) {
  for (const prop of Object.values(pageObj?.properties || {})) {
    if (prop?.type === 'title') return plain(prop.title);
  }
  return '';
}

/* ─── Handler ────────────────────────────────────────────────── */

export default async function handler(req, res) {
  if (!(await guardPost(req, res, { maxBodyChars: 8_000, limit: 60, windowMs: 60_000 }))) return;

  const { action, auth } = req.body || {};
  if (!auth || !isAuthorized(auth.email, auth.token)) {
    return res.status(401).json({ error: 'Session interne requise.' });
  }
  // Seules les actions de lecture Notion exigent NOTION_TOKEN ; « lien »
  // ne fait que signer un payload.
  if ((action === 'contacts' || action === 'prefill') && !process.env.NOTION_TOKEN) {
    console.error('dossier-admin : NOTION_TOKEN non configuré.');
    return res.status(500).json({ error: 'Service momentanément indisponible.' });
  }

  try {
    if (action === 'contacts') {
      return res.status(200).json({ contacts: await listContacts() });
    }

    if (action === 'prefill') {
      const contactId = capString(req.body.contactId, 60);
      if (!/^[0-9a-f-]{32,36}$/i.test(contactId)) {
        return res.status(400).json({ error: 'Contact invalide.' });
      }
      const pageObj = await fetchPage(contactId);
      const c = contactFromPage(pageObj);
      let entreprise = '';
      if (c.entrepriseId) {
        try {
          entreprise = pageTitle(await fetchPage(c.entrepriseId));
        } catch (e) {
          console.error('dossier-admin : résolution entreprise échouée —', e.message);
        }
      }
      // « Nom complet » CRM → première ébauche prénom / nom d'usage.
      const parts = c.nom.split(/\s+/);
      return res.status(200).json({
        prefill: {
          prenom: parts[0] || '',
          nomUsage: parts.slice(1).join(' '),
          email: c.email,
          telephone: c.telephone,
          intitulePoste: c.poste,
          nomEntreprise: entreprise,
        },
      });
    }

    if (action === 'lien') {
      const src = req.body.prefill || {};
      // Payload borné : uniquement les 6 champs pré-remplissables, cappés.
      const pf = {
        prenom: capString(src.prenom, 80),
        nomUsage: capString(src.nomUsage, 80),
        email: capString(src.email, 200),
        telephone: capString(src.telephone, 40),
        intitulePoste: capString(src.intitulePoste, 150),
        nomEntreprise: capString(src.nomEntreprise, 150),
      };
      const exp = Date.now() + LINK_TTL_MS;
      const contactId = capString(req.body.contactId, 40);

      // Identifiant lisible + partie aléatoire non devinable (~50 bits,
      // alphabet sans caractères ambigus). Le blob n'est accessible que
      // par ce chemin ; il porte le prefill et l'expiration.
      const slug = `${pf.prenom}-${pf.nomUsage}`
        .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'candidat';
      const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
      const rand = Array.from(crypto.randomBytes(10), b => alphabet[b % alphabet.length]).join('');
      const linkId = `${slug}-${rand}`;

      // ⚠️ Store Blob configuré en accès PRIVÉ : jamais 'public' ici
      // (refusé par le store) — la lecture se fait côté serveur via
      // get(..., { access: 'private' }) dans dossier-submit.
      await put(
        `dossier-liens/${linkId}.json`,
        JSON.stringify({ v: 1, cert: 'RS6776', exp, cid: contactId, pf }),
        { access: 'private', contentType: 'application/json', addRandomSuffix: false }
      );
      return res.status(200).json({ url: `${FORM_URL}#${linkId}`, exp });
    }

    return res.status(400).json({ error: 'Action inconnue.' });
  } catch (err) {
    console.error('dossier-admin error:', err.message);
    return res.status(500).json({
      error: action === 'lien'
        ? 'La génération du lien a échoué. Réessayez dans un instant.'
        : 'Lecture Notion impossible. Vérifiez que la base CONTACTS est bien connectée à l\'intégration.',
    });
  }
}
