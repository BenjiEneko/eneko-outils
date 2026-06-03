// ════════════════════════════════════════════════════════════════
//  /api/recrutement-evaluation  —  Fiche candidat notée par l'IA
//
//  Reçoit le transcript complet de l'entretien et renvoie une fiche
//  STRUCTURÉE. On utilise le "tool use" d'Anthropic : le modèle remplit
//  un schéma → sortie JSON garantie valide par l'API (plus de parsing
//  fragile ni de troncature qui cassait l'éval sur les longs transcripts).
//
//  ⚠️ L'IA ne juge QUE le contenu (texte transcrit). La qualité ORALE
//  réelle (voix, débit, présence caméra) se juge à l'écoute des
//  enregistrements — la fiche le rappelle explicitement.
// ════════════════════════════════════════════════════════════════

const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `Tu es un·e responsable recrutement chez Eneko, organisme de formation à l'IA. Tu évalues la candidature d'un·e FORMATEUR·TRICE / TUTEUR·TRICE IA à partir du transcript d'un court entretien.

LE POSTE : animer des formations IA en visio (IA générative, automatisation), accompagner des apprenants en tutorat individuel (diagnostiquer le vrai problème, débloquer concrètement), faire évoluer les contenus pédagogiques. Profil recherché : vraie expérience du digital AVANT la vague IA (sites, marketing, automatisations n8n/Make/Zapier → "workflows de fond"), maîtrise des outils d'IA générative ET capacité à les rendre simples, forte fibre pédago (plaisir à voir progresser, réflexe de creuser jusqu'à résoudre), aisance à l'oral/visio, fiabilité. Cadre : CDI 4/5e, 100% télétravail, créneaux fixes planifiés ; être en Nouvelle-Aquitaine est un plus (déplacements clients).

Tu évalues À PARTIR DU TEXTE uniquement. Tu ne peux PAS juger la voix, le débit ni la présence caméra : ne te prononce jamais là-dessus. Reste factuel, nuancé, sans complaisance ni sévérité gratuite. Si une réponse manque, baisse la confiance sans inventer.

Rends ton évaluation en appelant l'outil "enregistrer_fiche". Réponds en français.`;

const FICHE_SCHEMA = {
  type: 'object',
  properties: {
    profil: { type: 'string', description: 'Une à deux phrases résumant le candidat et son adéquation au poste.' },
    note_globale: { type: 'integer', description: 'Note globale de 0 à 100.' },
    recommandation: { type: 'string', enum: ['À rencontrer', 'Peut-être', 'À écarter'] },
    competences: {
      type: 'object',
      properties: {
        pedagogie:          { type: 'object', properties: { note: { type: 'integer', description: '0 à 5' }, commentaire: { type: 'string' } }, required: ['note', 'commentaire'] },
        maitrise_ia:        { type: 'object', properties: { note: { type: 'integer', description: '0 à 5' }, commentaire: { type: 'string' } }, required: ['note', 'commentaire'] },
        profondeur_digital: { type: 'object', properties: { note: { type: 'integer', description: '0 à 5' }, commentaire: { type: 'string' } }, required: ['note', 'commentaire'] },
        clarte_propos:      { type: 'object', properties: { note: { type: 'integer', description: '0 à 5 — clarté/structure du discours écrit, PAS la voix' }, commentaire: { type: 'string' } }, required: ['note', 'commentaire'] },
        fit_cadre:          { type: 'object', properties: { note: { type: 'integer', description: '0 à 5 — dispo, télétravail, Nouvelle-Aquitaine' }, commentaire: { type: 'string' } }, required: ['note', 'commentaire'] },
      },
      required: ['pedagogie', 'maitrise_ia', 'profondeur_digital', 'clarte_propos', 'fit_cadre'],
    },
    points_forts:        { type: 'array', items: { type: 'string' }, description: '2 à 3 points forts.' },
    points_vigilance:    { type: 'array', items: { type: 'string' }, description: '2 à 3 points de vigilance.' },
    questions_entretien: { type: 'array', items: { type: 'string' }, description: '2 à 3 questions concrètes à creuser en entretien réel.' },
    nouvelle_aquitaine:  { type: 'string', enum: ['Oui', 'Non', 'Inconnu'] },
    synthese:            { type: 'string', description: '2 à 4 phrases de synthèse pour aider la décision.' },
  },
  required: ['profil', 'note_globale', 'recommandation', 'competences', 'points_forts', 'points_vigilance', 'questions_entretien', 'nouvelle_aquitaine', 'synthese'],
};

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
    `Produis la fiche d'évaluation via l'outil enregistrer_fiche.`;

  async function callAnthropic() {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:       MODEL,
        max_tokens:  3000,
        temperature: 0.3,
        system:      SYSTEM_PROMPT,
        tools:       [{ name: 'enregistrer_fiche', description: "Enregistre la fiche d'évaluation notée du candidat.", input_schema: FICHE_SCHEMA }],
        tool_choice: { type: 'tool', name: 'enregistrer_fiche' },
        messages:    [{ role: 'user', content: userTurn }],
      }),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic ${response.status}: ${errText.slice(0, 300)}`);
    }
    const data = await response.json();
    const toolUse = (data.content || []).find(c => c.type === 'tool_use');
    return toolUse ? toolUse.input : null;
  }

  // Une tentative + un retry (robustesse contre une erreur transitoire).
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const evaluation = await callAnthropic();
      if (evaluation) return res.status(200).json({ evaluation });
    } catch (err) {
      console.error(`recrutement-evaluation attempt ${attempt} failed:`, err.message);
      if (attempt === 2) {
        return res.status(502).json({ error: "L'évaluation est momentanément indisponible." });
      }
    }
  }
  return res.status(502).json({ error: "L'évaluation n'a pas pu être générée." });
}
