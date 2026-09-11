// ════════════════════════════════════════════════════════════════
//  api/_lib/emargement.js  —  Feuilles d'émargement Eneko
//
//  Remplace Edusign en s'appuyant sur ce qui existe déjà :
//   • la session vient de la base Notion SESSIONS (date, module, lieu…) ;
//   • les participants sont DÉDUITS : dossiers rattachés → stagiaires
//     (base CONTACTS) + formateur (base FORMATEURS). Rien à ressaisir.
//
//  Stockage (Vercel Blob, store PRIVÉ) — pensé sans course de données :
//   • `emargements/<sessionId>.json` — la feuille : définition des
//     participants et de leurs jetons. Écrite rarement (ouverture, synchro).
//   • `emargement-signatures/<sessionId>/<pid>.json|.png` — UNE écriture
//     par participant au moment où il signe : deux apprenants qui signent
//     à la même seconde ne peuvent pas s'écraser.
//   • `emargement-signatures/<sessionId>/<pid>.mark.json` — présence
//     corrigée à la main par l'équipe (présent / absent / excusé).
//   • `emargement-liens/<token>.json` — pointeur jeton → (session, pid),
//     pour que le lien envoyé reste court.
//   L'état réel d'une feuille = définition + listing de ces marqueurs.
//
//  ⚠️ Valeur probante : signature électronique SIMPLE (eIDAS) appuyée sur
//  un faisceau de preuves — lien nominatif non devinable, horodatage
//  serveur, IP, user-agent, empreinte SHA-256 du PDF. C'est le niveau
//  usuel de l'émargement de formation, mais la conformité au regard de
//  vos financeurs reste à valider par votre référent Qualiopi.
// ════════════════════════════════════════════════════════════════

import crypto from 'node:crypto';
import { put, get, list } from '@vercel/blob';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { DB, notion, plain, sel, rel, titleOf, listDossiers } from './notion-crm.js';
import { winAnsi } from './pdf-text.js';

const SHEETS = 'emargements/';
const LINKS = 'emargement-liens/';
const SIGNS = 'emargement-signatures/';
const PDFS = 'emargements-pdf/';

export const SIGN_URL = 'https://outils.eneko.ai/emargement/';

export const ORGANISME = {
  nom: 'ENEKO Formation — SARL M&BOCA',
  adresse: '80Q rue des Poissonniers, 33470 Le Teich',
  siret: '827 729 682 00043',
  nda: '75400178140',
  mention: "Déclaration d'activité enregistrée sous le n° 75400178140 auprès du préfet de région "
    + "Nouvelle-Aquitaine. Cet enregistrement ne vaut pas agrément de l'État.",
};

export const STATUTS_MANUELS = ['present', 'absent', 'excuse'];

/* ─── Utilitaires ────────────────────────────────────────────── */

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const jeton = (n = 12) =>
  Array.from(crypto.randomBytes(n), b => ALPHABET[b % ALPHABET.length]).join('');

const norm = (id) => String(id || '').replace(/-/g, '');

export const parisDateTime = (iso, opts = { dateStyle: 'long', timeStyle: 'short' }) =>
  iso ? new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', ...opts }).format(new Date(iso)) : '';

export const parisHeure = (iso) =>
  iso ? new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '';

async function readJson(pathname) {
  try {
    const found = await get(pathname, { access: 'private', abortSignal: AbortSignal.timeout(8_000) });
    if (!found?.stream) return null;
    return await new Response(found.stream).json();
  } catch (err) {
    if (/not found|404/i.test(err.message)) return null;
    throw err;
  }
}

const writeJson = (pathname, data) =>
  put(pathname, JSON.stringify(data), {
    access: 'private', contentType: 'application/json',
    addRandomSuffix: false, allowOverwrite: true,
  });

async function listAll(prefix) {
  const out = [];
  let cursor;
  for (let i = 0; i < 5; i++) {
    const page = await list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
    out.push(...(page.blobs || []));
    if (!page.hasMore) break;
    cursor = page.cursor;
  }
  return out;
}

/* ─── Sessions (base Notion SESSIONS) ────────────────────────── */

