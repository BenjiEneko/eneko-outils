const MODEL = 'claude-opus-4-7';

const SYSTEM_PROMPT = `Tu es un expert en automatisation et en assistants IA, conseiller pédagogique chez Eneko Formation. Tu aides des professionnels français à identifier les assistants IA les plus utiles à créer pour leur activité.

À partir des 8 réponses du diagnostic ci-dessous, tu vas générer exactement 3 propositions d'assistants IA personnalisés.

CONTRAINTES STRICTES :
- Exactement 3 propositions, pas plus, pas moins
- Chaque proposition contient : un NOM court accrocheur (sous forme "Le X qui Y" ou "Votre assistant Z") et une DESCRIPTION de 2-3 phrases maximum
- La description doit citer un détail CONCRET tiré des réponses du diagnostic (un client type, un outil utilisé, une tâche évoquée)
- Ton chaleureux, direct, en français, jamais condescendant
- Pas de jargon technique IA (pas de "LLM", "embeddings", "RAG", etc.)
- Pas de markdown : seulement du texte brut

FORMAT DE SORTIE (JSON strict) :
{
  "assistants": [
    { "nom": "...", "description": "..." },
    { "nom": "...", "description": "..." },
    { "nom": "...", "description": "..." }
  ]
}

Ne renvoie RIEN d'autre que ce JSON. Pas de texte avant, pas de texte après, pas de balises markdown.`;

function formatDiagnostic(answers) {
  const labels = {
    q1: '1. Métier / activité',
    q2: '2. Contexte professionnel',
    q3: '3. Avec qui interagit-il',
    q4: '4. Projets et tâches récurrentes',
    q5: '5. Tâches les plus chronophages',
    q6: '6. Type d\'output recherché',
    q7: '7. Outils déjà utilisés',
    q8: '8. Sensibilité des données',
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

  const diagnostic = formatDiagnostic(answers);
  const userMessage = `DIAGNOSTIC :\n${diagnostic}`;

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
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Anthropic error ${response.status}:`, errText);
      return res.status(500).json({ error: 'Une erreur est survenue. Réessayez dans un instant.' });
    }

    const data = await response.json();
    const raw = (data.content?.[0]?.text || '').trim();

    let parsed;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch (e) {
      console.error('JSON parse error. Raw output:', raw);
      return res.status(500).json({ error: 'Réponse IA non lisible. Réessayez.' });
    }

    if (!parsed.assistants || !Array.isArray(parsed.assistants) || parsed.assistants.length !== 3) {
      console.error('Invalid structure:', parsed);
      return res.status(500).json({ error: 'Format de réponse inattendu. Réessayez.' });
    }

    return res.status(200).json({ assistants: parsed.assistants });

  } catch (err) {
    console.error('handler error:', err);
    return res.status(500).json({ error: 'Une erreur est survenue. Réessayez dans un instant.' });
  }
}
