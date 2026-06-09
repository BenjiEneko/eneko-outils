/* ─────────────────────────────────────────────────────────────
   api/calculateur-chat.js
   Proxy serverless vers l'API Anthropic pour l'agent de cadrage
   du calculateur de devis chatbot.

   ⚠️ SÉCURITÉ : la clé ANTHROPIC_API_KEY est lue côté serveur
   uniquement (process.env). Elle n'apparaît jamais dans le bundle
   front. Le navigateur ne parle qu'à cette fonction, jamais à
   api.anthropic.com directement.
───────────────────────────────────────────────────────────── */

// Modèle aligné sur les autres outils du repo (éprouvé en prod).
const MODEL = 'claude-haiku-4-5-20251001';

// Prompt système de l'agent de cadrage. Il mène une courte
// conversation puis renvoie une configuration au format JSON que
// le front transforme en devis chiffré.
const SYSTEME = `Tu es l'assistant de cadrage d'Eneko, organisme de formation et studio IA.
Tu mènes une courte conversation pour comprendre le besoin chatbot d'un prospect : à qui s'adresse le bot (clients ou collaborateurs), quelles tâches il doit gérer, quels outils sont déjà en place, le volume d'échanges, et le temps que ça prend manuellement aujourd'hui.

Règles :
- Pose UNE question ouverte à la fois, courte et concrète.
- Maximum 3 questions, puis propose une configuration complète et assumée (tu choisis le moteur, les intégrations, les canaux, les options et le volume les plus pertinents, sans demander validation point par point).
- Reste chaleureux et direct. Tutoiement.
- Ne parle JAMAIS de prix ni de tarif.

Quand tu as assez d'infos, termine ton message par un bloc EXACTEMENT à ce format :
\`\`\`config
{json}
\`\`\`
Le JSON doit suivre ce schéma (n'utilise QUE ces clés) :
{
 "usage": "interne" | "externe",
 "moteur": "script" | "rag" | "rag_script",
 "integrations": [clés parmi: crm, agenda, notif, db, ecommerce, ticketing, paiement, sheets, kb, handoff, api, webhook],
 "canaux": [clés parmi: whatsapp, messenger, telegram, teams, email, mobile],
 "options": [clés parmi: multilingue, design, voix_io, analytics, memoire, abtest, rgpd],
 "volume": "faible" | "moyen" | "eleve" | "tres_eleve",
 "roi": { "convMois": nombre, "minutesParConv": nombre, "tauxAuto": entier de 0 à 100 (pourcentage, ex: 70 pour 70%) },
 "synthese": "résumé du besoin et de la config recommandée en 2 phrases"
}
Avant le bloc config, annonce en une phrase la configuration recommandée et précise qu'elle reste ajustable ensemble en direct. N'inclus le bloc config qu'une seule fois, à la toute fin.`;

// Extrait le bloc ```config … ``` d'un texte et le parse en objet.
function parseConfig(txt) {
  const m = txt.match(/```config\s*([\s\S]*?)```/);
  if (!m) return null;
  try {
    return JSON.parse(m[1].trim());
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages } = req.body || {};
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Au-delà de 3 tours assistant, on force la production de la config
  // pour ne pas laisser la conversation s'éterniser.
  let systemPrompt = SYSTEME;
  const aiTurns = messages.filter((m) => m.role === 'assistant').length;
  if (aiTurns >= 3) {
    systemPrompt +=
      '\n\n⚠️ IMPORTANT : Tu as posé assez de questions. Propose MAINTENANT ' +
      'la configuration recommandée et termine impérativement par le bloc ```config```.';
  }

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
        system: systemPrompt,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        max_tokens: 1024,
        temperature: 0.6,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Anthropic error ${response.status}:`, errText);
      return res
        .status(500)
        .json({ error: 'Agent de cadrage indisponible. Tu peux passer directement au calculateur.' });
    }

    const data = await response.json();
    const raw = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    // On sépare le texte visible (sans le bloc config) de la config parsée.
    const config = parseConfig(raw);
    const message = raw
      .replace(/```config[\s\S]*?```/, '')
      .replace(/\n{3,}/g, '\n\n') // évite les trous laissés par le strip du bloc
      .trim();

    return res.status(200).json({
      message: message || 'J’ai préparé une proposition.',
      config,
    });
  } catch (err) {
    console.error('calculateur-chat handler error:', err);
    return res
      .status(500)
      .json({ error: 'Agent de cadrage indisponible. Tu peux passer directement au calculateur.' });
  }
}