export function sessionFromPage(pg) {
  const p = pg.properties || {};
  const lieu = p['Lieu']?.place;
  return {
    id: pg.id,
    url: pg.url,
    intitule: plain(p['Intitulé session']?.title),
    module: sel(p['Module']),
    type: sel(p['Type de session']),
    statut: sel(p['Statut']),
    debut: p['Date début']?.date?.start || '',
    fin: p['Date fin']?.date?.start || p['Date début']?.date?.end || '',
    duree: p['Durée (h)']?.number ?? null,
    lienVisio: p['Lien visio']?.url || '',
    lieu: lieu?.name || lieu?.address || '',
    formateurIds: rel(p['Formateur']),
    dossierIds: rel(p['Dossiers apprenants']),
    emargementOk: p['Émargement OK']?.checkbox === true,
    presents: p['Présents']?.number ?? null,
  };
}

export async function getSession(sessionId) {
  return sessionFromPage(await notion(`pages/${sessionId}`));
}

// Participants attendus : stagiaires des dossiers rattachés + formateur(s).
export async function buildParticipants(session, dossiersCache) {
  const out = [];
  if (session.dossierIds.length) {
    const tous = dossiersCache || await listDossiers();
    const parId = new Map(tous.map(d => [norm(d.id), d]));
    for (const did of session.dossierIds) {
      const d = parId.get(norm(did));
      if (!d) continue;
      for (const s of d.stagiairesDetail || []) {
        if (out.some(x => norm(x.contactId) === norm(s.id))) continue;
        out.push({
          role: 'apprenant', contactId: s.id, nom: s.nom, email: s.email,
          entreprise: d.entreprise || '', dossierRef: d.reference || '',
        });
      }
    }
  }
  for (const fid of session.formateurIds) {
    if (out.some(x => norm(x.contactId) === norm(fid))) continue;
    try {
      const f = await notion(`pages/${fid}`);
      out.push({
        role: 'formateur', contactId: fid, nom: titleOf(f),
        email: f.properties?.['Email']?.email || '', entreprise: '', dossierRef: '',
      });
    } catch (err) {
      console.error('émargement formateur:', err.message);
    }
  }
  return out;
}

/* ─── Feuille : ouverture et synchronisation ─────────────────── */

const sheetPath = (sessionId) => `${SHEETS}${norm(sessionId)}.json`;

export const readSheet = (sessionId) => readJson(sheetPath(sessionId));

// Idempotent : crée la feuille si absente, sinon ajoute les participants
// apparus depuis (nouveau dossier rattaché) sans toucher aux existants.
export async function openSheet(session, participants, par) {
  const existante = await readSheet(session.id);
  const infoSession = {
    intitule: session.intitule, module: session.module, type: session.type,
    debut: session.debut, fin: session.fin, duree: session.duree,
    lieu: session.lieu, lienVisio: session.lienVisio, url: session.url,
  };

  if (existante) {
    const connus = new Set(existante.participants.map(p => norm(p.contactId)));
    const ajouts = participants
      .filter(p => !connus.has(norm(p.contactId)))
      .map(p => ({ ...p, pid: jeton() }));
    if (!ajouts.length && JSON.stringify(existante.session) === JSON.stringify(infoSession)) {
      return existante;
    }
    existante.session = infoSession;
    existante.participants.push(...ajouts);
    await Promise.all(ajouts.map(p =>
      writeJson(`${LINKS}${p.pid}.json`, { sessionId: norm(session.id), pid: p.pid })));
    await writeJson(sheetPath(session.id), existante);
    return existante;
  }

  const feuille = {
    v: 1,
    sessionId: norm(session.id),
    session: infoSession,
    ouverteLe: new Date().toISOString(),
    ouvertePar: par,
    participants: participants.map(p => ({ ...p, pid: jeton() })),
    envois: [],
  };
  await Promise.all(feuille.participants.map(p =>
    writeJson(`${LINKS}${p.pid}.json`, { sessionId: norm(session.id), pid: p.pid })));
  await writeJson(sheetPath(session.id), feuille);
  return feuille;
}

/* ─── État réel : feuille + marqueurs individuels ────────────── */

