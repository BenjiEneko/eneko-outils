export const config = { runtime: 'edge' };

/* ── Registre des outils intégrables ──────────────────────────
   Pour ajouter un nouvel outil :
   1. Ajouter une entrée ici avec l'URL complète comme clé
   2. Ajouter le <link rel="alternate" type="application/json+oembed"> dans le <head> de la page
   ─────────────────────────────────────────────────────────── */
const TOOLS = {
  'https://outils.eneko.ai/positionnement-ia-generative': {
    title: 'Positionnement IA Générative',
    height: 900,
  },
};

const BASE_URL = 'https://outils.eneko.ai';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=3600',
  'Content-Type': 'application/json',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const { searchParams } = new URL(req.url);
  const rawUrl = searchParams.get('url');

  if (!rawUrl) {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), {
      status: 400, headers: CORS_HEADERS,
    });
  }

  let toolUrl;
  try {
    toolUrl = new URL(rawUrl);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), {
      status: 400, headers: CORS_HEADERS,
    });
  }

  if (!toolUrl.href.startsWith(BASE_URL + '/')) {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), {
      status: 400, headers: CORS_HEADERS,
    });
  }

  // Normalise : retire le trailing slash et les query params pour la lookup
  const lookupUrl = toolUrl.origin + toolUrl.pathname.replace(/\/$/, '');
  const tool = TOOLS[lookupUrl];

  if (!tool) {
    return new Response(JSON.stringify({ error: 'Tool not found' }), {
      status: 404, headers: CORS_HEADERS,
    });
  }

  const response = {
    version: '1.0',
    type: 'rich',
    provider_name: 'Eneko Outils',
    provider_url: BASE_URL,
    title: tool.title,
    html: `<iframe src="${lookupUrl}" width="100%" height="${tool.height}" frameborder="0" allow="clipboard-write" style="border:0;"></iframe>`,
    width: 800,
    height: tool.height,
  };

  return new Response(JSON.stringify(response), {
    status: 200, headers: CORS_HEADERS,
  });
}
