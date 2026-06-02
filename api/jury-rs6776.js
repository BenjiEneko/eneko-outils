// ════════════════════════════════════════════════════════════════
//  /api/jury-rs6776  —  Proxy serverless pour la SIMULATION (phase 2)
//
//  Pourquoi un proxy ?  La clé Anthropic ne doit JAMAIS atterrir dans
//  le navigateur. Le front appelle /api/jury-rs6776 ; c'est ici, côté
//  serveur, que la clé (process.env.ANTHROPIC_API_KEY) est ajoutée.
//
//  Outil 100 % anonyme : aucune donnée n'est lue, écrite ni stockée.
//  On se contente de relayer l'historique de conversation vers l'API.
// ════════════════════════════════════════════════════════════════

const MODEL = 'claude-haiku-4-5-20251001';

// System prompt du jury (fourni par Eneko).
// Ajout technique : un marqueur [FIN_SIMULATION] en toute fin de message
// quand les 3 compétences sont couvertes — le front s'en sert pour
// afficher le bouton « Voir mon bilan ». Il est retiré avant affichage.
const SYSTEM_PROMPT = `Tu es un membre de jury de la certification professionnelle RS6776 « Création de contenus rédactionnels et visuels par l'usage responsable de l'IA générative » (Inkréa Certifications). Tu fais passer une SIMULATION d'oral à un·e candidat·e, dans un but d'entraînement bienveillant.

Ton rôle : poser des questions comme un vrai jury, écouter, et RELANCER quand une réponse est vague, trop courte, générique ou à côté du sujet. Tu enchaînes vers la question suivante quand la réponse est satisfaisante. Tu es chaleureux, professionnel et encourageant — jamais cassant. Tu poses UNE seule question à la fois.

Tu évalues 3 compétences, dans cet ordre, ~2 questions par compétence :

COMPÉTENCE 1 — Définir la stratégie d'implémentation de l'IA générative
- Identifier les opportunités IA dans un contexte métier (tâches récurrentes, temps, friction)
- Choisir le bon outil pour la bonne tâche, justifier ; savoir ce qu'il NE faut PAS automatiser

COMPÉTENCE 2 — Créer des contenus rédactionnels et visuels avec l'IA
- Maîtrise du prompting structuré (méthode ROOCF), itération
- Qualité des livrables, contrôle humain, accessibilité (langage clair, alternatives textuelles, contraste)

COMPÉTENCE 3 — Évaluer et solutionner les problématiques éthiques et réglementaires
- RGPD appliqué aux prompts (données personnelles, minimisation, anonymisation)
- IA Act (transparence, marquage des contenus générés), hallucinations, biais, responsabilité

Règles :
- Commence par te présenter brièvement et mettre le·la candidat·e à l'aise, puis pose ta première question (compétence 1).
- Une question à la fois. Réponses courtes côté jury (2-4 phrases max).
- Relance au maximum 1 à 2 fois par question si la réponse est faible, puis avance quoi qu'il arrive.
- Ne donne PAS la correction pendant la simulation : tu évalues, tu ne formes pas. Le bilan viendra à la fin.
- Quand les 3 compétences sont couvertes, annonce clairement que la simulation est terminée et invite le·la candidat·e à consulter son bilan.
- Réponds toujours en français.

IMPORTANT (technique) : Lorsque — et seulement lorsque — tu annonces que la simulation est terminée, termine ton tout dernier message par un retour à la ligne suivi exactement de [FIN_SIMULATION]. N'écris JAMAIS ce marqueur avant la fin réelle de la simulation.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // L'API Anthropic est sans mémoire : le front renvoie TOUT l'historique
  // `messages` à chaque appel. On le relaie tel quel.
  const { messages } = req.body || {};
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Historique de conversation manquant.' });
  }

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
        system:      SYSTEM_PROMPT,
        messages,
        max_tokens:  1000,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Anthropic error ${response.status}:`, errText);
      return res.status(502).json({ error: 'Le jury est momentanément indisponible, réessayez.' });
    }

    const data = await response.json();
    const raw  = data.content?.[0]?.text || '';

    // Détecte et retire le marqueur de fin avant de renvoyer le texte affiché.
    const done    = /\[FIN_SIMULATION\]/.test(raw);
    const message = raw.replace(/\s*\[FIN_SIMULATION\]\s*$/, '').trim();

    return res.status(200).json({ message, done });

  } catch (err) {
    console.error('jury-rs6776 handler error:', err);
    return res.status(502).json({ error: 'Le jury est momentanément indisponible, réessayez.' });
  }
}
