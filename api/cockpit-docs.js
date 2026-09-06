// ════════════════════════════════════════════════════════════════
//  /api/cockpit-docs  —  Génération de documents du cockpit
//  (fusion de modèles Google Docs → PDF, session interne obligatoire)
//
//  • registry : pour un dossier, la liste des documents générables
//    avec leurs champs pré-remplis depuis le CRM (spec unique :
//    _lib/documents-dossiers.js) + l'état de la config Google.
//  • generate : duplique le modèle Drive, remplace les champs,
//    exporte le PDF (Blob privé, servi par /api/dossier-pdf), et
//    trace le document généré sur la fiche Notion du dossier.
//
//  Déborah garde la maîtrise des mises en page : les modèles vivent
//  dans Drive, partagés avec le compte de service (voir _lib/google.js).
// ════════════════════════════════════════════════════════════════

import { put } from '@vercel/blob';
import { guardPost, capString } from './_lib/guard.js';
import { isAuthorized } from './_lib/token.js';
import { notion, plain, titleOf, fuzzyText, dossierFromPage } from './_lib/notion-crm.js';
import { DOCUMENTS, buildRegistry } from './_lib/documents-dossiers.js';
import { googleConfigured, copyTemplate, replaceTexts, exportPdf } from './_lib/google.js';
import { createCandidateLink } from './_lib/dossier-rs6776.js';

/* ─── Contexte de fusion (dossier + entreprise + stagiaires) ──── */

async function buildContext(dossierId, stagiaireId) {
  const pg = await notion(`pages/${dossierId}`);
  const dossier = dossierFromPage(pg);

  const stagiaires = await Promise.all(
    dossier.stagiaireIds.slice(0, 25).map(async (id) => {
      try {
        const c = await notion(`pages/${id}`);
        const nom = titleOf(c);
        const parts = nom.split(/\s+/);
        return {
          id,
          nom,
          // « Nom complet » CRM → ébauche prénom / nom d'usage (éditable dans l'UI).
          prenom: parts[0] || '',
          nomUsage: parts.slice(1).join(' '),
          email: c.properties?.['Email']?.email || '',
          telephone: c.properties?.['Téléphone']?.phone_number || '',
          poste: plain(c.properties?.['Poste']?.rich_text),
        };
      } catch { return { id, nom: '?', prenom: '', nomUsage: '', email: '', telephone: '', poste: '' }; }
    })
  );

  let entreprise = { nom: '', siret: '', adresse: '' };
  if (dossier.entrepriseIds[0]) {
    try {
      const e = await notion(`pages/${dossier.entrepriseIds[0]}`);
      entreprise = {
        nom: titleOf(e),
        siret: fuzzyText(e, /siret/i),
        adresse: fuzzyText(e, /adresse/i),
      };
    } catch (err) {
      console.error('cockpit-docs entreprise:', err.message);
    }
  }

  const stagiaire = stagiaires.find(s => s.id === stagiaireId) || stagiaires[0] || null;
  return { dossier, stagiaires, entreprise, stagiaire };
}

/* ─── Trace sur la fiche Notion du dossier ────────────────────── */

async function appendToDossier(dossierId, label, docUrl, pdfUrl, horodatage) {
  const run = (content, link) => ({
    type: 'text',
    text: { content, ...(link ? { link: { url: link } } : {}) },
  });
  await notion(`blocks/${dossierId}/children`, {
    method: 'PATCH',
    body: {
      children: [{
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            run(`📄 ${label} — généré le ${horodatage} via le cockpit · `),
            run('Google Doc', docUrl),
            run(' · '),
            run('PDF', pdfUrl),
          ],
        },
      }],
    },
  });
}

/* ─── Handler ────────────────────────────────────────────────── */

