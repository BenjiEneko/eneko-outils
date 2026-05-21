const DIAGNOSTIC_DB_ID = '6c806117b38948f8b6de743f449fccdb';
const NOTION_VERSION   = '2022-06-28';

function notionHeaders() {
  return {
    'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ error: 'Missing email' });
  }

  try {
    const response = await fetch(
      `https://api.notion.com/v1/databases/${DIAGNOSTIC_DB_ID}/query`,
      {
        method: 'POST',
        headers: notionHeaders(),
        body: JSON.stringify({
          filter: {
            property: 'Email',
            email: { equals: email.toLowerCase().trim() },
          },
          page_size: 1,
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      console.error(`Notion query error ${response.status}:`, err);
      // Fail open — ne pas bloquer un utilisateur légitime sur erreur API
      return res.status(200).json({ exists: false });
    }

    const data = await response.json();
    return res.status(200).json({ exists: data.results.length > 0 });

  } catch (err) {
    console.error('check-email error:', err);
    return res.status(200).json({ exists: false }); // fail open
  }
}