export async function sheetState(sessionId) {
  const feuille = await readSheet(sessionId);
  if (!feuille) return null;
  const prefix = `${SIGNS}${norm(sessionId)}/`;
  const blobs = await listAll(prefix).catch(() => []);
  const metas = await Promise.all(
    blobs.filter(b => b.pathname.endsWith('.json'))
      .map(async b => ({ pathname: b.pathname, data: await readJson(b.pathname).catch(() => null) }))
  );

  const signatures = new Map();
  const marques = new Map();
  for (const { pathname, data } of metas) {
    if (!data) continue;
    const fichier = pathname.slice(prefix.length);
    if (fichier.endsWith('.mark.json')) marques.set(fichier.slice(0, -'.mark.json'.length), data);
    else signatures.set(fichier.slice(0, -'.json'.length), data);
  }

  const participants = feuille.participants.map(p => {
    const sig = signatures.get(p.pid);
    const mark = marques.get(p.pid);
    return {
      ...p,
      lien: `${SIGN_URL}#${p.pid}`,
      signe: !!sig,
      signeLe: sig?.at || '',
      signatureImage: sig ? `${prefix}${p.pid}.png` : '',
      preuve: sig ? { ip: sig.ip || '', ua: sig.ua || '' } : null,
      marque: mark?.statut || '',
      marqueLe: mark?.at || '',
      marquePar: mark?.par || '',
      statut: sig ? 'signe' : (mark?.statut || 'attente'),
    };
  });

  return { ...feuille, participants };
}

/* ─── Signature d'un participant ─────────────────────────────── */

export const readLink = (token) => readJson(`${LINKS}${token}.json`);

// Renvoie la session et le participant visés par un jeton, ou null.
export async function resolveToken(token) {
  if (typeof token !== 'string' || !/^[a-z0-9]{8,24}$/.test(token)) return null;
  const lien = await readLink(token);
  if (!lien) return null;
  const etat = await sheetState(lien.sessionId);
  if (!etat) return null;
  const participant = etat.participants.find(p => p.pid === lien.pid);
  if (!participant) return null;
  return { feuille: etat, participant };
}

const PNG_PREFIXE = 'data:image/png;base64,';

export async function signer(token, { dataUrl, ip = '', ua = '' }) {
  const cible = await resolveToken(token);
  if (!cible) return { error: 'Lien invalide.' };
  if (cible.participant.signe) return { deja: true, feuille: cible.feuille, participant: cible.participant };

  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PNG_PREFIXE) || dataUrl.length > 400_000) {
    return { error: 'Signature invalide.' };
  }
  const base64 = dataUrl.slice(PNG_PREFIXE.length);
  if (!/^[A-Za-z0-9+/=]+$/.test(base64)) return { error: 'Signature invalide.' };
  const bin = Buffer.from(base64, 'base64');
  if (bin.length < 200) return { error: 'Signature trop courte — merci de signer dans le cadre.' };

  const dossier = `${SIGNS}${norm(cible.feuille.sessionId)}/${cible.participant.pid}`;
  await put(`${dossier}.png`, bin, {
    access: 'private', contentType: 'image/png', addRandomSuffix: false, allowOverwrite: true,
  });
  await writeJson(`${dossier}.json`, {
    pid: cible.participant.pid, nom: cible.participant.nom, email: cible.participant.email,
    at: new Date().toISOString(), ip, ua: String(ua).slice(0, 300),
  });
  return { ok: true, feuille: cible.feuille, participant: cible.participant };
}

// Présence corrigée à la main par l'équipe (jamais sur un signataire).
export async function marquer(sessionId, pid, statut, par) {
  if (!STATUTS_MANUELS.includes(statut) && statut !== '') {
    return { error: 'Statut inconnu.' };
  }
  const etat = await sheetState(sessionId);
  if (!etat) return { error: "Aucune feuille d'émargement ouverte." };
  const p = etat.participants.find(x => x.pid === pid);
  if (!p) return { error: 'Participant inconnu.' };
  if (p.signe) return { error: 'Ce participant a signé : sa signature fait foi.' };
  await writeJson(`${SIGNS}${norm(sessionId)}/${pid}.mark.json`,
    statut ? { pid, statut, at: new Date().toISOString(), par } : { pid, statut: '', at: new Date().toISOString(), par });
  return { ok: true };
}

/* ─── PDF de la feuille d'émargement ─────────────────────────── */

const A4 = { w: 595.28, h: 841.89 };
const ML = 45;
const INK = rgb(0.1, 0.1, 0.12);
const SOFT = rgb(0.42, 0.42, 0.45);
const LINE = rgb(0.82, 0.81, 0.79);
const ACCENT = rgb(128 / 255, 55 / 255, 238 / 255);

const LIBELLE_STATUT = {
  signe: 'Signé', present: 'Présent (attesté par l’organisme)',
  absent: 'Absent', excuse: 'Absent excusé', attente: 'Non signé',
};

