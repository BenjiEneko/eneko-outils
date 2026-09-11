// ════════════════════════════════════════════════════════════════
//  /api/emargement-admin  —  Backoffice des feuilles d'émargement
//  (page interne /emargement-interne, session interne obligatoire)
//
//  sessions  : planning Notion sur une fenêtre glissante + état de
//              l'émargement (feuille ouverte, nombre de signatures) ;
//  detail    : une session, ses participants déduits (dossiers →
//              stagiaires + formateur) et l'état de leurs signatures ;
//  ouvrir    : crée ou synchronise la feuille et les liens personnels ;
//  envoyer   : envoie (ou relance) les liens par email via Resend ;
//  marquer   : présence corrigée à la main (présent/absent/excusé) ;
//  cloturer  : génère le PDF horodaté et met à jour la fiche Notion.
// ════════════════════════════════════════════════════════════════

import { guardPost, capString } from './_lib/guard.js';
import { isAuthorized } from './_lib/token.js';
import { DB, queryAll, listDossiers } from './_lib/notion-crm.js';
import { list } from '@vercel/blob';
import {
  sessionFromPage, getSession, buildParticipants, openSheet, sheetState,
  marquer, cloturer, noterEnvoi, parisDateTime, parisHeure, STATUTS_MANUELS,
} from './_lib/emargement.js';

const JOUR = 86_400_000;
const RESEND_FROM = process.env.RESEND_FROM_FORMATION || 'Eneko Formation <outils@eneko-formation.fr>';

/* ─── Liste des sessions ─────────────────────────────────────── */

async function actionSessions() {
  const depuis = new Date(Date.now() - 60 * JOUR).toISOString().slice(0, 10);
  const jusqua = new Date(Date.now() + 120 * JOUR).toISOString().slice(0, 10);
  const pages = await queryAll(DB.sessions, {
    filter: {
      and: [
        { property: 'Date début', date: { on_or_after: depuis } },
        { property: 'Date début', date: { before: jusqua } },
      ],
    },
    sorts: [{ property: 'Date début', direction: 'descending' }],
  }, 3);

  // Un seul listing Blob pour connaître l'état de toutes les feuilles.
  const ouvertes = new Set();
  const signatures = new Map();
  try {
    const feuilles = await list({ prefix: 'emargements/', limit: 1000 });
    for (const b of feuilles.blobs || []) {
      const m = b.pathname.match(/^emargements\/([0-9a-f]+)\.json$/);
      if (m) ouvertes.add(m[1]);
    }
    let cursor;
    for (let i = 0; i < 5; i++) {
      const page = await list({ prefix: 'emargement-signatures/', limit: 1000, ...(cursor ? { cursor } : {}) });
      for (const b of page.blobs || []) {
        const m = b.pathname.match(/^emargement-signatures\/([0-9a-f]+)\/[a-z0-9]+\.json$/);
        if (m) signatures.set(m[1], (signatures.get(m[1]) || 0) + 1);
      }
      if (!page.hasMore) break;
      cursor = page.cursor;
    }
  } catch (err) {
    console.error('émargement listing blob:', err.message);
  }

  const sessions = pages.map(sessionFromPage).map(s => {
    const cle = s.id.replace(/-/g, '');
    return {
      id: s.id, url: s.url, intitule: s.intitule, module: s.module, type: s.type,
      statut: s.statut, debut: s.debut, fin: s.fin, duree: s.duree,
      lieu: s.lieu, lienVisio: s.lienVisio,
      nbDossiers: s.dossierIds.length, nbFormateurs: s.formateurIds.length,
      emargementOk: s.emargementOk, presents: s.presents,
      feuilleOuverte: ouvertes.has(cle),
      nbSignatures: signatures.get(cle) || 0,
    };
  });
  return { sessions };
}

/* ─── Détail d'une session ───────────────────────────────────── */

