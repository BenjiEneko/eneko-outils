// ════════════════════════════════════════════════════════════════
//  api/_lib/google.js  —  Accès Google Drive/Docs par compte de service
//
//  Utilisé par la génération de documents du cockpit : dupliquer un
//  modèle Google Docs, remplacer les champs, exporter en PDF.
//  Aucune dépendance npm : JWT RS256 signé avec node:crypto + REST.
//
//  Config (Vercel) :
//   - GOOGLE_SERVICE_ACCOUNT_KEY : le JSON complet de la clé du compte
//     de service (APIs Drive + Docs activées sur le projet GCP).
//   - GDRIVE_OUTPUT_FOLDER_ID : dossier Drive où ranger les documents
//     générés. ⚠️ Ce dossier ET les modèles doivent être partagés avec
//     l'email du compte de service (éditeur) — un compte de service n'a
//     pas de stockage propre, il écrit dans le quota du propriétaire
//     du dossier partagé.
// ════════════════════════════════════════════════════════════════

import crypto from 'node:crypto';

const SCOPES = 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/documents';

function getServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw);
    return sa.client_email && sa.private_key ? sa : null;
  } catch {
    return null;
  }
}

export function googleConfigured() {
  return !!(getServiceAccount() && process.env.GDRIVE_OUTPUT_FOLDER_ID);
}

/* ── Jeton d'accès (JWT RS256 → oauth2, cache ~50 min) ────────── */

let tokenCache = { at: 0, token: null };

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export async function googleToken() {
  if (tokenCache.token && Date.now() - tokenCache.at < 50 * 60_000) return tokenCache.token;
  const sa = getServiceAccount();
  if (!sa) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY manquant ou invalide');

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: SCOPES,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const jwt = `${header}.${claims}.${b64url(signer.sign(sa.private_key))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Google token ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  tokenCache = { at: Date.now(), token: data.access_token };
  return data.access_token;
}

async function gapi(url, { method = 'GET', body, raw = false } = {}) {
  const token = await googleToken();
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Google ${method} ${url.split('?')[0]} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return raw ? res : res.json();
}

/* ── Opérations documents ─────────────────────────────────────── */

// Copie un modèle dans le dossier de sortie ; renvoie { id, link }.
export async function copyTemplate(templateId, name) {
  const folderId = process.env.GDRIVE_OUTPUT_FOLDER_ID;
  const data = await gapi(
    `https://www.googleapis.com/drive/v3/files/${templateId}/copy?supportsAllDrives=true&fields=id,webViewLink`,
    { method: 'POST', body: { name, parents: folderId ? [folderId] : undefined } }
  );
  return { id: data.id, link: data.webViewLink };
}

// Remplace tous les champs {clé} / {{clé}} du document (matchCase strict).
export async function replaceTexts(docId, replacements) {
  const requests = Object.entries(replacements).map(([text, value]) => ({
    replaceAllText: {
      containsText: { text, matchCase: true },
      replaceText: String(value ?? ''),
    },
  }));
  if (!requests.length) return;
  await gapi(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
    method: 'POST',
    body: { requests },
  });
}

// Exporte le document en PDF ; renvoie un Buffer.
export async function exportPdf(fileId) {
  const res = await gapi(
    `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application%2Fpdf&supportsAllDrives=true`,
    { raw: true }
  );
  return Buffer.from(await res.arrayBuffer());
}
