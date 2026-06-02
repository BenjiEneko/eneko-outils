// ════════════════════════════════════════════════════════════════
//  /api/recrutement-save  —  Sauvegarde + notification d'une candidature
//
//  1) Crée une fiche candidat dans la base Notion "Candidatures —
//     Formateur IA" : quelques propriétés clés (nom, email, note,
//     recommandation, statut) + le détail complet dans le CORPS de la
//     page (fiche IA, liens médias, transcript).
//  2) Notifie le recruteur (RECRUITER_EMAIL) par email via Resend.
//  3) Envoie un email de confirmation au candidat.
//
//  Tout est fail-soft : un échec Notion ou email n'interrompt jamais
//  le candidat (comme api/save-diagnostic.js).
// ════════════════════════════════════════════════════════════════

const NOTION_VERSION   = '2022-06-28';
// Base « Candidatures — Formateur·trice IA » (sous « Documentation & Process »).
// ⚠️ L'intégration Notion derrière NOTION_TOKEN doit être connectée à cette base
//    (ouvrir la base → ••• → Connexions → ajouter l'intégration Eneko).
const CANDIDATURE_DB_ID = process.env.CANDIDATURE_DB_ID || '4686ad1f10954f21ac66578209681906';
const RECRUITER_EMAIL   = process.env.RECRUITER_EMAIL || 'benjamin@studio-ulk.fr';

