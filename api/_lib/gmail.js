// ════════════════════════════════════════════════════════════════
//  api/_lib/gmail.js  —  Envoi d'emails depuis le cockpit (API Gmail)
//
//  Le compte de service Google a une délégation au niveau du domaine
//  limitée au SEUL droit `gmail.send` (console admin Workspace →
//  Sécurité → Commandes des API → Délégation au niveau du domaine) :
//  il peut envoyer AU NOM d'une boîte eneko.ai, jamais lire un email.
//  Le message part donc de la vraie boîte : il apparaît dans ses
//  « Envoyés » et les réponses arrivent dans la boîte habituelle.
//
//  Config (Vercel) :
//   - GOOGLE_MAIL_SERVICE_ACCOUNT_KEY : clé JSON d'un compte de service
//     dédié à l'envoi (recommandé) ; à défaut, GOOGLE_SERVICE_ACCOUNT_KEY
//     (celui du Drive/Docs) si c'est lui qui porte la délégation.
//   - COCKPIT_MAIL_SENDERS (optionnelle) : JSON qui remplace la table
//     EXPEDITEURS ci-dessous, même forme.
//
//  ⚠️ L'expéditeur n'est JAMAIS choisi par la page : il est déduit de
//  l'email de la session authentifiée (expediteurPour). Une adresse
//  « De » qui n'est pas la boîte elle-même (bonjour@ est un alias de la
//  boîte de Benjamin) doit être déclarée dans Gmail → Paramètres →
//  Comptes → « Envoyer des e-mails en tant que », sinon Gmail remplace
//  silencieusement le « De » par l'adresse principale.
// ════════════════════════════════════════════════════════════════

import crypto from 'node:crypto';

const SCOPE = 'https://www.googleapis.com/auth/gmail.send';

/* ─── Qui envoie quoi (décision Benjamin du 2026-09-24) ──────────
   Clé = partie locale de l'email de session. La boîte dont on prend
   l'identité est le compte Workspace réel de la personne (`mailbox`,
   défaut <local>@eneko-formation.fr, que la session soit ouverte en
   eneko-formation.fr ou en eneko.ai) ; `from` = adresse affichée (alias
   « Envoyer en tant que » de cette boîte) ; `cc` = copie systématique.
   Si l'alias n'est pas déclaré, Gmail envoie depuis l'adresse principale. */
const EXPEDITEURS = {
  deborah: { from: 'deborah@eneko.ai', nom: 'Déborah — Eneko', cc: ['bonjour@eneko.ai'] },
  benjamin: { from: 'bonjour@eneko.ai', nom: 'Eneko Formation', cc: ['deborah@eneko.ai'] },
};
const DOMAINES_SESSION = ['eneko-formation.fr', 'eneko.ai'];

function table() {
  const raw = process.env.COCKPIT_MAIL_SENDERS;
  if (!raw) return EXPEDITEURS;
  try { return JSON.parse(raw); } catch { return EXPEDITEURS; }
}

// Expéditeur de la session, ou null (session sans boîte d'envoi : refus).
export function expediteurPour(sessionEmail) {
  const [local, domaine] = String(sessionEmail || '').toLowerCase().trim().split('@');
  if (!local || !DOMAINES_SESSION.includes(domaine)) return null;
  const e = table()[local];
  // Boîte réelle = adresse principale Workspace (…@eneko-formation.fr) : une
  // session ouverte avec l'alias …@eneko.ai emprunte la même boîte.
  return e && e.from ? { ...e, mailbox: e.mailbox || `${local}@eneko-formation.fr`, cc: Array.isArray(e.cc) ? e.cc : [] } : null;
}

/* ─── Compte de service + jeton « au nom de » (cache par boîte) ── */

function serviceAccount() {
  const raw = process.env.GOOGLE_MAIL_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw);
    return sa.client_email && sa.private_key ? sa : null;
  } catch { return null; }
}

export const gmailConfigured = () => !!serviceAccount();

const tokens = new Map();
const b64url = (buf) => Buffer.from(buf).toString('base64url');

async function tokenPour(mailbox) {
  const hit = tokens.get(mailbox);
  if (hit && Date.now() - hit.at < 50 * 60_000) return hit.token;
  const sa = serviceAccount();
  if (!sa) throw new Error('Gmail: clé du compte de service manquante');
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email, sub: mailbox, scope: SCOPE,
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const jwt = `${header}.${claims}.${b64url(signer.sign(sa.private_key))}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Gmail token ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  tokens.set(mailbox, { at: Date.now(), token: data.access_token });
  return data.access_token;
}

/* ─── Construction du message MIME ────────────────────────────── */

// Aucun retour à la ligne ne doit survivre dans un en-tête (injection).
const oneLine = (s) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim();
const encWord = (s) => /^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
const wrap76 = (b64) => b64.replace(/.{1,76}/g, '$&\r\n');
const adresse = (email, nom) => nom ? `${encWord(oneLine(nom).replace(/"/g, ''))} <${email}>` : email;

export const EMAIL_RE = /^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function texteVersHtml(text) {
  const corps = escHtml(text)
    .replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)»]/g, (u) => `<a href="${u}">${u}</a>`)
    .replace(/\r?\n/g, '<br>\r\n');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1a1a2e;">${corps}</div>`;
}

// signature : { html, text, images[{cid, filename, contentType, content}] }
// (voir signatures-email.js) — ajoutée sous le message, logo en inline (cid:).
export function construireMime({ from, fromNom, to, cc, subject, text, signature = null, attachments = [] }) {
  const bnd = () => `=_eneko_${crypto.randomBytes(12).toString('hex')}`;
  const mixed = bnd(), rel = bnd(), alt = bnd();
  const texte = signature ? `${text}\n\n${signature.text}` : text;
  const html = texteVersHtml(text) + (signature ? signature.html : '');
  const lignes = [
    `From: ${adresse(from, fromNom)}`,
    `To: ${to.join(', ')}`,
    ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []),
    `Subject: ${encWord(oneLine(subject))}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    '',
    `--${mixed}`,
    `Content-Type: multipart/related; boundary="${rel}"`,
    '',
    `--${rel}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(texte, 'utf8').toString('base64')),
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(html, 'utf8').toString('base64')),
    `--${alt}--`,
  ];
  for (const img of signature?.images || []) {
    lignes.push(
      `--${rel}`,
      `Content-Type: ${img.contentType}; name="${img.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-ID: <${img.cid}>`,
      `Content-Disposition: inline; filename="${img.filename}"`,
      '',
      wrap76(Buffer.from(img.content).toString('base64')),
    );
  }
  lignes.push(`--${rel}--`);
  for (const a of attachments) {
    const nom = oneLine(a.filename).replace(/"/g, '') || 'piece-jointe';
    const ascii = nom.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '_');
    lignes.push(
      `--${mixed}`,
      `Content-Type: ${oneLine(a.contentType) || 'application/octet-stream'}; name="${ascii}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nom)}`,
      '',
      wrap76(Buffer.from(a.content).toString('base64')),
    );
  }
  lignes.push(`--${mixed}--`, '');
  return lignes.join('\r\n');
}

/* ─── Envoi ───────────────────────────────────────────────────── */

// Upload « media » : accepte jusqu'à 35 Mo (le point d'entrée JSON est
// limité à quelques Mo, trop juste avec des PDF en pièce jointe).
export async function envoyerGmail(mailbox, mime) {
  const token = await tokenPour(mailbox);
  const res = await fetch('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'message/rfc822' },
    body: mime,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Gmail send ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json(); // { id, threadId, labelIds }
}
