// ════════════════════════════════════════════════════════════════
//  /api/calculateur-devis  —  Catalogue + chiffrage du calculateur
//
//  Toute la grille tarifaire vit côté serveur (api/_lib/pricing.js).
//  Avant, elle était embarquée dans le bundle de la page : n'importe
//  quel prospect pouvait lire le TJM, les prix unitaires, la charge
//  en jours et la formule de marge via « Afficher la source ».
//
//  Deux réponses possibles pour la MÊME requête :
//   • session interne (email + token valides) → catalogue complet,
//     marge, charge, overrides, total année 1 ;
//   • tout le reste (prospect) → libellés sans prix + une fourchette
//     + l'argumentaire ROI. Rien d'autre ne quitte le serveur.
// ════════════════════════════════════════════════════════════════

import { guardPost } from './_lib/guard.js';
import { isAuthorized } from './_lib/token.js';
import { calculer, vueInterne, vueProspect } from './_lib/pricing.js';

export default async function handler(req, res) {
  // Appelé à chaque ajustement de config : limite large mais réelle.
  if (!(await guardPost(req, res, { maxBodyChars: 8_000, limit: 120, windowMs: 60_000 }))) return;

  const { config, auth, tjm, overrides } = req.body || {};

  const interne = !!(auth && isAuthorized(auth.email, auth.token));

  try {
    const resultat = calculer(config, {
      // Le TJM et les overrides ne sont acceptés que d'une session interne.
      tjm: interne ? tjm : undefined,
      overrides: interne ? (overrides || {}) : {},
    });

    return res.status(200).json(interne ? vueInterne(resultat) : vueProspect(resultat));
  } catch (err) {
    console.error('calculateur-devis error:', err);
    return res.status(500).json({ error: 'Chiffrage momentanément indisponible.' });
  }
}