async function actionDetail(sessionId) {
  const session = await getSession(sessionId);
  const etat = await sheetState(sessionId);
  if (etat) return { session, feuille: etat, prevus: null };
  // Feuille non ouverte : on montre qui serait convoqué.
  const prevus = await buildParticipants(session);
  return { session, feuille: null, prevus };
}

/* ─── Emails ─────────────────────────────────────────────────── */

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function emailHtml({ participant, session, relance }) {
  const quand = session.debut
    ? `${parisDateTime(session.debut, { dateStyle: 'full' })} de ${parisHeure(session.debut)}${session.fin ? ` à ${parisHeure(session.fin)}` : ''}`
    : '';
  const lieu = session.lieu || (session.lienVisio ? 'En visioconférence' : '');
  return `<!DOCTYPE html><html lang="fr"><body style="margin:0;background:#F0EEE9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 16px 44px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
      <tr><td style="background:#0B0C2E;border-radius:16px 16px 0 0;padding:26px 34px;">
        <p style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.45);margin:0 0 8px;">Eneko Formation · Émargement</p>
        <h1 style="font-size:21px;color:#fff;margin:0;font-family:Georgia,serif;">${relance ? 'Rappel : votre signature manque' : 'Merci de signer votre présence'}</h1>
      </td></tr>
      <tr><td style="background:#fff;padding:28px 34px;">
        <p style="font-size:15px;color:#333;line-height:1.6;margin:0 0 16px;">Bonjour ${esc((participant.nom || '').split(/\\s+/)[0])},</p>
        <p style="font-size:15px;color:#333;line-height:1.6;margin:0 0 18px;">
          ${relance
            ? "Votre signature d'émargement n'a pas encore été enregistrée pour la session suivante. Elle nous est indispensable pour justifier votre présence auprès du financeur."
            : "Voici votre lien personnel pour signer votre présence à la session suivante. La signature ne prend que quelques secondes, depuis votre téléphone ou votre ordinateur."}
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAF8;border:1px solid #E8E6E1;border-radius:12px;margin-bottom:22px;">
          <tr><td style="padding:16px 18px;">
            <p style="margin:0 0 6px;font-size:15px;font-weight:bold;color:#1A1A1A;">${esc(session.intitule)}</p>
            ${quand ? `<p style="margin:0 0 4px;font-size:14px;color:#555;">${esc(quand)}</p>` : ''}
            ${lieu ? `<p style="margin:0;font-size:14px;color:#555;">${esc(lieu)}</p>` : ''}
          </td></tr>
        </table>
        <p style="text-align:center;margin:0 0 20px;">
          <a href="${participant.lien}" style="display:inline-block;background:#8037EE;color:#fff;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 32px;border-radius:12px;">Signer ma présence</a>
        </p>
        <p style="font-size:12.5px;color:#767676;line-height:1.6;margin:0;">Ce lien vous est personnel : merci de ne pas le transférer. Si le bouton ne fonctionne pas, copiez cette adresse dans votre navigateur :<br><span style="color:#8037EE;word-break:break-all;">${participant.lien}</span></p>
      </td></tr>
      <tr><td style="background:#FAFAF8;border-radius:0 0 16px 16px;border-top:1px solid #ECEAE5;padding:16px 34px;text-align:center;">
        <p style="font-size:11.5px;color:#BBB;margin:0;">Eneko Formation · bonjour@eneko-formation.fr</p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

async function envoyerEmails({ participants, session, relance }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw Object.assign(new Error('RESEND_API_KEY manquant'), { status: 500 });
  const resultats = [];
  for (const p of participants) {
    if (!p.email) { resultats.push({ pid: p.pid, nom: p.nom, ok: false, motif: 'email manquant' }); continue; }
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: RESEND_FROM,
          reply_to: ['bonjour@eneko-formation.fr'],
          to: [p.email],
          subject: relance
            ? `Rappel — signature d'émargement : ${session.intitule}`
            : `Votre émargement — ${session.intitule}`,
          html: emailHtml({ participant: p, session, relance }),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
      resultats.push({ pid: p.pid, nom: p.nom, ok: true });
    } catch (err) {
      console.error('émargement email:', err.message);
      resultats.push({ pid: p.pid, nom: p.nom, ok: false, motif: 'envoi refusé' });
    }
  }
  return resultats;
}

