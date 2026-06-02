// ════════════════════════════════════════════════════════════════
//  /api/bilan-rs6776  —  Proxy serverless pour le BILAN (phase 3)
//
//  Un dernier appel analyse toute la transcription de la simulation et
//  renvoie un bilan structuré (JSON). Le parse est fait ici, côté serveur,
//  de façon défensive (strip des backticks, try/catch). En cas d'échec on
//  renvoie le texte brut pour que le front affiche un repli lisible.
//
//  Outil anonyme : la transcription n'est ni journalisée ni stockée.
// ════════════════════════════════════════════════════════════════

const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `Tu es un coach pédagogique Eneko Formation. À partir de la transcription d'une simulation d'oral RS6776 ci-dessous, rédige un bilan de préparation BIENVEILLANT et CONCRET, destiné à rassurer et orienter le·la candidat·e (pas de note chiffrée, pas de jugement définitif).

Réponds UNIQUEMENT en JSON valide, sans texte avant ni après, sans backticks, selon ce schéma :
{
  "points_forts": [{"competence": "1|2|3", "constat": "..."}],
  "lacunes": [{"competence": "1|2|3", "constat": "...", "module_a_revoir": "..."}],
  "conseils": ["...", "...", "..."],
  "message_cloture": "..."
}

Mapping des modules Eneko à citer dans "module_a_revoir" :
- Compétence 1 → "Module 2 — 2.3 Identifier vos opportunités IA, 2.4 Choisir & configurer votre LLM"
- Compétence 2 → "Module 2 — 2.5 ROOCF ; Module 3 — 3.2 à 3.4 ; Module 7 — NotebookLM"
- Compétence 3 → "Module 3 — 3.1 Conformité & Sécurité ; Module 9 — 9.3 Lexique IA générative"

Sois spécifique : appuie chaque point sur ce que la personne a réellement dit dans la simulation. Reste encourageant. Termine "message_cloture" en invitant à retravailler les points faibles en tutorat 1:1.`;

// Parse défensif : retire d'éventuels fences ```json … ``` puis JSON.parse.
function safeParse(raw) {
  let txt = (raw || '').trim();
  // Strip des backticks / fences markdown s'il y en a.
  txt = txt.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  // Au cas où le modèle aurait ajouté du texte autour, on isole le 1er objet {…}.
  const first = txt.indexOf('{');
  const last  = txt.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    txt = txt.slice(first, last + 1);
  }
  return JSON.parse(txt);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages } = req.body || {};
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Transcription manquante.' });
  }

  // Reconstruit une transcription lisible (Jury / Candidat) à partir de
  // l'historique. On ignore l'éventuel premier message d'amorce caché.
  const transcription = messages
    .map(m => `${m.role === 'assistant' ? 'JURY' : 'CANDIDAT·E'} : ${m.content}`)
    .join('\n\n');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      MODEL,
        system:     SYSTEM_PROMPT,
        messages:   [{ role: 'user', content: `Transcription de la simulation :\n\n${transcription}` }],
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Anthropic error ${response.status}:`, errText);
      return res.status(502).json({ error: 'Le bilan est momentanément indisponible, réessayez.' });
    }

    const data = await response.json();
    const raw  = data.content?.[0]?.text || '';

    try {
      const bilan = safeParse(raw);
      return res.status(200).json({ bilan });
    } catch (parseErr) {
      // Repli : on renvoie le texte brut, le front affichera une version lisible.
      console.warn('bilan-rs6776 parse échoué:', parseErr.message);
      return res.status(200).json({ parseError: true, raw });
    }

  } catch (err) {
    console.error('bilan-rs6776 handler error:', err);
    return res.status(502).json({ error: 'Le bilan est momentanément indisponible, réessayez.' });
  }
}
