// ════════════════════════════════════════════════════════════════
//  api/_lib/parcours-amont.js  —  Résultats « amont » d'un stagiaire
//
//  Trois bases Notion alimentées par les outils publics du site :
//   • Résultats quiz Positionnement IA Générative (outil positionnement-ia-generative)
//   • Résultats quiz Positionnement Automatisation IA (positionnement-ia-automatisation)
//   • Diagnostics Opportunités IA (vos-opportunites-avec-lia)
//  Elles n'ont AUCUNE relation avec CONTACTS : le rapprochement se fait par
//  email (exact) puis, à défaut, par nom de famille dans le titre.
// ════════════════════════════════════════════════════════════════

import { queryAll, plain, sel, dateStart, titleOf } from './notion-crm.js';

export const SOURCES = [
  { key: 'quizIAG', label: 'Quiz positionnement IA générative', db: process.env.NOTION_DB_ID || '111daca697c545919ae84d9e33af9b5e', titre: 'Nom Prénom', date: 'Date Quizz' },
  { key: 'quizIAA', label: 'Quiz positionnement Automatisation IA', db: process.env.NOTION_DB_ID_AUTO || 'ed7cb88dea6a401eacd6eb026e5fb1cf', titre: 'Nom Prénom', date: 'Date Quizz' },
  { key: 'diagnostic', label: 'Diagnostic opportunités IA', db: process.env.NOTION_DB_DIAGNOSTIC || '6c806117b38948f8b6de743f449fccdb', titre: 'Nom complet', date: 'Date diagnostic' },
];

const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const nomFamille = (nom) => {
  const mots = String(nom || '').trim().split(/\s+/).filter(Boolean);
  const majs = mots.filter(m => m.length > 1 && m === m.toUpperCase());
  return (majs.length ? majs : mots.slice(-1)).join(' ');
};

function ligne(source, pg) {
  const p = pg.properties || {};
  const base = {
    source: source.key, label: source.label, id: pg.id, notionUrl: pg.url,
    nom: titleOf(pg), email: (p['Email']?.email || '').toLowerCase(),
    date: dateStart(p[source.date]) || (pg.created_time || '').slice(0, 10),
  };
  if (source.key === 'diagnostic') {
    return { ...base, profil: plain(p['Profil']?.rich_text), metier: plain(p['Métier']?.rich_text),
      quickWin: plain(p['Quick win']?.rich_text), opportunites: plain(p['Opportunités IA']?.rich_text),
      outils: plain(p['Outils recommandés']?.rich_text), emailEnvoye: p['Email envoyé']?.checkbox === true };
  }
  return { ...base, profil: sel(p['Profil']), score: p['Score']?.number ?? null,
    objectifs: plain(p['Objectifs']?.rich_text), entreprise: plain(p['Entreprise']?.rich_text) };
}

// stagiaires : [{ id, nom, email }] → { [stagiaireId]: { quizIAG, quizIAA, diagnostic } }
// Une requête par base (filtre OR sur tous les stagiaires), puis rapprochement.
export async function parcoursAmont(stagiaires) {
  const liste = stagiaires.slice(0, 25).map(s => ({ ...s, email: (s.email || '').toLowerCase(), famille: nomFamille(s.nom) }));
  const out = Object.fromEntries(liste.map(s => [s.id, { quizIAG: null, quizIAA: null, diagnostic: null }]));
  if (!liste.length) return out;

  await Promise.all(SOURCES.map(async (source) => {
    const or = [];
    for (const s of liste) {
      if (s.email) or.push({ property: 'Email', email: { equals: s.email } });
      if (s.famille.length >= 3) or.push({ property: source.titre, title: { contains: s.famille } });
    }
    if (!or.length) return;
    let pages = [];
    try {
      pages = await queryAll(source.db, { filter: or.length === 1 ? or[0] : { or: or.slice(0, 100) }, page_size: 100 }, 1);
    } catch (err) {
      console.error(`parcours-amont ${source.key}:`, err.message);
      return;
    }
    const lignes = pages.map(pg => ligne(source, pg)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    for (const s of liste) {
      // priorité à l'email exact, sinon nom de famille contenu dans le titre
      const hit = lignes.find(l => s.email && l.email === s.email)
        || lignes.find(l => s.famille.length >= 3 && norm(l.nom).includes(norm(s.famille)));
      if (hit) out[s.id][source.key] = hit;
    }
  }));
  return out;
}
