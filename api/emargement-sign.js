// ════════════════════════════════════════════════════════════════
//  /api/emargement-sign  —  Signature d'un participant (page publique)
//
//  Appelé avec le seul jeton du lien personnel :
//   • sans `signature` → renvoie l'état (session, nom du signataire,
//     déjà signé ou non) pour afficher la page ;
//   • avec `signature` (PNG en data-URL) → enregistre la signature,
//     horodatée côté serveur, avec l'IP et le user-agent comme faisceau
//     de preuves.
//
//  Aucune authentification : la preuve d'identité est le lien personnel,
//  non devinable et transmis nominativement (même principe qu'Edusign).
// ════════════════════════════════════════════════════════════════

import { guardPost, capString } from './_lib/guard.js';
import { resolveToken, signer, sessionDate, sessionHeure } from './_lib/emargement.js';

function vueParticipant(feuille, participant) {
  return {
    ok: true,
    deja: participant.signe,
    signeLe: participant.signeLe || '',
    participant: { nom: participant.nom, role: participant.role },
    session: {
      intitule: feuille.session.intitule,
      module: feuille.session.module,
      type: feuille.session.type,
      lieu: feuille.session.lieu,
      dateLongue: feuille.session.debut ? sessionDate(feuille.session.debut, true) : '',
      heures: feuille.session.debut
        ? `${sessionHeure(feuille.session.debut)}${feuille.session.fin ? ` – ${sessionHeure(feuille.session.fin)}` : ''}`
        : '',
      duree: feuille.session.duree,
    },
    organisme: 'Eneko Formation',
  };
}

export default async function handler(req, res) {
  // Un participant ne signe qu'une fois : limite serrée, mais qui laisse
  // la place au chargement de la page puis à l'envoi.
  if (!(await guardPost(req, res, { maxBodyChars: 500_000, limit: 12, windowMs: 60_000 }))) return;

  const token = capString(req.body?.token, 24);
  if (!/^[a-z0-9]{8,24}$/.test(token)) {
    return res.status(403).json({ error: 'Lien invalide. Contactez Eneko Formation pour en recevoir un nouveau.' });
  }

  const ip = ((req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim();
  const ua = req.headers['user-agent'] || '';

  try {
    // Chargement de la page : pas de signature dans le corps.
    if (!req.body?.signature) {
      const cible = await resolveToken(token);
      if (!cible) {
        return res.status(403).json({ error: 'Lien invalide ou expiré. Contactez Eneko Formation pour en recevoir un nouveau.' });
      }
      return res.status(200).json(vueParticipant(cible.feuille, cible.participant));
    }

    const out = await signer(token, { dataUrl: req.body.signature, ip, ua });
    if (out.error) {
      const invalide = /Lien invalide/.test(out.error);
      return res.status(invalide ? 403 : 400).json({ error: out.error });
    }
    const vue = vueParticipant(out.feuille, { ...out.participant, signe: true, signeLe: new Date().toISOString() });
    return res.status(200).json({ ...vue, enregistre: !out.deja, deja: !!out.deja });
  } catch (err) {
    console.error('emargement-sign error:', err.message);
    return res.status(500).json({ error: "L'enregistrement a échoué. Réessayez dans un instant." });
  }
}