export async function buildEmargementPdf(etat, { genereLe = new Date(), genereBy = '' } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  doc.setTitle(`Feuille d'émargement — ${etat.session.intitule}`);
  doc.setCreator('outils.eneko.ai');

  // Signatures embarquées (une image par signataire).
  const images = new Map();
  for (const p of etat.participants) {
    if (!p.signatureImage) continue;
    try {
      const found = await get(p.signatureImage, { access: 'private', abortSignal: AbortSignal.timeout(8_000) });
      if (!found?.stream) continue;
      const buf = new Uint8Array(await new Response(found.stream).arrayBuffer());
      images.set(p.pid, await doc.embedPng(buf));
    } catch (err) {
      console.error('émargement signature PDF:', err.message);
    }
  }

  let page;
  let y;
  const at = (yTop) => A4.h - yTop;
  const W = A4.w - ML * 2;

  const pied = (numero) => {
    page.drawLine({ start: { x: ML, y: at(795) }, end: { x: ML + W, y: at(795) }, thickness: 0.5, color: LINE });
    const l1 = `${ORGANISME.nom} — ${ORGANISME.adresse} — SIRET ${ORGANISME.siret} — NDA ${ORGANISME.nda}`;
    page.drawText(winAnsi(l1), { x: ML, y: at(806), size: 6.8, font, color: SOFT });
    page.drawText(winAnsi(ORGANISME.mention), { x: ML, y: at(815), size: 6.8, font, color: SOFT });
    const p = `Page ${numero}`;
    page.drawText(p, { x: ML + W - font.widthOfTextAtSize(p, 7), y: at(806), size: 7, font, color: SOFT });
  };

  let numero = 0;
  const nouvellePage = () => {
    numero += 1;
    page = doc.addPage([A4.w, A4.h]);
    pied(numero);
    y = 52;
  };

  const texte = (t, { size = 9.5, f = font, color = INK, x = ML, dy = 13 } = {}) => {
    page.drawText(winAnsi(t), { x, y: at(y), size, font: f, color });
    y += dy;
  };

  nouvellePage();

  // En-tête
  page.drawText('eneko', { x: ML, y: at(y + 2), size: 20, font: bold, color: INK });
  page.drawText('.ai', { x: ML + bold.widthOfTextAtSize('eneko', 20), y: at(y + 2), size: 20, font: bold, color: ACCENT });
  const titre = "FEUILLE D'ÉMARGEMENT";
  page.drawText(titre, { x: ML + W - bold.widthOfTextAtSize(titre, 14), y: at(y), size: 14, font: bold, color: INK });
  y += 26;
  page.drawLine({ start: { x: ML, y: at(y) }, end: { x: ML + W, y: at(y) }, thickness: 1, color: ACCENT });
  y += 22;

  // Bloc session
  const paire = (label, valeurBrute, x, largeur) => {
    page.drawText(winAnsi(label).toUpperCase(), { x, y: at(y), size: 6.8, font, color: SOFT });
    const valeur = winAnsi(valeurBrute) || '—';
    const lignes = [];
    let cur = '';
    for (const mot of String(valeur).split(/\s+/)) {
      const essai = cur ? `${cur} ${mot}` : mot;
      if (bold.widthOfTextAtSize(essai, 9.5) <= largeur) cur = essai;
      else { if (cur) lignes.push(cur); cur = mot; }
    }
    if (cur) lignes.push(cur);
    lignes.slice(0, 2).forEach((l, i) => {
      page.drawText(l, { x, y: at(y + 11 + i * 11), size: 9.5, font: bold, color: INK });
    });
    return lignes.slice(0, 2).length;
  };

  const colonnes = [ML, ML + W / 3, ML + (2 * W) / 3];
  const largeurCol = W / 3 - 12;
  let lignesMax = 0;
  lignesMax = Math.max(lignesMax, paire('Session', etat.session.intitule, colonnes[0], largeurCol));
  lignesMax = Math.max(lignesMax, paire('Module', etat.session.module, colonnes[1], largeurCol));
  lignesMax = Math.max(lignesMax, paire('Modalité', etat.session.type, colonnes[2], largeurCol));
  y += 11 + lignesMax * 11 + 8;

  const horaires = etat.session.debut
    ? `${parisDateTime(etat.session.debut, { dateStyle: 'full' })} — ${parisHeure(etat.session.debut)}`
      + (etat.session.fin ? ` à ${parisHeure(etat.session.fin)}` : '')
    : '—';
  lignesMax = 0;
  lignesMax = Math.max(lignesMax, paire('Date et horaires', horaires, colonnes[0], largeurCol * 2 + 12));
  lignesMax = Math.max(lignesMax, paire('Durée', etat.session.duree != null ? `${etat.session.duree} h` : '—', colonnes[2], largeurCol));
  y += 11 + lignesMax * 11 + 8;

  const lieu = etat.session.lieu || (etat.session.lienVisio ? 'Distanciel (visioconférence)' : '—');
  const formateurs = etat.participants.filter(p => p.role === 'formateur').map(p => p.nom).join(', ') || '—';
  lignesMax = 0;
  lignesMax = Math.max(lignesMax, paire('Lieu / modalité', lieu, colonnes[0], largeurCol * 2 + 12));
  lignesMax = Math.max(lignesMax, paire('Formateur', formateurs, colonnes[2], largeurCol));
  y += 11 + lignesMax * 11 + 16;

  // Tableau
  const COLS = { nom: ML, entreprise: ML + 150, statut: ML + 270, signature: ML + 380, horodatage: ML + 462 };
  const enTeteTableau = () => {
    page.drawRectangle({ x: ML, y: at(y + 14), width: W, height: 18, color: rgb(0.96, 0.95, 0.93) });
    const h = (t, x) => page.drawText(winAnsi(t), { x: x + 4, y: at(y + 2), size: 7, font: bold, color: SOFT });
    h('NOM ET PRÉNOM', COLS.nom); h('ENTREPRISE', COLS.entreprise); h('QUALITÉ / STATUT', COLS.statut);
    h('SIGNATURE', COLS.signature); h('HORODATAGE', COLS.horodatage);
    y += 22;
  };
  enTeteTableau();

  const HAUTEUR = 34;
  for (const p of etat.participants) {
    if (y + HAUTEUR > 770) { nouvellePage(); enTeteTableau(); }
    const base = y;
    page.drawText(winAnsi(p.nom) || '—', { x: COLS.nom + 4, y: at(base + 12), size: 9, font: bold, color: INK });
    page.drawText(winAnsi(p.role === 'formateur' ? 'Formateur' : (p.dossierRef || 'Apprenant')), {
      x: COLS.nom + 4, y: at(base + 22), size: 7, font, color: SOFT,
    });
    page.drawText(winAnsi(p.entreprise || '—').slice(0, 24) || '—', { x: COLS.entreprise + 4, y: at(base + 12), size: 8.5, font, color: INK });
    page.drawText(winAnsi(LIBELLE_STATUT[p.statut] || p.statut), { x: COLS.statut + 4, y: at(base + 12), size: 8, font, color: p.signe ? INK : SOFT });
    if (p.statut === 'present' && p.marquePar) {
      page.drawText(winAnsi(`par ${p.marquePar}`).slice(0, 30), { x: COLS.statut + 4, y: at(base + 22), size: 6.5, font: italic, color: SOFT });
    }

    const img = images.get(p.pid);
    if (img) {
      const maxW = 74, maxH = 26;
      const ech = Math.min(maxW / img.width, maxH / img.height);
      page.drawImage(img, {
        x: COLS.signature + 4, y: at(base + 28),
        width: img.width * ech, height: img.height * ech,
      });
    }
    if (p.signeLe) {
      page.drawText(parisDateTime(p.signeLe, { dateStyle: 'short', timeStyle: 'medium' }), {
        x: COLS.horodatage + 4, y: at(base + 12), size: 7, font, color: INK,
      });
      if (p.preuve?.ip) page.drawText(`IP ${p.preuve.ip}`.slice(0, 26), { x: COLS.horodatage + 4, y: at(base + 21), size: 6, font, color: SOFT });
    } else if (p.marqueLe) {
      page.drawText(parisDateTime(p.marqueLe, { dateStyle: 'short', timeStyle: 'short' }), {
        x: COLS.horodatage + 4, y: at(base + 12), size: 7, font, color: SOFT,
      });
    }
    page.drawLine({ start: { x: ML, y: at(base + HAUTEUR - 4) }, end: { x: ML + W, y: at(base + HAUTEUR - 4) }, thickness: 0.4, color: LINE });
    y += HAUTEUR;
  }

  // Synthèse + valeur probante
  if (y + 96 > 770) nouvellePage();
  y += 10;
  const signes = etat.participants.filter(p => p.signe).length;
  const presents = etat.participants.filter(p => p.signe || p.statut === 'present').length;
  texte(`${presents} participant(s) présent(s) sur ${etat.participants.length} attendu(s) — dont ${signes} signature(s) électronique(s) recueillie(s).`,
    { f: bold, size: 9.5, dy: 18 });

  const genere = parisDateTime(genereLe, { dateStyle: 'long', timeStyle: 'medium' });
  const preuve = `Document généré le ${genere} (heure de Paris)${genereBy ? ` par ${genereBy}` : ''} depuis outils.eneko.ai. `
    + `Chaque signature a été recueillie via un lien personnel non devinable, horodatée par le serveur et `
    + `associée à l'adresse IP du signataire (signature électronique simple au sens du règlement eIDAS, `
    + `appuyée sur un faisceau de preuves conservé par l'organisme).`;
  const mots = preuve.split(/\s+/);
  let ligne = '';
  for (const mot of mots) {
    const essai = ligne ? `${ligne} ${mot}` : mot;
    if (italic.widthOfTextAtSize(essai, 7.2) <= W) ligne = essai;
    else { texte(ligne, { f: italic, size: 7.2, color: SOFT, dy: 10 }); ligne = mot; }
  }
  if (ligne) texte(ligne, { f: italic, size: 7.2, color: SOFT, dy: 10 });

  const bytes = await doc.save();
  const empreinte = crypto.createHash('sha256').update(bytes).digest('hex');
  return { bytes, empreinte, signes, presents };
}

