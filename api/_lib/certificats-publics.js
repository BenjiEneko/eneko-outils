// ════════════════════════════════════════════════════════════════
//  api/_lib/certificats-publics.js  —  Publication des certificats de
//  formation Eneko (page de vérification + partage LinkedIn)
//
//  Chaque certificat a un identifiant public court (ENK-26-7KQ4MX) et une
//  page https://outils.eneko.ai/certificat/<id> (rewrite → /api/certificat)
//  qui sert de preuve ET de support de partage : aperçu Open Graph 1200×627,
//  « Ajouter à mon profil LinkedIn », publication pré-rédigée, PDF, image.
//
//  Stockage Blob PRIVÉ (servi par /api/certificat) :
//   certificats/<id>.json        fiche publique (ce que la page affiche)
//   certificats/<id>.png|-og.png|.pdf
//   certificats-index/<dossier>__<contact>.json → { id }
//  L'index garde le MÊME identifiant quand on régénère le certificat d'un
//  stagiaire (correction d'une date…) : un lien déjà partagé reste valable.
// ════════════════════════════════════════════════════════════════

import crypto from 'node:crypto';
import { put, get } from '@vercel/blob';

export const BASE_URL = 'https://outils.eneko.ai';
export const ID_RE = /^ENK-\d{2}-[A-Z2-9]{6}$/;
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';   // sans 0/O, 1/I/L, U

const idx = (dossierId, contactId) =>
  `certificats-index/${String(dossierId).replace(/-/g, '')}__${String(contactId || 'sans-contact').replace(/-/g, '')}.json`;

export async function readJson(pathname) {
  try {
    const found = await get(pathname, { access: 'private', abortSignal: AbortSignal.timeout(8_000) });
    if (!found?.stream) return null;
    return await new Response(found.stream).json();
  } catch (err) {
    if (/not found|404|does not exist/i.test(err.message)) return null;
    throw err;
  }
}

const putPrivate = (pathname, body, contentType) => put(pathname, body, {
  access: 'private', contentType, addRandomSuffix: false, allowOverwrite: true,
});

function nouvelId(annee) {
  const bytes = crypto.randomBytes(6);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `ENK-${String(annee).slice(-2)}-${s}`;
}

export const pageUrl = (id) => `${BASE_URL}/certificat/${id}`;
export const assetUrl = (id, f) => `${BASE_URL}/api/certificat?id=${id}&f=${f}`;

// « Ajouter au profil » : rubrique « Licences et certifications » de LinkedIn.
// Avec LINKEDIN_ORG_ID (identifiant numérique de la page entreprise), LinkedIn
// affiche le logo Eneko et relie le certificat à la page ; sinon, nom seul.
export function linkedinAddUrl(c) {
  const p = new URLSearchParams({
    startTask: 'CERTIFICATION_NAME',
    name: c.formationCourte || c.formation,
    issueYear: String(c.anneeEmission),
    issueMonth: String(c.moisEmission),
    certUrl: pageUrl(c.id),
    certId: c.id,
  });
  if (process.env.LINKEDIN_ORG_ID) p.set('organizationId', process.env.LINKEDIN_ORG_ID);
  else p.set('organizationName', 'Eneko');
  return `https://www.linkedin.com/profile/add?${p}`;
}

// Publication pré-rédigée (modifiable sur la page avant de partager).
export function textePublication(c) {
  return [
    `🎓 Nouvelle étape franchie : je viens de terminer la formation « ${c.formationCourte || c.formation} » avec Eneko !`,
    '',
    `${c.duree ? `${c.duree} ` : ''}pour apprendre à utiliser l'IA de façon concrète et responsable dans mon quotidien professionnel. Merci à toute l'équipe pour l'accompagnement 🙏`,
    '',
    `Mon certificat : ${pageUrl(c.id)}`,
    '',
    '#IA #IAgenerative #Formation #Eneko',
  ].join('\n');
}

export const linkedinShareUrl = (texte) =>
  `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(texte)}`;

/**
 * Rend et publie (ou republie) le certificat de formation d'un stagiaire.
 * @param {object} a
 * @param {string} a.dossierId
 * @param {string} a.contactId
 * @param {object} a.data  { nom, prenom, formation, formationCourte, periode, duree,
 *                           dateEmission (JJ/MM/AAAA), mention, signataire, qualite }
 */
export async function publierCertificat({ dossierId, contactId, data }) {
  // Import paresseux : le moteur de rendu (resvg, natif) ne charge que pour
  // générer — la page publique /api/certificat n'en a pas besoin.
  const { renderCertificatFormation, propre } = await import('./certificat-formation.js');
  const [jj, mm, aaaa] = String(data.dateEmission).split('/');
  const index = await readJson(idx(dossierId, contactId));
  const id = index?.id && ID_RE.test(index.id) ? index.id : nouvelId(aaaa);
  const ancien = index?.id ? await readJson(`certificats/${id}.json`) : null;

  const fiche = {
    id,
    nom: propre(data.nom),
    prenom: propre(data.prenom),
    formation: propre(data.formation),
    formationCourte: propre(data.formationCourte),
    periode: propre(data.periode),
    duree: propre(data.duree),
    dateEmission: `${jj}/${mm}/${aaaa}`,
    anneeEmission: Number(aaaa),
    moisEmission: Number(mm),
    mention: propre(data.mention),
    signataire: propre(data.signataire),
    qualite: propre(data.qualite),
    dossierId, contactId,
    creeLe: ancien?.creeLe || new Date().toISOString(),
    majLe: new Date().toISOString(),
  };

  const rendu = await renderCertificatFormation({
    ...fiche,
    annee: String(aaaa),
    verifyUrl: pageUrl(id),
    verifyLabel: 'outils.eneko.ai/certificat',
  });

  await Promise.all([
    putPrivate(`certificats/${id}.png`, rendu.png, 'image/png'),
    putPrivate(`certificats/${id}-og.png`, rendu.og, 'image/png'),
    putPrivate(`certificats/${id}.pdf`, Buffer.from(rendu.pdf), 'application/pdf'),
  ]);
  // La fiche en dernier : la page n'existe que si les fichiers sont là.
  await putPrivate(`certificats/${id}.json`, JSON.stringify(fiche), 'application/json');
  if (!index?.id) await putPrivate(idx(dossierId, contactId), JSON.stringify({ id }), 'application/json');

  return {
    id,
    pageUrl: pageUrl(id),
    pdfUrl: assetUrl(id, 'pdf'),
    pngUrl: assetUrl(id, 'png'),
    linkedinAddUrl: linkedinAddUrl(fiche),
    regenere: !!ancien,
  };
}