/* ─── NOTION HELPERS ─────────────────────────────────────────── */
function notionHeaders() {
  return {
    'Authorization':  `Bearer ${process.env.NOTION_TOKEN}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type':   'application/json',
  };
}
function txt(content) {
  return [{ type: 'text', text: { content: (content || '').slice(0, 2000) } }];
}
function linkTxt(label, url) {
  return [{ type: 'text', text: { content: label.slice(0, 2000), link: url ? { url } : null } }];
}
function para(content)   { return { object: 'block', type: 'paragraph',         paragraph:         { rich_text: txt(content) } }; }
function h2(content)     { return { object: 'block', type: 'heading_2',         heading_2:         { rich_text: txt(content) } }; }
function h3(content)     { return { object: 'block', type: 'heading_3',         heading_3:         { rich_text: txt(content) } }; }
function bullet(content) { return { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: txt(content) } }; }
function divider()       { return { object: 'block', type: 'divider',          divider: {} }; }
function callout(content, emoji) {
  return { object: 'block', type: 'callout',
    callout: { rich_text: txt(content), icon: { type: 'emoji', emoji: emoji || '💡' } } };
}
function linkPara(label, url) {
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: linkTxt(label, url) } };
}

/* ─── CORPS DE PAGE NOTION ───────────────────────────────────── */
function buildPageBlocks({ evaluation, transcript, media }) {
  const blocks = [];
  const ev = evaluation || {};

  if (ev.profil) blocks.push(callout(ev.profil, '🎯'));

  if (ev.note_globale != null || ev.recommandation) {
    blocks.push(para(`Note globale : ${ev.note_globale ?? '—'} / 100   ·   Recommandation : ${ev.recommandation ?? '—'}`));
  }

  // Compétences
  const comp = ev.competences || {};
  const compLabels = {
    pedagogie:          'Pédagogie & tutorat',
    maitrise_ia:        'Maîtrise IA générative',
    profondeur_digital: 'Profondeur digitale (workflows)',
    clarte_propos:      'Clarté & structure du propos',
    fit_cadre:          'Adéquation au cadre',
  };
  const compKeys = Object.keys(compLabels).filter(k => comp[k]);
  if (compKeys.length) {
    blocks.push(h3('Compétences'));
    compKeys.forEach(k => {
      const c = comp[k] || {};
      blocks.push(bullet(`${compLabels[k]} — ${c.note ?? '—'}/5 · ${c.commentaire || ''}`));
    });
  }

  if (Array.isArray(ev.points_forts) && ev.points_forts.length) {
    blocks.push(h3('✅ Points forts'));
    ev.points_forts.forEach(p => blocks.push(bullet(p)));
  }
  if (Array.isArray(ev.points_vigilance) && ev.points_vigilance.length) {
    blocks.push(h3('⚠️ Points de vigilance'));
    ev.points_vigilance.forEach(p => blocks.push(bullet(p)));
  }
  if (Array.isArray(ev.questions_entretien) && ev.questions_entretien.length) {
    blocks.push(h3('❓ À creuser en entretien réel'));
    ev.questions_entretien.forEach(q => blocks.push(bullet(q)));
  }
  if (ev.synthese) { blocks.push(h3('Synthèse')); blocks.push(para(ev.synthese)); }

  // Médias
  blocks.push(divider());
  blocks.push(h2('🎬 Enregistrements'));
  blocks.push(para('⚠️ La voix, le débit et la présence caméra se jugent à l\'écoute ci-dessous (l\'IA n\'évalue que le contenu écrit).'));
  if (media?.presentationVideo) blocks.push(linkPara('📹 Vidéo de présentation (60 s)', media.presentationVideo));
  (media?.audios || []).forEach(a => {
    if (a.url) blocks.push(linkPara(`🔊 ${a.title || a.id}`, a.url));
  });

  // Transcript
  blocks.push(divider());
  blocks.push(h2('📝 Transcript de l\'entretien'));
  (transcript || []).forEach((t, i) => {
    blocks.push(h3(`Q${i + 1} — ${t.title || ''}`));
    blocks.push(para(t.question || ''));
    const answer = (t.answer || '').trim() || '(réponse uniquement vocale — voir l\'enregistrement)';
    // Découpe en morceaux de 1900 caractères (limite Notion 2000/bloc)
    for (let j = 0; j < answer.length; j += 1900) {
      blocks.push(para('› ' + answer.slice(j, j + 1900)));
    }
    if (t.link) blocks.push(linkPara('🔗 Lien fourni', t.link));
  });

  return blocks.slice(0, 100); // Notion : max 100 blocs par création de page
}

async function saveToNotion({ prenom, nom, email, evaluation, transcript, media }) {
  if (!CANDIDATURE_DB_ID) throw new Error('CANDIDATURE_DB_ID non configuré');
  const ev = evaluation || {};

  const properties = {
    'Nom complet':    { title: txt(`${prenom} ${nom}`.trim() || email) },
    'Email':          { email: (email || '').toLowerCase().trim() || null },
    'Date':           { date: { start: new Date().toISOString().split('T')[0] } },
    'Statut':         { select: { name: 'Nouveau' } },
  };
  if (ev.note_globale != null)  properties['Note'] = { number: Number(ev.note_globale) };
  if (ev.recommandation)        properties['Recommandation'] = { select: { name: ev.recommandation } };
  if (media?.driveFolder)       properties['Dossier Drive'] = { url: media.driveFolder };

  const body = {
    parent:     { database_id: CANDIDATURE_DB_ID },
    properties,
    children:   buildPageBlocks({ evaluation, transcript, media }),
  };

  const r = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST', headers: notionHeaders(), body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Notion create ${r.status}: ${await r.text()}`);
  return r.json();
}

/* ─── EMAILS (RESEND) ────────────────────────────────────────── */
function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

async function resendSend({ to, subject, html, replyTo }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY manquant');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from:     process.env.RESEND_FROM || 'Eneko Recrutement <outils@eneko-formation.fr>',
      reply_to: replyTo ? [replyTo] : ['bonjour@eneko-formation.fr'],
      to:       [to],
      subject,
      html,
    }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}

