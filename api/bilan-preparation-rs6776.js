// ════════════════════════════════════════════════════════════════
//  /api/bilan-preparation-rs6776  —  BILAN (V2 vidéo)
//
//  Dernier appel : analyse toute la transcription de la simulation et
//  renvoie un bilan structuré (JSON), parsé ici de façon défensive.
//  Reprend la logique du bilan V1 ; seule l'entrée change : le front
//  envoie un `transcript` de paires {competence, question, answer, note}
//  (les questions sont des clips vidéo, pas du texte généré).
//
//  Outil anonyme : la transcription n'est ni journalisée ni stockée.
// ════════════════════════════════════════════════════════════════

import { callClaude, extractText, safeParseJson } from './_lib/anthropic.js';
import { guardPost, capString } from './_lib/guard.js';

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

export default async function handler(req, res) {
  if (!(await guardPost(req, res))) return;

  const { transcript } = req.body || {};
  if (!transcript || !Array.isArray(transcript) || transcript.length === 0 || transcript.length > 30) {
    return res.status(400).json({ error: 'Transcription manquante.' });
  }

  // Reconstruit une transcription lisible à partir des paires question/réponse
  // (chaque champ borné). On joint les notes internes de l'aiguilleur.
  const transcription = transcript
    .map(t => {
      const note = t.note ? `\n(éval interne : ${capString(t.note, 500)})` : '';
      return `COMPÉTENCE ${capString(String(t.competence ?? '?'), 10)}\nJURY : ${capString(t.question, 2000)}\nCANDIDAT·E : ${capString(t.answer, 6000)}${note}`;
    })
    .join('\n\n');

  try {
    const data = await callClaude({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Transcription de la simulation :\n\n${transcription}` }],
      maxTokens: 2000,
    });
    const raw = extractText(data);

    try {
      const bilan = safeParseJson(raw);
      return res.status(200).json({ bilan });
    } catch (parseErr) {
      console.warn('bilan-preparation-rs6776 parse échoué:', parseErr.message);
      return res.status(200).json({ parseError: true, raw });
    }

  } catch (err) {
    console.error('bilan-preparation-rs6776 handler error:', err);
    return res.status(502).json({ error: 'Le bilan est momentanément indisponible, réessayez.' });
  }
}
