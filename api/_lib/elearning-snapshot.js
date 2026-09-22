// ════════════════════════════════════════════════════════════════
//  api/_lib/elearning-snapshot.js  —  Progression Circle préchargée
//
//  Le cron /api/cron-elearning (tous les 2 jours) calcule la progression
//  de TOUS les dossiers ayant au moins un stagiaire avec email, et la
//  range dans UN blob privé. Le cockpit l'affiche dès le chargement de la
//  liste (clôturés compris) ; les dossiers actifs affichés sont ensuite
//  rafraîchis en direct par `elearning-batch`.
// ════════════════════════════════════════════════════════════════

import { put, get } from '@vercel/blob';
import { listDossiers } from './notion-crm.js';
import { elearningForStagiaires, summarizeElearning } from './circle.js';

const PATH = 'elearning-cache/snapshot.json';
const LOT = 6;   // même taille de lot que la liste du cockpit (Circle supporte bien)

export async function buildSnapshot() {
  const dossiers = (await listDossiers())
    .filter(d => (d.stagiairesDetail || []).some(s => s.email));
  const results = {};
  let erreurs = 0;
  for (let i = 0; i < dossiers.length; i += LOT) {
    await Promise.all(dossiers.slice(i, i + LOT).map(async (d) => {
      try {
        const stagiaires = d.stagiairesDetail.filter(s => s.email)
          .map(s => ({ nom: s.nom, email: s.email.toLowerCase() }));
        results[d.id] = summarizeElearning(await elearningForStagiaires(stagiaires, d.typeFormation));
      } catch (err) {
        erreurs++;
        console.error('elearning-snapshot dossier:', err.message);
      }
    }));
  }
  const snapshot = { generatedAt: new Date().toISOString(), results };
  await put(PATH, JSON.stringify(snapshot), {
    access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true,
  });
  return { dossiers: dossiers.length, mesures: Object.keys(results).length, erreurs, generatedAt: snapshot.generatedAt };
}

export async function readSnapshot() {
  try {
    const found = await get(PATH, { access: 'private', abortSignal: AbortSignal.timeout(8_000) });
    if (!found?.stream) return null;
    return await new Response(found.stream).json();
  } catch (err) {
    // Absent au tout premier déploiement : le cockpit retombe sur le direct.
    if (!/not.?found|404/i.test(err.message || '')) console.error('elearning-snapshot read:', err.message);
    return null;
  }
}