function recruiterEmailHtml({ prenom, nom, email, evaluation, media, notionUrl }) {
  const ev = evaluation || {};
  const forts = (ev.points_forts || []).map(p => `<li>${esc(p)}</li>`).join('');
  const vig   = (ev.points_vigilance || []).map(p => `<li>${esc(p)}</li>`).join('');
  const links = [];
  if (media?.presentationVideo) links.push(`<a href="${media.presentationVideo}" style="color:#8037EE;">📹 Vidéo de présentation</a>`);
  (media?.audios || []).forEach(a => { if (a.url) links.push(`<a href="${a.url}" style="color:#8037EE;">🔊 ${esc(a.title || a.id)}</a>`); });

  return `<!DOCTYPE html><html lang="fr"><body style="margin:0;background:#F0EEE9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 16px 44px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
      <tr><td style="background:#1A1A2E;border-radius:16px 16px 0 0;padding:28px 36px;">
        <p style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.45);margin:0 0 8px;">Nouvelle candidature · Formateur IA</p>
        <h1 style="font-size:24px;color:#fff;margin:0;font-family:Georgia,serif;">${esc(prenom)} ${esc(nom)}</h1>
        <p style="margin:8px 0 0;color:rgba(255,255,255,0.7);font-size:14px;">
          Note IA : <strong style="color:#fff;">${ev.note_globale ?? '—'}/100</strong> · ${esc(ev.recommandation || '—')}
        </p>
      </td></tr>
      <tr><td style="background:#fff;padding:30px 36px;">
        ${ev.profil ? `<p style="font-size:15px;color:#333;line-height:1.6;margin:0 0 18px;"><em>${esc(ev.profil)}</em></p>` : ''}
        ${forts ? `<p style="font-size:13px;font-weight:700;color:#1A1A1A;margin:18px 0 6px;">✅ Points forts</p><ul style="font-size:14px;color:#333;line-height:1.6;margin:0;padding-left:20px;">${forts}</ul>` : ''}
        ${vig ? `<p style="font-size:13px;font-weight:700;color:#1A1A1A;margin:18px 0 6px;">⚠️ Points de vigilance</p><ul style="font-size:14px;color:#333;line-height:1.6;margin:0;padding-left:20px;">${vig}</ul>` : ''}
        ${ev.synthese ? `<p style="font-size:14px;color:#333;line-height:1.65;margin:18px 0 0;">${esc(ev.synthese)}</p>` : ''}
        ${links.length ? `<p style="font-size:13px;font-weight:700;color:#1A1A1A;margin:22px 0 6px;">🎬 Enregistrements</p><p style="font-size:14px;line-height:1.9;margin:0;">${links.join('<br>')}</p>` : ''}
        <p style="margin:24px 0 0;">
          <a href="mailto:${esc(email)}" style="color:#8037EE;text-decoration:none;font-size:14px;">✉️ ${esc(email)}</a>
          ${notionUrl ? `&nbsp;·&nbsp;<a href="${notionUrl}" style="color:#8037EE;text-decoration:none;font-size:14px;">📄 Fiche Notion complète</a>` : ''}
        </p>
      </td></tr>
      <tr><td style="background:#FAFAF8;border-radius:0 0 16px 16px;border-top:1px solid #ECEAE5;padding:16px 36px;text-align:center;">
        <p style="font-size:12px;color:#BBB;margin:0;">Candidature reçue via outils.eneko.ai · Évaluation IA indicative (contenu écrit uniquement)</p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

function candidateEmailHtml({ prenom }) {
  return `<!DOCTYPE html><html lang="fr"><body style="margin:0;background:#F0EEE9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px 48px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
      <tr><td style="background:#1A1A2E;border-radius:16px 16px 0 0;padding:32px 40px;">
        <h1 style="font-size:24px;color:#fff;margin:0;font-family:Georgia,serif;">Merci ${esc(prenom)} 🙌</h1>
      </td></tr>
      <tr><td style="background:#fff;padding:32px 40px;">
        <p style="font-size:15px;color:#333;line-height:1.7;margin:0 0 14px;">Ta candidature au poste de formateur·trice IA chez Eneko est bien arrivée — entretien, enregistrements et tout le reste.</p>
        <p style="font-size:15px;color:#333;line-height:1.7;margin:0;">On regarde tout ça attentivement et on revient vers toi très vite. À très bientôt !</p>
      </td></tr>
      <tr><td style="background:#FAFAF8;border-radius:0 0 16px 16px;border-top:1px solid #ECEAE5;padding:18px 40px;text-align:center;">
        <p style="font-size:12px;color:#BBB;margin:0;"><a href="https://eneko.ai" style="color:#8037EE;text-decoration:none;font-weight:600;">eneko.ai</a> · bonjour@eneko-formation.fr</p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

/* ─── SLACK (#administration via Incoming Webhook) ───────────── */
async function postToSlack({ prenom, nom, email, evaluation, media, notionUrl }) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) throw new Error('SLACK_WEBHOOK_URL manquant');
  const ev = evaluation || {};

  const forts = (ev.points_forts || []).slice(0, 3).map(p => `• ${p}`).join('\n');
  const links = [];
  if (media?.presentationVideo) links.push(`<${media.presentationVideo}|📹 Vidéo>`);
  (media?.audios || []).forEach(a => { if (a.url) links.push(`<${a.url}|🔊 ${a.title || a.id}>`); });

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `🎯 Candidature — ${prenom} ${nom}`.slice(0, 150), emoji: true } },
    { type: 'section', fields: [
      { type: 'mrkdwn', text: `*Note IA :*\n${ev.note_globale ?? '—'} / 100` },
      { type: 'mrkdwn', text: `*Recommandation :*\n${ev.recommandation ?? '—'}` },
    ] },
    ...(ev.profil ? [{ type: 'section', text: { type: 'mrkdwn', text: `_${ev.profil}_` } }] : []),
    ...(forts ? [{ type: 'section', text: { type: 'mrkdwn', text: `*Points forts*\n${forts}` } }] : []),
    ...(links.length ? [{ type: 'section', text: { type: 'mrkdwn', text: `*Enregistrements :* ${links.join('   ·   ')}` } }] : []),
    { type: 'context', elements: [{ type: 'mrkdwn', text: `✉️ ${email}${notionUrl ? `   ·   <${notionUrl}|📄 Fiche Notion>` : ''}` }] },
  ];

  const r = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: `Nouvelle candidature — ${prenom} ${nom} (${ev.note_globale ?? '—'}/100 · ${ev.recommandation ?? 'à voir'})`, blocks }),
  });
  if (!r.ok) throw new Error(`Slack ${r.status}: ${await r.text()}`);
}