/* ─── Handler ────────────────────────────────────────────────── */

export default async function handler(req, res) {
  if (!(await guardPost(req, res, { maxBodyChars: 8_000, limit: 90, windowMs: 60_000 }))) return;

  const { action, auth } = req.body || {};
  if (!auth || !isAuthorized(auth.email, auth.token)) {
    return res.status(401).json({ error: 'Session interne requise.' });
  }
  if (!process.env.NOTION_TOKEN) {
    console.error('emargement-admin : NOTION_TOKEN non configuré.');
    return res.status(500).json({ error: 'Service momentanément indisponible.' });
  }

  const sessionId = capString(req.body.sessionId, 60);
  const idOk = /^[0-9a-f-]{32,36}$/i.test(sessionId);

  try {
    if (action === 'sessions') return res.status(200).json(await actionSessions());

    if (action === 'detail') {
      if (!idOk) return res.status(400).json({ error: 'Session invalide.' });
      return res.status(200).json(await actionDetail(sessionId));
    }

    if (action === 'ouvrir') {
      if (!idOk) return res.status(400).json({ error: 'Session invalide.' });
      const session = await getSession(sessionId);
      const participants = await buildParticipants(session);
      if (!participants.length) {
        return res.status(400).json({
          error: "Aucun participant : rattachez des dossiers apprenants (et un formateur) à la session dans Notion.",
        });
      }
      await openSheet(session, participants, auth.email);
      return res.status(200).json(await actionDetail(sessionId));
    }

    if (action === 'envoyer') {
      if (!idOk) return res.status(400).json({ error: 'Session invalide.' });
      const etat = await sheetState(sessionId);
      if (!etat) return res.status(400).json({ error: "Ouvrez d'abord la feuille d'émargement." });
      const relance = req.body.relance === true;
      const pids = Array.isArray(req.body.pids) ? req.body.pids.map(p => capString(p, 24)) : null;
      const cibles = etat.participants.filter(p =>
        !p.signe && (pids ? pids.includes(p.pid) : true));
      if (!cibles.length) return res.status(400).json({ error: 'Personne à qui envoyer : tout le monde a signé.' });
      const resultats = await envoyerEmails({ participants: cibles, session: etat.session, relance });
      await noterEnvoi(sessionId, relance ? 'relance' : 'initial', resultats.filter(r => r.ok).map(r => r.nom));
      return res.status(200).json({ ok: true, resultats });
    }

    if (action === 'marquer') {
      if (!idOk) return res.status(400).json({ error: 'Session invalide.' });
      const pid = capString(req.body.pid, 24);
      const statut = capString(req.body.statut, 12);
      if (statut && !STATUTS_MANUELS.includes(statut)) return res.status(400).json({ error: 'Statut inconnu.' });
      const out = await marquer(sessionId, pid, statut, auth.email);
      if (out.error) return res.status(400).json(out);
      return res.status(200).json(await actionDetail(sessionId));
    }

    if (action === 'cloturer') {
      if (!idOk) return res.status(400).json({ error: 'Session invalide.' });
      const out = await cloturer(sessionId, auth.email);
      if (out.error) return res.status(400).json(out);
      return res.status(200).json(out);
    }

    return res.status(400).json({ error: 'Action inconnue.' });
  } catch (err) {
    console.error('emargement-admin error:', err.message);
    const status = err.status || 500;
    return res.status(status).json({
      error: status === 400 ? err.message : "Opération impossible pour le moment. Réessayez dans un instant.",
    });
  }
}
