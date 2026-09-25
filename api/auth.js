// ════════════════════════════════════════════════════════════════
//  /api/auth  —  Connexion aux outils internes par code envoyé par email
//
//  Étape 1  { email }              → un code à 6 chiffres est envoyé à
//           l'adresse (si elle est autorisée) ; réponse IDENTIQUE que
//           l'adresse soit autorisée ou non (pas d'énumération) :
//           { step: 'code', email, challenge }.
//  Étape 2  { challenge, code }    → token de session (7 jours).
//
//  Sans état serveur pour le code : le `challenge` est un payload signé
//  (HMAC, domaine 'otp-challenge') qui porte l'email, un nonce,
//  l'expiration (10 min) et l'empreinte HMAC du code — le client ne peut
//  ni le lire utilement ni le forger. Les essais sont comptés par des
//  marqueurs Blob privés, un fichier PAR essai (jamais de
//  relecture-réécriture d'un compteur, cf. émargement) :
//    auth-otp/<nonce>/echec-*.json  → 5 échecs = code grillé
//    auth-otp/<nonce>/ok.json       → écrit sans écrasement : un code
//                                     ne sert qu'une fois, même en course.
// ════════════════════════════════════════════════════════════════

import crypto from 'node:crypto';
import { put, list } from '@vercel/blob';
import { guardPost, capString } from './_lib/guard.js';
import { getAuthSecret, signToken, signPayloadToken, verifyPayloadToken } from './_lib/token.js';

const CODE_TTL_MS = 10 * 60_000;
const MAX_ESSAIS = 5;
const RESEND_FROM = process.env.RESEND_FROM_FORMATION || 'Eneko Formation <outils@eneko-formation.fr>';

const allowedEmails = () => (process.env.ALLOWED_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

const empreinte = (secret, email, nonce, code) =>
  crypto.createHmac('sha256', secret).update(`otp|${email}|${nonce}|${code}`).digest('hex');

async function envoyerCode(email, code) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY manquant');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0b0c2e;">
    <p style="font-size:15px;margin:0 0 16px;">Votre code de connexion aux outils Eneko :</p>
    <p style="font-size:34px;font-weight:bold;letter-spacing:8px;color:#7643E5;margin:0 0 16px;">${code}</p>
    <p style="font-size:13px;color:#555;margin:0 0 8px;">Il est valable 10 minutes et ne peut servir qu'une fois.</p>
    <p style="font-size:12px;color:#888;margin:24px 0 0;">Vous n'avez rien demandé ? Ignorez cet email : sans ce code, personne ne peut se connecter à votre place.</p>
  </div>`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: RESEND_FROM, to: [email],
      subject: 'Votre code de connexion — outils Eneko',
      html,
      text: `Votre code de connexion aux outils Eneko : ${code}\n\nValable 10 minutes, utilisable une seule fois.\nVous n'avez rien demandé ? Ignorez cet email.`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

export default async function handler(req, res) {
  if (!(await guardPost(req, res, { maxBodyChars: 4_000, limit: 10, windowMs: 60_000 }))) return;

  const secret = getAuthSecret();
  if (!secret) return res.status(500).json({ error: 'Service indisponible (configuration).' });

  const body = req.body || {};

  /* ── Étape 2 : vérification du code ─────────────────────────── */
  if (body.challenge) {
    const ch = verifyPayloadToken(capString(body.challenge, 2000), secret, 'otp-challenge');
    const code = capString(body.code, 12).replace(/\s+/g, '');
    if (!ch) return res.status(401).json({ error: 'Code expiré. Demandez-en un nouveau.', expired: true });
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Le code contient 6 chiffres.' });
    if (!/^[0-9a-f]{32}$/.test(ch.n || '') || !allowedEmails().includes(ch.e)) {
      await new Promise(r => setTimeout(r, 400));
      return res.status(401).json({ error: 'Code incorrect.' });
    }

    try {
      const prefix = `auth-otp/${ch.n}/`;
      const { blobs } = await list({ prefix, limit: 20 });
      if (blobs.some(b => b.pathname.endsWith('/ok.json'))) {
        return res.status(401).json({ error: 'Ce code a déjà été utilisé. Demandez-en un nouveau.', expired: true });
      }
      const echecs = blobs.filter(b => b.pathname.includes('/echec-')).length;
      if (echecs >= MAX_ESSAIS) {
        return res.status(401).json({ error: 'Trop d\'essais. Demandez un nouveau code.', expired: true });
      }

      const a = Buffer.from(empreinte(secret, ch.e, ch.n, code));
      const b = Buffer.from(String(ch.h || ''));
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        await put(`${prefix}echec-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`, '{}', {
          access: 'private', contentType: 'application/json', addRandomSuffix: false,
        });
        const restants = MAX_ESSAIS - echecs - 1;
        return res.status(401).json({
          error: restants > 0 ? `Code incorrect (${restants} essai${restants > 1 ? 's' : ''} restant${restants > 1 ? 's' : ''}).` : 'Code incorrect. Demandez un nouveau code.',
          expired: restants <= 0,
        });
      }

      // Usage unique : sans allowOverwrite, un second put du même chemin échoue.
      try {
        await put(`${prefix}ok.json`, JSON.stringify({ at: new Date().toISOString() }), {
          access: 'private', contentType: 'application/json', addRandomSuffix: false,
        });
      } catch {
        return res.status(401).json({ error: 'Ce code a déjà été utilisé. Demandez-en un nouveau.', expired: true });
      }
      return res.status(200).json({ token: signToken(ch.e, secret), email: ch.e });
    } catch (err) {
      console.error('auth vérification:', err.message);
      return res.status(500).json({ error: 'Vérification impossible. Réessayez dans un instant.' });
    }
  }

  /* ── Étape 1 : envoi du code ────────────────────────────────── */
  const email = capString(body.email, 200).toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return res.status(400).json({ error: 'Adresse email invalide.' });

  const nonce = crypto.randomBytes(16).toString('hex');
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const challenge = signPayloadToken({
    e: email, n: nonce, exp: Date.now() + CODE_TTL_MS, h: empreinte(secret, email, nonce, code),
  }, secret, 'otp-challenge');

  if (allowedEmails().includes(email)) {
    try {
      await envoyerCode(email, code);
    } catch (err) {
      console.error('auth envoi du code:', err.message);
      return res.status(500).json({ error: 'Envoi du code impossible. Réessayez dans un instant.' });
    }
  } else {
    // Même temps de réponse qu'un envoi réel : rien ne distingue une adresse inconnue.
    await new Promise(r => setTimeout(r, 400 + Math.random() * 400));
  }
  return res.status(200).json({ step: 'code', email, challenge });
}
