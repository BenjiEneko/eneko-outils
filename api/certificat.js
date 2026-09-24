// ════════════════════════════════════════════════════════════════
//  /api/certificat  —  Page publique d'un certificat de formation Eneko
//  (rewrite : https://outils.eneko.ai/certificat/<id>)
//
//  GET ?id=ENK-26-XXXXXX           → page de vérification + partage
//  GET ?id=…&f=png|og|pdf[&dl=1]   → fichiers (Blob privé streamé)
//
//  La page porte les balises Open Graph (image 1200×627) : c'est elle que
//  LinkedIn affiche quand l'apprenant partage son lien. Elle sert aussi de
//  preuve (QR code du certificat) et de vitrine (appel vers eneko.ai).
//  noindex : le nom de l'apprenant n'a pas à être indexé par les moteurs.
// ════════════════════════════════════════════════════════════════

import { get } from '@vercel/blob';
import { checkRateLimit } from './_lib/guard.js';
import {
  ID_RE, readJson, pageUrl, assetUrl, linkedinAddUrl, textePublication, linkedinShareUrl,
} from './_lib/certificats-publics.js';

const FICHIERS = {
  png: { suffix: '.png', type: 'image/png', ext: 'png' },
  og: { suffix: '-og.png', type: 'image/png', ext: 'png' },
  pdf: { suffix: '.pdf', type: 'application/pdf', ext: 'pdf' },
};

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const slug = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

const CTA = 'https://eneko.ai/?utm_source=certificat&utm_medium=referral&utm_campaign=certificat-formation';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (await checkRateLimit(req, { limit: 120, windowMs: 60_000 })) {
    return res.status(429).send('Trop de requêtes. Réessayez dans une minute.');
  }

  const id = String(req.query?.id || '').toUpperCase();
  const f = String(req.query?.f || '');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (!ID_RE.test(id)) return page404(res);

  try {
    if (f) {
      const spec = FICHIERS[f];
      if (!spec) return res.status(400).json({ error: 'Fichier invalide.' });
      const found = await get(`certificats/${id}${spec.suffix}`, {
        access: 'private', abortSignal: AbortSignal.timeout(15_000),
      }).catch(() => null);
      if (!found?.stream) return res.status(404).json({ error: 'Fichier introuvable.' });
      const buf = Buffer.from(await new Response(found.stream).arrayBuffer());
      const fiche = req.query?.dl ? await readJson(`certificats/${id}.json`) : null;
      const nomFichier = `Certificat-Eneko-${slug(fiche?.nom) || id}.${spec.ext}`;
      res.setHeader('Content-Type', spec.type);
      res.setHeader('Content-Disposition', `${req.query?.dl ? 'attachment' : 'inline'}; filename="${nomFichier}"`);
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
      return res.status(200).send(buf);
    }

    const fiche = await readJson(`certificats/${id}.json`);
    if (!fiche) return page404(res);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300');
    return res.status(200).send(pageHtml(fiche));
  } catch (err) {
    console.error('certificat error:', err.message);
    return res.status(500).send('Certificat momentanément indisponible. Réessayez dans un instant.');
  }
}

/* ─── Gabarit commun ─────────────────────────────────────────── */

