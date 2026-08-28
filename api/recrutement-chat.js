// ════════════════════════════════════════════════════════════════
//  /api/recrutement-chat  —  Moteur de RELANCE de l'entretien candidat
//
//  L'entretien est piloté côté front par une liste de questions socle
//  (identiques pour tous → comparables). À chaque réponse, le front
//  appelle cette route : l'IA décide si la réponse mérite UNE relance
//  pour creuser, sinon on passe à la question suivante.
//
//  La clé Anthropic reste côté serveur (jamais dans le navigateur).
//  Aucune donnée n'est stockée ici : on relaie seulement la question
//  courante + la réponse du candidat.
// ════════════════════════════════════════════════════════════════

import { callClaude, extractText } from './_lib/anthropic.js';
import { guardPost, capString } from './_lib/guard.js';

function buildSystemPrompt(prenom) {
  return `Tu es le recruteur·euse virtuel·le d'Eneko, un organisme qui forme des indépendants, salariés de TPE/PME et dirigeants à utiliser concrètement l'IA dans leur métier. Tu fais passer un court entretien à un·e candidat·e (${prenom}) pour un poste de FORMATEUR·TRICE / TUTEUR·TRICE IA (animation de formations en visio, accompagnement individuel, pédagogie).

Ton rôle ICI est limité : on vient de poser UNE question au candidat et il vient d'y répondre. Tu dois décider :
- Soit la réponse est riche, précise et concrète → on passe à la suite (tu réponds EXACTEMENT "[NEXT]").
- Soit la réponse est vague, trop courte, générique ou esquive le sujet → tu poses UNE seule relance courte et bienveillante pour creuser (2 phrases max), qui aide le candidat à donner un exemple concret.

Règles :
- Tutoiement, ton chaleureux, direct, professionnel. Jamais cassant.
- UNE seule relance possible par question. Pas de double question.
- Tu ne donnes JAMAIS ton avis sur la candidature, tu ne notes pas, tu ne corriges pas. Tu relances ou tu passes.
- Si tu relances, n'introduis pas par "merci de ta réponse" pompeux : va droit au but, façon vraie conversation.
- Réponds toujours en français.

Si tu poses une relance, ajoute en TOUTE FIN un retour à la ligne puis une ligne commençant par "SUGG:" avec 3 à 4 débuts de réponse courts et naturels (5-10 mots), séparés par " | " — pour aider le candidat à repartir.

Si tu décides de passer à la suite, réponds UNIQUEMENT "[NEXT]" (rien d'autre, pas de SUGG).`;
}

export default async function handler(req, res) {
  if (!(await guardPost(req, res))) return;

  const { prenom, question, answer, attempt } = req.body || {};
  if (!question || typeof answer !== 'string') {
    return res.status(400).json({ error: 'Requête incomplète.' });
  }

  // Garde-fou : au 2e passage sur une question, on n'autorise plus de relance.
  if (Number(attempt) >= 2) {
    return res.status(200).json({ followUp: null, suggestions: [] });
  }

  const userTurn =
    `QUESTION POSÉE AU CANDIDAT :\n"${capString(question.prompt || question.title || '', 2000)}"\n\n` +
    `RÉPONSE DU CANDIDAT :\n"${(answer || '').slice(0, 4000) || '(réponse vide ou uniquement vocale non transcrite)'}"\n\n` +
    `Décide : relance courte (avec SUGG) OU "[NEXT]".`;

  try {
    const data = await callClaude({
      system: buildSystemPrompt(capString(prenom, 60) || 'le candidat'),
      messages: [{ role: 'user', content: userTurn }],
      maxTokens: 400,
      temperature: 0.6,
    });
    const raw = extractText(data).trim();

    if (/\[NEXT\]/i.test(raw) || raw.length === 0) {
      return res.status(200).json({ followUp: null, suggestions: [] });
    }

    // Parse la ligne SUGG:
    const suggMatch   = raw.match(/\nSUGG:\s*(.+)$/m);
    const suggestions = suggMatch
      ? suggMatch[1].split('|').map(s => s.trim()).filter(Boolean).slice(0, 4)
      : [];
    const followUp = raw.replace(/\nSUGG:\s*.+$/m, '').trim();

    return res.status(200).json({ followUp, suggestions });

  } catch (err) {
    console.error('recrutement-chat handler error:', err);
    return res.status(200).json({ followUp: null, suggestions: [] }); // fail-soft
  }
}
