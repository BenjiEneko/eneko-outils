// ════════════════════════════════════════════════════════════════
//  /api/jury-preparation-rs6776  —  AIGUILLEUR (V2 vidéo)
//
//  En V2, les questions sont des CLIPS VIDÉO fixes (Benjamin face caméra).
//  Claude ne génère donc plus de texte : il sert d'AIGUILLEUR minimal.
//  Après chaque réponse de l'apprenant·e, il décide UNE chose :
//     • la réponse est-elle suffisante pour avancer ? (satisfait)
//     • sinon, quelle RELANCE générique jouer ? (relanceClip)
//  + une note d'évaluation interne (1 phrase) qui alimentera le bilan.
//
//  C'est le FRONT qui possède la séquence (ordre fixe des 6 questions et
//  déclenchement de la clôture). Claude ne choisit jamais quelle question.
//
//  Outil 100 % anonyme : aucune donnée n'est lue, écrite ni stockée.
// ════════════════════════════════════════════════════════════════

import { callClaude, extractText, safeParseJson } from './_lib/anthropic.js';
import { guardPost, capString } from './_lib/guard.js';

// Liste blanche FERMÉE des relances disponibles (= clips tournés).
// Le serveur n'acceptera jamais un relanceClip hors de cette liste.
const RELANCES = ['preciser', 'exemple', 'developper', 'concret', 'creuser'];

// Cap dur : au-delà, on force l'avancement quoi qu'en dise le modèle.
const RELANCE_CAP = 2;

const SYSTEM_PROMPT = `Tu es l'aiguilleur d'une simulation d'oral pour la certification RS6776 « Création de contenus rédactionnels et visuels par l'usage responsable de l'IA générative ». Un membre de jury (vidéo) a posé une question ; l'apprenant·e vient d'y répondre. Ton seul rôle : décider si la réponse est suffisante pour passer à la suite, ou s'il faut relancer.

Tu n'es PAS sévère : c'est un entraînement bienveillant. Une réponse est "suffisante" dès qu'elle est sur le sujet, structurée et raisonnablement complète — même imparfaite. Tu relances UNIQUEMENT si la réponse est vague, trop courte, hors sujet, ou si elle effleure la question sans la traiter.

Si tu relances, choisis la relance la PLUS adaptée parmi cette banque fermée :
- "preciser"   → la réponse est floue, il faut clarifier ce qui est entendu
- "exemple"    → la réponse est abstraite/théorique, il manque un cas concret
- "developper" → la réponse est juste mais trop brève, il faut approfondir
- "concret"    → la personne décrit un principe sans dire comment elle ferait
- "creuser"    → la réponse mérite d'être justifiée / nuancée davantage

Tu réponds UNIQUEMENT en JSON valide, sans texte avant ni après, sans backticks, selon ce schéma exact :
{
  "satisfait": true,
  "relanceClip": null,
  "note": "Une phrase d'évaluation interne factuelle sur cette réponse (ce qui est maîtrisé / ce qui manque), pour le bilan final."
}

Règles :
- Si "satisfait" est true, "relanceClip" DOIT être null.
- Si "satisfait" est false, "relanceClip" DOIT être l'un de : ${RELANCES.map(r => `"${r}"`).join(', ')}.
- "note" est toujours présente, en français, factuelle et brève.`;

export default async function handler(req, res) {
  if (!guardPost(req, res)) return;

  const { questionTexte, competence, relanceCount = 0, answer, historique = [] } = req.body || {};
  if (!questionTexte || typeof answer !== 'string' || !answer.trim()) {
    return res.status(400).json({ error: 'Question ou réponse manquante.' });
  }

  // Contexte minimal : la question en cours, la réponse, et un rappel des
  // échanges précédents pour que l'éval reste cohérente (chaque champ borné).
  const echanges = Array.isArray(historique) ? historique.slice(0, 20) : [];
  const contexte = echanges.length
    ? echanges.map((h, i) => `Échange ${i + 1}\nJURY : ${capString(h?.q, 2000)}\nRÉPONSE : ${capString(h?.a, 4000)}`).join('\n\n') + '\n\n'
    : '';

  const userMsg =
    `${contexte}QUESTION EN COURS (compétence ${capString(String(competence ?? '?'), 10)}) :\n${capString(questionTexte, 2000)}\n\n` +
    `RÉPONSE DE L'APPRENANT·E :\n${capString(answer.trim(), 6000)}\n\n` +
    `(Relances déjà jouées sur cette question : ${relanceCount}/${RELANCE_CAP})\n\n` +
    `Décide : satisfait pour avancer, ou relance ?`;

  try {
    const data = await callClaude({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMsg }],
      maxTokens: 400,
      temperature: 0.3,
    });
    const raw = extractText(data);

    let decision;
    try {
      decision = safeParseJson(raw);
    } catch {
      // Repli silencieux : en cas de JSON illisible, on avance plutôt que de bloquer.
      return res.status(200).json({ satisfait: true, relanceClip: null, note: '' });
    }

    // ── Garde-fous serveur : on ne fait JAMAIS confiance au modèle pour
    //    la séquence. On force l'avancement si le cap est atteint, et on
    //    valide que le relanceClip appartient bien à la banque tournée.
    let satisfait = decision.satisfait === true;
    let relanceClip = decision.relanceClip;

    if (relanceCount >= RELANCE_CAP) {
      satisfait = true;
      relanceClip = null;
    }
    if (!satisfait) {
      if (!RELANCES.includes(relanceClip)) {
        // relance demandée mais clip invalide → on avance proprement.
        satisfait = true;
        relanceClip = null;
      }
    } else {
      relanceClip = null;
    }

    return res.status(200).json({
      satisfait,
      relanceClip,
      note: typeof decision.note === 'string' ? decision.note : '',
    });

  } catch (err) {
    console.error('jury-preparation-rs6776 handler error:', err);
    return res.status(502).json({ error: 'Le jury est momentanément indisponible, réessayez.' });
  }
}
