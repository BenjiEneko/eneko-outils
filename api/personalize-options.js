const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `Tu es un conseiller en assistants IA chez Eneko Formation.

À partir des 4 premières réponses d'un diagnostic professionnel, tu vas proposer des suggestions ULTRA-PERSONNALISÉES pour 3 questions qui suivent. Le but : aider la personne à se reconnaître immédiatement dans les options proposées, plutôt que de lire des suggestions génériques.

Tu vas générer des suggestions pour :
- q5 : "Tâches qui prennent le plus de temps" (6 propositions courtes, ANCRÉES dans le métier de la personne)
- q6 : "Type de production utile en sortie d'un assistant IA" (6 propositions courtes, contextualisées)
- q7 : "Outils probablement utilisés au quotidien" (6 propositions courtes, plausibles pour ce métier)

CONTRAINTES STRICTES :
- Chaque suggestion : 3 à 9 mots maximum, française, ton naturel
- Pas de markdown, pas d'emoji, pas de jargon IA
- Pas de répétition entre les 3 listes
- Les suggestions doivent être SPÉCIFIQUES (ex : "Comptes-rendus de rendez-vous client" plutôt que "Rédaction de contenus")
- Pour q7, propose des outils RÉELS et nommés (ex : "Pipedrive", "Canva", "Trello"), pas des catégories

FORMAT DE SORTIE (JSON strict) :
{
  "q5": ["...", "...", "...", "...", "...", "..."],
  "q6": ["...", "...", "...", "...", "...", "..."],
  "q7": ["...", "...", "...", "...", "...", "..."]
}

Ne renvoie RIEN d'autre que ce JSON. Pas de texte avant, pas de texte après.`;

function formatPartialDiagnostic(answers) {
  const labels = {
    q1: '1. Métier / activité',
    q2: '2. Contexte professionnel',
    q3: '3. Avec qui il/elle interagit',
    q4: '4. Projets et tâches récurrentes',
  };
  return Object.entries(labels)
    .map(([k, label]) => {
      const a = answers[k];
      if (!a) return `${label} : (non renseigné)`;
      const parts = [];
      if (Array.isArray(a.choices) && a.choices.length) parts.push(a.choices.join(', '));
      if (a.text && a.text.trim()) parts.push(a.text.trim());
      return `${label} : ${parts.join(' — ') || '(non renseigné)'}`;
    })
    .join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { answers } = req.body || {};
  if (!answers || typeof answers !== 'object') {
    return res.status(400).json({ error: 'Missing answers' });
  }

  const userMessage = `DÉBUT DU DIAGNOSTIC :\n${formatPartialDiagnostic(answers)}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        max_tokens: 700,
        temperature: 0.5,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Anthropic error ${response.status}:`, errText);
      return res.status(500).json({ error: 'personalize failed' });
    }

    const data = await response.json();
    const raw = (data.content?.[0]?.text || '').trim();

    let parsed;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch (e) {
      console.error('Personalize JSON parse error. Raw:', raw);
      return res.status(500).json({ error: 'parse failed' });
    }

    const out = {};
    ['q5', 'q6', 'q7'].forEach(k => {
      if (Array.isArray(parsed[k])) {
        out[k] = parsed[k]
          .filter(x => typeof x === 'string' && x.trim().length > 0)
          .map(x => x.trim())
          .slice(0, 8);
      }
    });

    return res.status(200).json({ options: out });

  } catch (err) {
    console.error('personalize handler error:', err);
    return res.status(500).json({ error: 'server error' });
  }
}