export default async function handler(req, res) {
  if (!(await guardPost(req, res, { maxBodyChars: 20_000, limit: 30, windowMs: 60_000 }))) return;

  const { action, auth } = req.body || {};
  if (!auth || !isAuthorized(auth.email, auth.token)) {
    return res.status(401).json({ error: 'Session interne requise.' });
  }
  if (!process.env.NOTION_TOKEN) {
    console.error('cockpit-docs : NOTION_TOKEN non configuré.');
    return res.status(500).json({ error: 'Service momentanément indisponible.' });
  }

  const dossierId = capString(req.body.dossierId, 60);
  if (!/^[0-9a-f-]{32,36}$/i.test(dossierId)) {
    return res.status(400).json({ error: 'Dossier invalide.' });
  }
  const stagiaireId = capString(req.body.stagiaireId, 60);

  try {
    if (action === 'registry') {
      const ctx = await buildContext(dossierId, stagiaireId);
      return res.status(200).json({
        googleReady: googleConfigured(),
        stagiaires: ctx.stagiaires,
        documents: buildRegistry(ctx),
      });
    }

    if (action === 'generate') {
      const docType = capString(req.body.docType, 40);
      const doc = DOCUMENTS[docType];
      if (!doc) return res.status(400).json({ error: 'Type de document inconnu.' });

      // Lien candidat (dossier d'inscription RS6776) : pas de fusion Google,
      // on crée le lien pré-rempli et on le trace sur la fiche du dossier.
      if (doc.kind === 'lien') {
        const ctx = await buildContext(dossierId, stagiaireId);
        if (!doc.enabledFor(ctx)) return res.status(400).json({ error: doc.disabledHint });
        const values = req.body.values && typeof req.body.values === 'object' ? req.body.values : {};
        const prefill = {};
        for (const f of doc.fields) {
          const v = capString(values[f.ph], 200);
          prefill[f.ph] = v !== '' ? v : (() => { try { return f.prefill(ctx) || ''; } catch { return ''; } })();
        }
        const { url, exp } = await createCandidateLink(prefill, ctx.stagiaire?.id || '');
        const expFr = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long' }).format(new Date(exp));
        const horodatage = new Intl.DateTimeFormat('fr-FR', {
          timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short',
        }).format(new Date());
        try {
          await notion(`blocks/${dossierId}/children`, {
            method: 'PATCH',
            body: {
              children: [{
                object: 'block', type: 'paragraph',
                paragraph: { rich_text: [{ type: 'text', text: {
                  content: `🔗 Dossier d'inscription RS6776 — lien candidat généré pour ${prefill.prenom} ${prefill.nomUsage} le ${horodatage} via le cockpit (valable jusqu'au ${expFr}).`,
                } }] },
              }],
            },
          });
        } catch (err) {
          console.error('cockpit-docs Notion append (lien):', err.message);
        }
        return res.status(200).json({ ok: true, kind: 'lien', url, exp, prenom: prefill.prenom });
      }

      const templateId = doc.templateId();
      if (!templateId) {
        return res.status(400).json({ error: 'Modèle non configuré pour ce document (voir la spec dans le cockpit).' });
      }
      if (!googleConfigured()) {
        return res.status(500).json({
          error: 'Génération non configurée : compte de service Google à renseigner (GOOGLE_SERVICE_ACCOUNT_KEY).',
        });
      }

      const ctx = await buildContext(dossierId, stagiaireId);

      // Fusion : valeurs de l'UI pour les champs éditables (cappées),
      // valeurs calculées pour les champs automatiques.
      const values = req.body.values && typeof req.body.values === 'object' ? req.body.values : {};
      const replacements = {};
      for (const f of doc.fields) {
        if (f.auto) {
          replacements[f.ph] = f.auto(ctx);
        } else {
          const v = capString(values[f.ph], 600);
          replacements[f.ph] = v !== '' ? v : (() => { try { return f.prefill(ctx) || ''; } catch { return ''; } })();
        }
      }

      const dateTag = new Date().toISOString().slice(0, 10);
      const fileName = `${doc.fileName(ctx)} — ${dateTag}`.slice(0, 140);

      const copy = await copyTemplate(templateId, fileName);
      await replaceTexts(copy.id, replacements);
      const pdfBytes = await exportPdf(copy.id);

      const slug = fileName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
      const blob = await put(`documents-dossiers/${slug}.pdf`, pdfBytes, {
        access: 'private', contentType: 'application/pdf', addRandomSuffix: true,
      });
      const pdfUrl = `https://outils.eneko.ai/api/dossier-pdf?d=docs&f=${encodeURIComponent(blob.pathname.replace('documents-dossiers/', ''))}`;
      const docUrl = copy.link || `https://docs.google.com/document/d/${copy.id}/edit`;

      const horodatage = new Intl.DateTimeFormat('fr-FR', {
        timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short',
      }).format(new Date());
      try {
        await appendToDossier(dossierId, doc.label, docUrl, pdfUrl, horodatage);
      } catch (err) {
        console.error('cockpit-docs Notion append:', err.message);
      }

      return res.status(200).json({ ok: true, docUrl, pdfUrl, fileName });
    }

    return res.status(400).json({ error: 'Action inconnue.' });
  } catch (err) {
    console.error('cockpit-docs error:', err.message);
    const isLink = DOCUMENTS[capString(req.body?.docType, 40)]?.kind === 'lien';
    const msg = isLink && /blob/i.test(err.message)
      ? 'Création du lien impossible. Réessayez dans un instant.'
      : /storageQuota/i.test(err.message)
      ? 'Le dossier de sortie doit être dans un Drive PARTAGÉ (un compte de service ne peut pas posséder de fichiers dans « Mon Drive »).'
      : /Google/.test(err.message)
        ? 'Génération Google impossible. Vérifiez que le modèle et le dossier de sortie sont partagés avec le compte de service.'
        : /blob/i.test(err.message)
        ? 'Document généré dans Drive mais stockage du PDF impossible. Réessayez dans un instant.'
        : 'Lecture Notion impossible. Vérifiez la connexion de l\'intégration.';
    return res.status(500).json({ error: msg });
  }
}
