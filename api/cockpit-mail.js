// ════════════════════════════════════════════════════════════════
//  /api/cockpit-mail  —  Envoi d'emails depuis une fiche du cockpit
//  (API Gmail, session interne obligatoire — voir _lib/gmail.js)
//
//  • context : expéditeur de la session (+ copie imposée), destinataires
//    connus du dossier (stagiaires, entreprise), pièces jointes possibles
//    (les PDF tracés sur la fiche Notion) et historique des envois.
//  • send    : envoie depuis la boîte Workspace de la session, joint les
//    PDF choisis et trace l'envoi sur la fiche Notion du dossier.
//
//  Garde-fous : l'expéditeur est déduit de la session (jamais du client) ;
//  les pièces jointes « dossier » ne peuvent être QUE des PDF déjà tracés
//  sur CE dossier ; tout destinataire inconnu du dossier exige une
//  confirmation explicite ; 10 destinataires max ; fichiers ajoutés
//  depuis l'ordinateur bornés (3 Mo, types courants).
// ════════════════════════════════════════════════════════════════

import { get } from '@vercel/blob';
import { guardPost, capString } from './_lib/guard.js';
import { isAuthorized } from './_lib/token.js';
import { notion, plain, titleOf, dossierFromPage, emails as emailsDe } from './_lib/notion-crm.js';
import { expediteurPour, gmailConfigured, construireMime, envoyerGmail, EMAIL_RE } from './_lib/gmail.js';
import { signaturePour } from './_lib/signatures-email.js';

const MAX_DEST = 10;
const MAX_FICHIERS_OCTETS = 3 * 1024 * 1024;
const TYPES_FICHIERS = /^(application\/pdf|image\/(png|jpeg|gif|webp)|text\/plain|text\/csv|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)|application\/msword|application\/vnd\.ms-excel)$/;
// Même liste blanche que /api/dossier-pdf.
const DIRS = { docs: 'documents-dossiers', emargement: 'emargements-pdf', quizfin: 'quiz-fin-pdf', '': 'dossiers-inscription' };
const PDF_RE = /^https:\/\/outils\.eneko\.ai\/api\/dossier-pdf\?(.+)$/;

const horodatageParis = () => new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short',
}).format(new Date());

const emailContact = (pg) => {
  const p = pg.properties?.['Email'];
  return p?.email || plain(p?.rich_text) || '';
};

/* ─── Lecture du dossier : destinataires, PDF tracés, historique ── */

