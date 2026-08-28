import { callClaude, extractText, safeParseJson } from './_lib/anthropic.js';
import { guardPost, capString } from './_lib/guard.js';

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
      if (Array.isArray(a.choices) && a.choices.length) {
        parts.push(a.choices.slice(0, 15).map(c => capString(String(c), 120)).join(', '));
      }
      if (typeof a.text === 'string' && a.text.trim()) parts.push(capString(a.text.trim(), 1500));
      return `${label} : ${parts.join(' — ') || '(non renseigné)'}`;
    })
    .join('\n');
}

export default async function handler(req, res) {
  if (!guardPost(req, res)) return;

  const { answers } = req.body || {};
  if (!answers || typeof answers !== 'object') {
    return res.status(400).json({ error: 'Missing answers' });
  }

  const diagnostic = formatDiagnostic(answers);
  const userMessage = `DIAGNOSTIC :\n${diagnostic}`;

  try {
    const data = await callClaude({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 1024,
      temperature: 0.7,
    });
    const raw = extractText(data).trim();

    let parsed;
    try {
      parsed = safeParseJson(raw);
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