/* ─── HANDLER ────────────────────────────────────────────────── */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prenom, nom, email, evaluation, transcript, media } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email manquant' });

  const prenomSafe = (prenom || '').trim();
  const nomSafe    = (nom || '').trim();

  let notionSaved = false, notionUrl = null, recruiterEmailed = false, candidateEmailed = false;

  // 1 — Notion
  try {
    const page = await saveToNotion({ prenom: prenomSafe, nom: nomSafe, email, evaluation, transcript, media });
    notionSaved = true;
    notionUrl   = page.url || (page.id ? `https://www.notion.so/${page.id.replace(/-/g, '')}` : null);
  } catch (err) {
    console.error('Notion save failed:', err.message);
  }

  // 2 — Email recruteur
  try {
    await resendSend({
      to:      RECRUITER_EMAIL,
      replyTo: email,
      subject: `🎯 Candidature — ${prenomSafe} ${nomSafe} (${evaluation?.note_globale ?? '—'}/100 · ${evaluation?.recommandation ?? 'à voir'})`,
      html:    recruiterEmailHtml({ prenom: prenomSafe, nom: nomSafe, email, evaluation, media, notionUrl }),
    });
    recruiterEmailed = true;
  } catch (err) {
    console.error('Recruiter email failed:', err.message);
  }

  // 3 — Email candidat (confirmation)
  try {
    await resendSend({
      to:      email,
      subject: `Candidature bien reçue chez Eneko 🙌`,
      html:    candidateEmailHtml({ prenom: prenomSafe || 'à toi' }),
    });
    candidateEmailed = true;
  } catch (err) {
    console.error('Candidate email failed:', err.message);
  }

  // 4 — Notification Slack #administration
  let slackNotified = false;
  try {
    await postToSlack({ prenom: prenomSafe, nom: nomSafe, email, evaluation, media, notionUrl });
    slackNotified = true;
  } catch (err) {
    console.error('Slack notify failed:', err.message);
  }

  return res.status(200).json({ success: true, notionSaved, notionUrl, recruiterEmailed, candidateEmailed, slackNotified });
}
