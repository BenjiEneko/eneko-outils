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

const MODEL = 'claude-haiku-4-5-20251001';

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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prenom, question, answer, attempt } = req.body || {};
  if (!question || typeof answer !== 'string') {
    return res.status(400).json({ error: 'Requête incomplète.' });
  }

  // Garde-fou : au 2e passage sur une question, on n'autorise plus de relance.
  if (Number(attempt) >= 2) {
    return res.status(200).json({ followUp: null, suggestions: [] });
  }

  const userTurn =
    `QUESTION POSÉE AU CANDIDAT :\n"${question.prompt || question.title || ''}"\n\n` +
    `RÉPONSE DU CANDIDAT :\n"${(answer || '').slice(0, 4000) || '(réponse vide ou uniquement vocale non transcrite)'}"\n\n` +
    `Décide : relance courte (avec SUGG) OU "[NEXT]".`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:       MODEL,
        system:      buildSystemPrompt(prenom || 'le candidat'),
        messages:    [{ role: 'user', content: userTurn }],
        max_tokens:  400,
        temperature: 0.6,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Anthropic error ${response.status}:`, errText);
      // Fail-soft : on n'empêche jamais l'entretien d'avancer.
      return res.status(200).json({ followUp: null, suggestions: [] });
    }

    const data = await response.json();
    const raw  = (data.content?.[0]?.text || '').trim();

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