const HEAD_COMMUN = `
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="/assets/favicon-eneko-ai.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Playfair+Display:ital,wght@1,600&display=swap" rel="stylesheet">
<style>
  :root { --ink:#0B0C2E; --ink-mid:#444457; --ink-soft:#6E7086; --accent:#7643E5; --accent-bg:#F1ECFD;
    --bleu:#3843D0; --rose:#E580E7; --paper:#F4F5FB; --line:#E4E4EF; --card:#FFFFFF; --ok:#1E7B45; --ok-bg:#E6F4EC; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:'Outfit',system-ui,sans-serif; color:var(--ink); background:var(--paper);
    background-image: radial-gradient(900px 520px at 0% 0%, rgba(229,128,231,.18), transparent 60%),
      radial-gradient(800px 500px at 100% 10%, rgba(118,67,229,.14), transparent 60%); background-repeat:no-repeat; }
  a { color: var(--accent); }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 0 20px; }
  header.top { display:flex; align-items:center; justify-content:space-between; padding: 22px 0; }
  header.top img { height: 30px; display:block; }
  header.top a.lien { font-weight:600; font-size:14.5px; text-decoration:none; color:var(--ink);
    border:1.5px solid var(--line); background:#fff; border-radius:999px; padding:9px 16px; }
  .serif { font-family:'Playfair Display',Georgia,serif; font-style:italic; font-weight:600; }
  .btn { display:inline-flex; align-items:center; justify-content:center; gap:9px; font:inherit; font-weight:600;
    font-size:15px; border-radius:999px; padding:13px 20px; border:0; cursor:pointer; text-decoration:none; line-height:1.2; }
  .btn:focus-visible, textarea:focus-visible { outline: 3px solid rgba(118,67,229,.45); outline-offset: 2px; }
  .btn.li { background:#0A66C2; color:#fff; } .btn.li:hover { background:#004182; }
  .btn.primaire { background:var(--accent); color:#fff; } .btn.primaire:hover { background:#5E30C7; }
  .btn.sec { background:#fff; color:var(--ink); border:1.5px solid var(--line); } .btn.sec:hover { border-color:var(--accent); }
  footer { color:var(--ink-soft); font-size:13px; padding: 36px 0 48px; line-height:1.6; }
</style>`;

function page404(res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60');
  return res.status(404).send(`<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Certificat introuvable | Eneko</title>${HEAD_COMMUN}</head>
<body><div class="wrap"><header class="top"><a href="${CTA}"><img src="/assets/logo-eneko.svg" alt="eneko.ai"></a></header>
<main style="padding:60px 0 20px;max-width:620px;">
<h1 class="serif" style="font-size:44px;margin:0 0 14px;">Certificat introuvable</h1>
<p style="font-size:18px;color:var(--ink-mid);line-height:1.6;">Aucun certificat Eneko ne correspond à cette adresse. Vérifiez le lien ou l'identifiant
(format <strong>ENK-26-XXXXXX</strong>) indiqué sous le QR code du certificat.</p>
<p><a class="btn primaire" href="${CTA}">Découvrir les formations Eneko</a></p>
</main></div></body></html>`);
}

/* ─── Page certificat ────────────────────────────────────────── */

