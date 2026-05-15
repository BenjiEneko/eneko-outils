const NOTION_VERSION = '2022-06-28';

function notionHeaders() {
  return {
    'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
    'Notion-Version': NOTION_VERSION,
  };
}

function richText(arr) {
  if (!arr || !arr.length) return '';
  return arr.map(t => t.plain_text).join('');
}

function mapBlock(block) {
  const type = block.type;
  const content = block[type];
  return {
    id: block.id,
    type,
    text: richText(content?.rich_text || []),
    language: content?.language || '',
    icon: content?.icon?.emoji || '',
  };
}

async function fetchBlocks(pageId) {
  let blocks = [];
  let cursor = undefined;

  do {
    const url = new URL(`https://api.notion.com/v1/blocks/${pageId}/children`);
    url.searchParams.set('page_size', '100');
    if (cursor) url.searchParams.set('start_cursor', cursor);

    const res = await fetch(url.toString(), { headers: notionHeaders() });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Notion error ${res.status}: ${err}`);
    }

    const data = await res.json();
    blocks = blocks.concat(data.results.map(mapBlock));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return blocks;
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
    const blocks = await fetchBlocks(id);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    return res.status(200).json({ blocks });
  } catch (err) {
    console.error('Notion blocks error:', err);
    return res.status(500).json({ error: err.message });
  }
}
