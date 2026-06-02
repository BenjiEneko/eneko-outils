// ════════════════════════════════════════════════════════════════
//  /api/recrutement-evaluation  —  Fiche candidat notée par l'IA
//
//  Reçoit le transcript complet de l'entretien (questions + réponses)
//  et renvoie une fiche STRUCTURÉE (JSON) : profil, note, compétences,
//  points forts / vigilance, adéquation, synthèse.
//
//  ⚠️ L'IA ne juge QUE le contenu (texte transcrit). La qualité ORALE
//  réelle (voix, débit, présence caméra) se juge à l'écoute des
//  enregistrements — la fiche le rappelle explicitement.
// ════════════════════════════════════════════════════════════════

const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `Tu es un·e responsable recrutement chez Eneko, organisme de formation à l'IA. Tu évalues la candidature d'un·e FORMATEUR·TRICE / TUTEUR·TRICE IA à partir du transcript d'un court entretien.

LE POSTE : animer des formations IA en visio (IA générative, automatisation), accompagner des apprenants en tutorat individuel (diagnostiquer le vrai problème, débloquer concrètement), faire évoluer les contenus pédagogiques. Profil recherché : vraie expérience du digital AVANT la vague IA (sites, marketing, automatisations n8n/Make/Zapier → "workflows de fond"), maîtrise des outils d'IA générative ET capacité à les rendre simples, forte fibre pédago (plaisir à voir progresser, réflexe de creuser jusqu'à résoudre), aisance à l'oral/visio, fiabilité. Cadre : CDI 4/5e, 100% télétravail, créneaux fixes planifiés ; être en Nouvelle-Aquitaine est un plus (déplacements clients).

Tu évalues À PARTIR DU TEXTE uniquement. Tu ne peux PAS juger la voix, le débit ni la présence caméra : ne te prononce jamais là-dessus. Reste factuel, nuancé, sans complaisance ni sévérité gratuite. Si une réponse manque, baisse la confiance sans inventer.

Tu réponds STRICTEMENT par un objet JSON valide (aucun texte avant ou après, pas de bloc markdown), au format EXACT suivant :

{
  "profil": "une phrase qui résume le candidat et son adéquation",
  "note_globale": <entier 0-100>,
  "recommandation": "À rencontrer" | "Peut-être" | "À écarter",
  "competences": {
    "pedagogie":          { "note": <0-5>, "commentaire": "1 phrase" },
    "maitrise_ia":        { "note": <0-5>, "commentaire": "1 phrase" },
    "profondeur_digital": { "note": <0-5>, "commentaire": "1 phrase" },
    "clarte_propos":      { "note": <0-5>, "commentaire": "1 phrase (clarté/structure du discours écrit, PAS la voix)" },
    "fit_cadre":          { "note": <0-5>, "commentaire": "1 phrase (dispo, télétravail, Nouvelle-Aquitaine)" }
  },
  "points_forts": ["...", "...", "..."],
  "points_vigilance": ["...", "...", "..."],
  "questions_entretien": ["3 questions concrètes à creuser en entretien réel"],
  "nouvelle_aquitaine": "Oui" | "Non" | "Inconnu",
  "synthese": "2 à 4 phrases de synthèse pour aider la décision"
}`;

function safeParseJson(raw) {
  // Retire un éventuel fence ```json … ``` et isole le 1er objet { … }.
  let t = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = t.indexOf('{');
  const end   = t.lastIndexOf('}');
  if (start !== -1 && end !== -1) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prenom, nom, transcript } = req.body || {};
  if (!Array.isArray(transcript) || transcript.length === 0) {
    return res.status(400).json({ error: 'Transcript manquant.' });
  }

  const transcriptText = transcript.map((t, i) =>
    `### Question ${i + 1} — ${t.title || ''}\n` +
    `Q : ${t.question || ''}\n` +
    `R : ${(t.answer || '').trim() || '(pas de réponse / réponse uniquement vocale non transcrite)'}` +
    (t.link ? `\nLien fourni : ${t.link}` : '')
  ).join('\n\n');

  const userTurn =
    `CANDIDAT : ${prenom || ''} ${nom || ''}\n\n` +
    `TRANSCRIPT DE L'ENTRETIEN :\n\n${transcriptText}\n\n` +
    `Produis la fiche d'évaluation au format JSON demandé.`;

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
        messages:    [{ role: 'user', content: userTurn }],
        max_tokens:  1500,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Anthropic error ${response.status}:`, errText);
      return res.status(502).json({ error: "L'évaluation est momentanément indisponible." });
    }

    const data = await response.json();
    const raw  = data.content?.[0]?.text || '';

    let evaluation;
    try {
      evaluation = safeParseJson(raw);
    } catch (e) {
      console.error('JSON parse failed:', e.message, '\nRaw:', raw.slice(0, 500));
      return res.status(200).json({ evaluation: null, raw, parseError: true });
    }

    return res.status(200).json({ evaluation, raw });

  } catch (err) {
    console.error('recrutement-evaluation handler error:', err);
    return res.status(502).json({ error: "L'évaluation est momentanément indisponible." });
  }
}