function pageHtml(c) {
  const url = pageUrl(c.id);
  const prenom = c.prenom || c.nom.split(' ')[0];
  const intitule = c.formationCourte || c.formation;
  const titre = `${c.nom} a terminé la formation « ${intitule} »`;
  const desc = `Certificat de formation délivré par Eneko le ${c.dateEmission}${c.duree ? ` (${c.duree})` : ''}. Identifiant ${c.id}.`;
  const texte = textePublication(c);
  const details = [
    ['Durée', c.duree], ['Période', c.periode], ['Délivré le', c.dateEmission], ['Identifiant', c.id],
  ].filter(([, v]) => v);

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>${esc(titre)} | Eneko</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Eneko">
<meta property="og:locale" content="fr_FR">
<meta property="og:url" content="${esc(url)}">
<meta property="og:title" content="${esc(titre)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(assetUrl(c.id, 'og'))}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="627">
<meta property="og:image:alt" content="${esc(`Certificat de formation Eneko de ${c.nom}`)}">
<meta name="twitter:card" content="summary_large_image">
${HEAD_COMMUN}
<style>
  .verif { display:inline-flex; align-items:center; gap:8px; background:var(--ok-bg); color:var(--ok);
    font-weight:600; font-size:14px; border-radius:999px; padding:7px 14px; }
  .hero { padding: 18px 0 8px; }
  .hero h1 { font-size: clamp(34px, 5.4vw, 58px); line-height:1.08; margin: 16px 0 10px; }
  .hero p { font-size: 18px; color: var(--ink-mid); margin: 0; line-height:1.5; max-width: 760px; }
  .grille { display:grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); gap: 28px; margin-top: 28px; align-items:start; }
  .cert img { width:100%; height:auto; display:block; border-radius:14px; box-shadow: 0 24px 60px rgba(11,12,46,.18), 0 2px 6px rgba(11,12,46,.08); background:#fff; }
  .details { display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px; margin-top: 18px; }
  .details div { background:#fff; border:1px solid var(--line); border-radius:14px; padding:12px 14px; }
  .details dt { font-size:11.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--accent); font-weight:600; }
  .details dd { margin:4px 0 0; font-weight:600; font-size:15px; overflow-wrap:anywhere; }
  .partage { background:#fff; border:1px solid var(--line); border-radius:22px; padding: 22px; box-shadow: 0 10px 30px rgba(11,12,46,.06); }
  .partage h2 { font-size: 22px; margin: 0 0 4px; }
  .partage .sous { color: var(--ink-soft); font-size: 14.5px; margin: 0 0 16px; line-height:1.5; }
  .partage .btn { width:100%; }
  .etape { margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--line); }
  .etape h3 { font-size: 15px; margin: 0 0 8px; }
  .etape p.aide { font-size: 13.5px; color: var(--ink-soft); margin: 0 0 10px; line-height:1.5; }
  textarea { width:100%; min-height: 190px; font: inherit; font-size: 14px; line-height:1.5; color: var(--ink);
    border:1.5px solid var(--line); border-radius: 14px; padding: 12px; resize: vertical; background: var(--paper); }
  .ligne { display:flex; gap:10px; margin-top:10px; flex-wrap: wrap; }
  .ligne .btn { flex: 1 1 160px; width:auto; }
  .astuce { background: var(--accent-bg); color: #4B2A9E; border-radius: 14px; padding: 12px 14px; font-size: 13.5px; line-height:1.5; margin-top: 16px; }
  .msg { font-size: 13px; color: var(--ok); min-height: 18px; margin-top: 6px; }
  .cta { margin: 44px 0 0; border-radius: 26px; padding: 34px; color:#fff; position:relative; overflow:hidden;
    background: linear-gradient(135deg, #0B0C2E 0%, #1A1553 70%, #3843D0 130%); }
  .cta::after { content:''; position:absolute; right:-120px; top:-140px; width:420px; height:420px; border-radius:50%;
    background: radial-gradient(circle, rgba(229,128,231,.55), transparent 65%); }
  .cta h2 { font-size: clamp(28px, 4vw, 40px); margin: 0 0 10px; position:relative; }
  .cta p { color: rgba(255,255,255,.8); font-size: 17px; margin: 0 0 20px; max-width: 620px; line-height:1.5; position:relative; }
  .cta .btn { position:relative; background:#fff; color: var(--ink); }
  @media (max-width: 880px) {
    .grille { grid-template-columns: 1fr; }
    .cta { padding: 26px 22px; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <a href="${CTA}" aria-label="eneko.ai"><img src="/assets/logo-eneko.svg" alt="eneko.ai"></a>
    <a class="lien" href="${CTA}">Découvrir Eneko</a>
  </header>

  <main>
    <section class="hero">
      <span class="verif">✓ Certificat authentique, délivré par Eneko le ${esc(c.dateEmission)}</span>
      <h1 class="serif">${esc(c.nom)}</h1>
      <p>a terminé avec succès la formation <strong>« ${esc(c.formation)} »</strong>.</p>
    </section>

    <div class="grille">
      <div>
        <a class="cert" href="${esc(assetUrl(c.id, 'pdf'))}" target="_blank" rel="noopener">
          <img src="${esc(assetUrl(c.id, 'png'))}" width="2480" height="1754" alt="${esc(`Certificat de formation Eneko de ${c.nom}`)}">
        </a>
        <dl class="details">
          ${details.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}
        </dl>
      </div>

      <aside class="partage" aria-labelledby="partage-titre">
        <h2 id="partage-titre">Vous êtes ${esc(prenom)} ?</h2>
        <p class="sous">Bravo pour ce parcours ! Faites-le savoir à votre réseau en un clic.</p>

        <a class="btn li" href="${esc(linkedinAddUrl(c))}" target="_blank" rel="noopener">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"/></svg>
          Ajouter à mon profil LinkedIn
        </a>
        <p class="sous" style="margin:8px 0 0;font-size:13px;">Le certificat apparaît dans la rubrique « Licences et certifications » de votre profil, avec le lien de vérification.</p>

        <div class="etape">
          <h3>Publier sur LinkedIn</h3>
          <p class="aide">Un texte vous est proposé : personnalisez-le, puis publiez. L'aperçu du certificat s'affiche automatiquement.</p>
          <textarea id="texte" aria-label="Texte de la publication">${esc(texte)}</textarea>
          <div class="ligne">
            <button type="button" class="btn li" id="publier">Publier sur LinkedIn</button>
            <button type="button" class="btn sec" id="copier">Copier le texte</button>
          </div>
          <div class="msg" id="msg" role="status" aria-live="polite"></div>
          <div class="astuce">Astuce : dans votre publication, tapez <strong>@Eneko</strong> et choisissez notre page pour nous identifier. Nous relaierons votre réussite !</div>
        </div>

        <div class="etape">
          <h3>Télécharger ou partager ailleurs</h3>
          <div class="ligne">
            <a class="btn sec" href="${esc(assetUrl(c.id, 'pdf'))}&dl=1">PDF</a>
            <a class="btn sec" href="${esc(assetUrl(c.id, 'png'))}&dl=1">Image</a>
            <button type="button" class="btn sec" id="natif" hidden>Partager…</button>
          </div>
        </div>
      </aside>
    </div>

    <section class="cta">
      <h2 class="serif">Vous aussi, passez à l'IA. Vraiment.</h2>
      <p>Formations IA certifiées (RS6776), finançables CPF et OPCO, pour indépendants et entreprises. Ce que vous utilisez dès le lendemain matin.</p>
      <a class="btn" href="${CTA}">Découvrir les formations Eneko</a>
    </section>
  </main>

  <footer>
    Ce certificat a été émis par Eneko (M&amp;BOCA, organisme de formation, déclaration d'activité n° 75400178140).
    Son identifiant <strong>${esc(c.id)}</strong> figure dans nos registres : cette page en est la vérification officielle.
  </footer>
</div>
<script>
  (function () {
    var texte = document.getElementById('texte');
    var msg = document.getElementById('msg');
    var dire = function (t) { msg.textContent = t; setTimeout(function () { msg.textContent = ''; }, 4000); };
    document.getElementById('publier').addEventListener('click', function () {
      window.open(${JSON.stringify(linkedinShareUrl('__TEXTE__'))}.replace('__TEXTE__', encodeURIComponent(texte.value)), '_blank', 'noopener');
    });
    document.getElementById('copier').addEventListener('click', function () {
      var ok = function () { dire('Texte copié ✓'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(texte.value).then(ok, function () { texte.select(); document.execCommand('copy'); ok(); });
      } else { texte.select(); document.execCommand('copy'); ok(); }
    });
    // Partage natif (mobile) : l'image du certificat + le texte, vers n'importe quelle appli.
    var natif = document.getElementById('natif');
    if (navigator.share && navigator.canShare) {
      natif.hidden = false;
      natif.addEventListener('click', function () {
        fetch(${JSON.stringify(assetUrl(c.id, 'png'))}, { signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined })
          .then(function (r) { if (!r.ok) throw new Error('image'); return r.blob(); })
          .then(function (b) {
            var file = new File([b], ${JSON.stringify(`Certificat-Eneko-${slug(c.nom) || c.id}.png`)}, { type: 'image/png' });
            var data = { text: texte.value, url: ${JSON.stringify(url)} };
            if (navigator.canShare({ files: [file] })) data.files = [file];
            return navigator.share(data);
          })
          .catch(function (e) { if (e && e.name !== 'AbortError') dire("Partage indisponible : téléchargez l'image."); });
      });
    }
  })();
</script>
</body>
</html>`;
}
