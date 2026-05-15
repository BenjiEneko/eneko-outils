const DB_ID = 'd7450bf0-2bb1-40a9-ae29-5e515c59507d';
const NOTION_VERSION = '2022-06-28';

function notionHeaders() {
  return {
    'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

function text(prop) {
  if (!prop) return '';
  if (prop.type === 'title') return prop.title.map(t => t.plain_text).join('');
  if (prop.type === 'rich_text') return prop.rich_text.map(t => t.plain_text).join('');
  return '';
}

function select(prop) {
  if (!prop || !prop.select) return '';
  return prop.select.name || '';
}

function multiSelect(prop) {
  if (!prop || !prop.multi_select) return [];
  return prop.multi_select.map(s => s.name);
}

function mapPage(page) {
  const p = page.properties;
  return {
    id: page.id,
    icon: page.icon?.emoji || page.icon?.external?.url || '',
    nom: text(p['Nom du prompt'] || p['Name'] || p['Nom']),
    cat: select(p['Catégorie'] || p['Categorie']),
    niveau: select(p['Niveau']),
    temps: select(p['Temps gagné estimé'] || p['Temps']),
    livrable: select(p['Type de livrable'] || p['Livrable']),
    statut: select(p['Statut']),
    outils: multiSelect(p['Outils recommandés'] || p['Outils']),
    sousUsage: multiSelect(p['Sous-usage']),
    tags: multiSelect(p['Tags transverses'] || p['Tags']),
    variables: multiSelect(p['Variables clés'] || p['Variables']),
    template: text(p['Template']),
  };
}

async function fetchAllPrompts() {
  let results = [];
  let cursor = undefined;

  do {
    const body = {
      filter: {
        property: 'Statut',
        select: { equals: 'Publié' },
      },
      page_size: 100,
    };
    if (cursor) body.start_cursor = cursor;

    const res = await fetch(
      `https://api.notion.com/v1/databases/${DB_ID}/query`,
      { method: 'POST', headers: notionHeaders(), body: JSON.stringify(body) }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Notion error ${res.status}: ${err}`);
    }

    const data = await res.json();
    results = results.concat(data.results.map(mapPage));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return results;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const prompts = await fetchAllPrompts();
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    return res.status(200).json({ prompts });
  } catch (err) {
    console.error('Notion fetch error:', err);
    return res.status(500).json({ error: err.message });
  }
}
