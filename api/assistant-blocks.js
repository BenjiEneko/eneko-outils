const NOTION_VERSION = '2022-06-28';

function notionHeaders() {
  return {
    'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
    'Notion-Version': NOTION_VERSION,
  };
}

// Conserve les annotations (gras / italique / code / barré) pour un rendu fidèle.
function richSegments(arr) {
  if (!arr || !arr.length) return [];
  return arr.map(t => ({
    t: t.plain_text,
    b: !!t.annotations?.bold,
    i: !!t.annotations?.italic,
    c: !!t.annotations?.code,
    s: !!t.annotations?.strikethrough,
    href: t.href || null,
  }));
}

function plain(arr) {
  if (!arr || !arr.length) return '';
  return arr.map(t => t.plain_text).join('');
}

async function fetchChildren(blockId) {
  let blocks = [];
  let cursor = undefined;

  do {
    const url = new URL(`https://api.notion.com/v1/blocks/${blockId}/children`);
    url.searchParams.set('page_size', '100');
    if (cursor) url.searchParams.set('start_cursor', cursor);

    const res = await fetch(url.toString(), { headers: notionHeaders(), signal: AbortSignal.timeout(10_000) });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Notion error ${res.status}: ${err}`);
    }

    const data = await res.json();
    blocks = blocks.concat(data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return blocks;
}

async function mapBlock(block) {
  const type = block.type;
  const content = block[type] || {};

  const base = {
    id: block.id,
    type,
    rich: richSegments(content.rich_text || []),
    text: plain(content.rich_text || []),
    language: content.language || '',
    icon: content.icon?.emoji || '',
  };

  // Les tableaux portent leurs lignes dans les blocs enfants (table_row).
  if (type === 'table') {
    const rowBlocks = await fetchChildren(block.id);
    base.hasColumnHeader = !!content.has_column_header;
    base.hasRowHeader = !!content.has_row_header;
    base.rows = rowBlocks
      .filter(rb => rb.type === 'table_row')
      .map(rb => (rb.table_row.cells || []).map(cell => richSegments(cell)));
  }

  return base;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ error: 'Missing id parameter' });
  }

  try {
    const raw = await fetchChildren(id);
    const blocks = await Promise.all(raw.map(mapBlock));
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    return res.status(200).json({ blocks });
  } catch (err) {
    console.error('Notion blocks error:', err);
    return res.status(500).json({ error: 'Contenu momentanément indisponible.' });
  }
}
