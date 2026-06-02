// ════════════════════════════════════════════════════════════════
//  /api/recrutement-upload-token  —  Autorisation d'upload Vercel Blob
//
//  Le navigateur envoie les fichiers audio/vidéo DIRECTEMENT à Vercel
//  Blob (et pas à cette fonction) afin de contourner la limite de
//  4,5 Mo du corps des fonctions serverless — une vidéo de 60 s la
//  dépasse vite. Cette route ne fait que signer un jeton d'upload
//  côté client via `handleUpload`.
//
//  Pré-requis : un Blob store doit exister sur le projet Vercel
//  (Dashboard → Storage → Create → Blob). Vercel injecte alors
//  automatiquement la variable BLOB_READ_WRITE_TOKEN.
// ════════════════════════════════════════════════════════════════

import { handleUpload } from '@vercel/blob/client';

const ALLOWED_CONTENT_TYPES = [
  'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav',
  'video/webm', 'video/mp4', 'video/quicktime',
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const jsonResponse = await handleUpload({
      request: req,
      body: req.body,
      onBeforeGenerateToken: async (pathname) => ({
        allowedContentTypes: ALLOWED_CONTENT_TYPES,
        addRandomSuffix: true,
        maximumSizeInBytes: 60 * 1024 * 1024, // 60 Mo / fichier
        tokenPayload: JSON.stringify({ pathname }),
      }),
      // Rien à faire à la complétion : le front récupère déjà l'URL.
      onUploadCompleted: async () => {},
    });

    return res.status(200).json(jsonResponse);
  } catch (err) {
    console.error('recrutement-upload-token error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}
