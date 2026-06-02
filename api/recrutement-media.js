// ════════════════════════════════════════════════════════════════
//  /api/recrutement-media?p=<pathname>  —  Proxy de lecture des médias
//
//  Le store Blob est PRIVÉ : les URLs `*.private.blob.vercel-storage.com`
//  ne sont pas accessibles sans authentification. Ce proxy récupère le
//  blob côté serveur (avec le token du projet) et le streame au
//  navigateur — ce qui donne un lien PERMANENT et cliquable à coller
//  dans Notion, sans exposer publiquement le bucket.
//
//  Le `pathname` contient un suffixe aléatoire (addRandomSuffix) → non
//  devinable. C'est ce qui sert de protection (comme une URL signée).
// ════════════════════════════════════════════════════════════════

import { get } from '@vercel/blob';
import { Readable } from 'node:stream';

export default async function handler(req, res) {
  const pathname = (req.query && req.query.p) ||
    new URL(req.url, 'http://localhost').searchParams.get('p');

  if (!pathname) {
    res.status(400).json({ error: 'Paramètre p (pathname) manquant' });
    return;
  }

  try {
    const result = await get(String(pathname), { access: 'private' });
    if (!result || result.statusCode !== 200 || !result.stream) {
      res.status(404).json({ error: 'Média introuvable' });
      return;
    }

    res.setHeader('Content-Type', result.blob.contentType || 'application/octet-stream');
    if (result.blob.size) res.setHeader('Content-Length', String(result.blob.size));
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=3600');

    Readable.fromWeb(result.stream).pipe(res);
  } catch (err) {
    console.error('recrutement-media proxy error:', err.message);
    res.status(500).json({ error: 'Erreur de lecture du média' });
  }
}