async function blocsDossier(dossierId) {
  const out = [];
  let cursor;
  for (let i = 0; i < 4; i++) {
    const data = await notion(`blocks/${dossierId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    out.push(...(data.results || []));
    if (!data.has_more) break;
    cursor = data.next_cursor;
  }
  return out;
}

// Un PDF servi par /api/dossier-pdf → { d, f } validés, ou null.
function pdfRef(url) {
  const m = PDF_RE.exec(String(url || ''));
  if (!m) return null;
  const q = new URLSearchParams(m[1]);
  const d = q.get('d') || '';
  const f = q.get('f') || '';
  if (!(d in DIRS) || !/^[a-z0-9][a-zA-Z0-9._-]{5,120}\.pdf$/.test(f)) return null;
  return { d, f, url: `https://outils.eneko.ai/api/dossier-pdf?${d ? `d=${d}&` : ''}f=${encodeURIComponent(f)}` };
}

async function contexte(dossierId) {
  const pg = await notion(`pages/${dossierId}`);
  const dossier = dossierFromPage(pg);

  const destinataires = [];
  await Promise.all(dossier.stagiaireIds.slice(0, 25).map(async (id) => {
    try {
      const c = await notion(`pages/${id}`);
      for (const email of emailsDe(emailContact(c))) destinataires.push({ nom: titleOf(c), email, role: 'Stagiaire' });
    } catch (err) { console.error('cockpit-mail contact:', err.message); }
  }));
  if (dossier.entrepriseIds[0]) {
    try {
      const e = await notion(`pages/${dossier.entrepriseIds[0]}`);
      for (const [nom, prop] of Object.entries(e.properties || {})) {
        if (!/mail/i.test(nom)) continue;
        for (const email of emailsDe(prop.email || plain(prop.rich_text))) destinataires.push({ nom: titleOf(e), email, role: 'Entreprise' });
      }
    } catch (err) { console.error('cockpit-mail entreprise:', err.message); }
  }

  const pieces = [];
  const historique = [];
  for (const b of await blocsDossier(dossierId)) {
    const rt = b[b.type]?.rich_text || [];
    const texte = plain(rt);
    if (texte.startsWith('✉️')) historique.push(texte);
    for (const run of rt) {
      const ref = pdfRef(run.href || run.text?.link?.url);
      if (!ref || pieces.some(p => p.f === ref.f)) continue;
      // Libellé : début de la ligne de trace (« 📄 Convention OPCO — généré le … »).
      const label = texte.split(' · ')[0].replace(/ via le cockpit.*$/, '').slice(0, 160) || ref.f;
      pieces.push({ ...ref, label });
    }
  }
  return { dossier, destinataires, pieces: pieces.reverse(), historique: historique.reverse().slice(0, 30) };
}

/* ─── Handler ────────────────────────────────────────────────── */

export default async function handler(req, res) {
  if (!(await guardPost(req, res, { maxBodyChars: 4_400_000, limit: 20, windowMs: 60_000 }))) return;

  const { action, auth } = req.body || {};
  if (!auth || !isAuthorized(auth.email, auth.token)) {
    return res.status(401).json({ error: 'Session interne requise.' });
  }
  if (!process.env.NOTION_TOKEN) {
    console.error('cockpit-mail : NOTION_TOKEN non configuré.');
    return res.status(500).json({ error: 'Service momentanément indisponible.' });
  }
  const dossierId = capString(req.body.dossierId, 60);
  if (!/^[0-9a-f-]{32,36}$/i.test(dossierId)) return res.status(400).json({ error: 'Dossier invalide.' });

  const exp = expediteurPour(auth.email);

  try {
    if (action === 'context') {
      const ctx = await contexte(dossierId);
      return res.status(200).json({
        ready: gmailConfigured() && !!exp,
        expediteur: exp ? { from: exp.from, nom: exp.nom, cc: exp.cc } : null,
        // Aperçu HTML (logo servi par /assets au lieu du cid: de l'email).
        signature: signaturePour(auth.email, { logoSrc: '/assets/logo-eneko.svg' })?.html || null,
        destinataires: ctx.destinataires,
        pieces: ctx.pieces.map(({ url, label }) => ({ url, label })),
        historique: ctx.historique,
      });
    }

    if (action !== 'send') return res.status(400).json({ error: 'Action inconnue.' });

    if (!gmailConfigured()) return res.status(500).json({ error: 'Envoi non configuré (clé du compte de service Google).' });
    if (!exp) return res.status(403).json({ error: 'Aucune boîte d\'envoi associée à votre session.' });

    // Destinataires : adresses valides, dédoublonnées, bornées.
    const liste = (v) => [...new Set((Array.isArray(v) ? v : []).map(x => capString(x, 200).toLowerCase()).filter(Boolean))];
    const to = liste(req.body.to);
    const ccSaisis = liste(req.body.cc);
    const invalides = [...to, ...ccSaisis].filter(e => !EMAIL_RE.test(e));
    if (invalides.length) return res.status(400).json({ error: `Adresse invalide : ${invalides.join(', ')}` });
    if (!to.length) return res.status(400).json({ error: 'Au moins un destinataire est requis.' });
    const cc = [...new Set([...ccSaisis, ...exp.cc])].filter(e => !to.includes(e) && e !== exp.from);
    if (to.length + cc.length > MAX_DEST) return res.status(400).json({ error: `${MAX_DEST} destinataires au maximum par envoi.` });

    const subject = capString(req.body.subject, 250).replace(/[\r\n]+/g, ' ').trim();
    const text = capString(req.body.text, 20_000).trim();
    if (!subject || !text) return res.status(400).json({ error: 'Objet et message sont requis.' });

    const ctx = await contexte(dossierId);

    // Tout destinataire hors dossier (et hors équipe) doit être confirmé.
    const connus = new Set(ctx.destinataires.map(d => d.email));
    const externes = [...to, ...ccSaisis].filter(e => !connus.has(e) && !/@eneko\.ai$/.test(e));
    if (externes.length && req.body.confirmExterne !== true) {
      return res.status(409).json({ error: 'Destinataire(s) hors dossier à confirmer.', externes });
    }

    // Pièces jointes du dossier : uniquement des PDF tracés sur CETTE fiche.
    const demandes = [...new Set((Array.isArray(req.body.pieces) ? req.body.pieces : []).map(u => capString(u, 400)))].slice(0, 10);
    const attachments = [];
    for (const url of demandes) {
      const ref = pdfRef(url);
      const piece = ref && ctx.pieces.find(p => p.f === ref.f && p.d === ref.d);
      if (!piece) return res.status(400).json({ error: 'Pièce jointe non rattachée à ce dossier.' });
      const found = await get(`${DIRS[piece.d]}/${piece.f}`, { access: 'private', abortSignal: AbortSignal.timeout(15_000) });
      if (!found?.stream) return res.status(404).json({ error: `Pièce jointe introuvable : ${piece.label}` });
      const content = Buffer.from(await new Response(found.stream).arrayBuffer());
      // « certificat-de-realisation-xxx-AbC123.pdf » → nom lisible sans le suffixe aléatoire du Blob.
      const filename = piece.f.replace(/-[A-Za-z0-9]{20,}(?=\.pdf$)/, '');
      attachments.push({ filename, contentType: 'application/pdf', content });
    }

    // Fichiers ajoutés depuis l'ordinateur (base64), bornés en taille et type.
    let total = attachments.reduce((t, a) => t + a.content.length, 0);
    let volumeFichiers = 0;
    for (const f of (Array.isArray(req.body.fichiers) ? req.body.fichiers : []).slice(0, 5)) {
      const type = capString(f?.type, 120);
      const name = capString(f?.name, 150).replace(/[\\/]/g, '_');
      if (!name || !TYPES_FICHIERS.test(type)) return res.status(400).json({ error: `Type de fichier non accepté : ${name || '?'}` });
      const content = Buffer.from(String(f?.data || ''), 'base64');
      volumeFichiers += content.length;
      if (!content.length || volumeFichiers > MAX_FICHIERS_OCTETS) return res.status(400).json({ error: 'Fichiers ajoutés : 3 Mo au total maximum.' });
      attachments.push({ filename: name, contentType: type, content });
      total += content.length;
    }
    if (total > 20 * 1024 * 1024) return res.status(400).json({ error: 'Pièces jointes trop lourdes (20 Mo max).' });

    const signature = req.body.signature === false ? null : signaturePour(auth.email);
    const mime = construireMime({ from: exp.from, fromNom: exp.nom, to, cc, subject, text, signature, attachments });
    await envoyerGmail(exp.mailbox, mime);

    // Trace sur la fiche (fail-soft : l'email est parti).
    const horodatage = horodatageParis();
    const trace = `✉️ Email envoyé le ${horodatage} depuis ${exp.from} (par ${auth.email}) — « ${subject} » — à : ${to.join(', ')}`
      + (cc.length ? ` · copie : ${cc.join(', ')}` : '')
      + (attachments.length ? ` · PJ : ${attachments.map(a => a.filename).join(', ')}` : '');
    try {
      await notion(`blocks/${dossierId}/children`, {
        method: 'PATCH',
        body: { children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: trace.slice(0, 1900) } }] } }] },
      });
    } catch (err) {
      console.error('cockpit-mail Notion append:', err.message);
    }
    return res.status(200).json({ ok: true, from: exp.from, to, cc, trace });
  } catch (err) {
    console.error('cockpit-mail error:', err.message);
    const msg = /Gmail token/.test(err.message)
      ? `Envoi refusé par Google pour ${exp?.mailbox || 'cette boîte'} : la délégation « gmail.send » n'est pas (encore) active pour le compte de service. Elle peut mettre jusqu'à une heure à s'appliquer.`
      : /Gmail send/.test(err.message)
      ? 'Gmail a refusé le message. Vérifiez les adresses et la taille des pièces jointes, puis réessayez.'
      : 'Lecture du dossier impossible. Réessayez dans un instant.';
    return res.status(500).json({ error: msg });
  }
}