/* ─── Clôture : PDF stocké + Notion mis à jour ───────────────── */

export async function cloturer(sessionId, par) {
  const etat = await sheetState(sessionId);
  if (!etat) return { error: "Aucune feuille d'émargement ouverte." };

  const { bytes, empreinte, signes, presents } = await buildEmargementPdf(etat, { genereBy: par });
  const slug = (etat.session.intitule || 'session')
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'session';
  const blob = await put(`${PDFS}emargement-${slug}.pdf`, Buffer.from(bytes), {
    access: 'private', contentType: 'application/pdf', addRandomSuffix: true,
  });
  const pdfUrl = `https://outils.eneko.ai/api/dossier-pdf?d=emargement&f=${encodeURIComponent(blob.pathname.replace(PDFS, ''))}`;

  const feuille = await readSheet(sessionId);
  feuille.pdf = { path: blob.pathname, url: pdfUrl, empreinte, genereLe: new Date().toISOString(), genrePar: par, signes, presents };
  await writeJson(sheetPath(sessionId), feuille);

  // Trace côté Notion : la session porte le résultat et le lien du document.
  const horodatage = parisDateTime(new Date());
  try {
    await notion(`pages/${sessionId}`, {
      method: 'PATCH',
      body: { properties: { 'Émargement OK': { checkbox: true }, 'Présents': { number: presents } } },
    });
  } catch (err) {
    console.error('émargement Notion propriétés:', err.message);
  }
  try {
    await notion(`blocks/${sessionId}/children`, {
      method: 'PATCH',
      body: {
        children: [{
          object: 'block', type: 'paragraph',
          paragraph: {
            rich_text: [
              { type: 'text', text: { content: `🖊️ Feuille d'émargement clôturée le ${horodatage} — ${presents}/${etat.participants.length} présents, ${signes} signature(s) · ` } },
              { type: 'text', text: { content: 'PDF', link: { url: pdfUrl } } },
              { type: 'text', text: { content: ` · empreinte SHA-256 ${empreinte.slice(0, 16)}…` } },
            ],
          },
        }],
      },
    });
  } catch (err) {
    console.error('émargement Notion trace:', err.message);
  }

  return { ok: true, pdfUrl, empreinte, signes, presents };
}

/* ─── Journal des envois ─────────────────────────────────────── */

export async function noterEnvoi(sessionId, type, destinataires) {
  const feuille = await readSheet(sessionId);
  if (!feuille) return;
  feuille.envois = (feuille.envois || []).concat([{ type, at: new Date().toISOString(), destinataires }]).slice(-40);
  await writeJson(sheetPath(sessionId), feuille);
}
