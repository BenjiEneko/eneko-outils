// ════════════════════════════════════════════════════════════════
//  /api/log-preparation-rs6776  —  Trace ANONYME du bilan vers Notion
//
//  Outil de prépa oral RS6776 : à la fin d'une simulation, le front
//  envoie le bilan + le transcript pour archivage ANONYME dans Notion
//  (identifiant = date & heure ; aucune donnée identifiante).
//  Appel « fire-and-forget » : on renvoie toujours 200, un échec de log
//  ne doit jamais casser l'affichage du bilan côté apprenant.
// ════════════════════════════════════════════════════════════════

const DB_ID = '03792d05f58c44f59e5d59308939be1e';   // « Simulations Oral RS6776 (anonyme) »
const NOTION_VERSION = '2022-06-28';

function notionHeaders() {
  return {
    'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

const richText = (content) => [{ text: { content: (content || '').slice(0, 2000) } }];

function compStatus(bilan, n) {
  const fort = (bilan.points_forts || []).some(p => String(p.competence) === n);
  const gap  = (bilan.lacunes      || []).some(l => String(l.competence) === n);
  if (gap)  return 'À renforcer';
  if (fort) return 'Solide';
  return 'Abordée';
}

const fmtPF       = (a) => (a || []).map(p => `• [C${p.competence}] ${p.constat || ''}`).join('\n');
const fmtLac      = (a) => (a || []).map(l => `• [C${l.competence}] ${l.constat || ''}${l.module_a_revoir ? ` (À revoir : ${l.module_a_revoir})` : ''}`).join('\n');
const fmtConseils = (a) => (a || []).map((c, i) => `${i + 1}. ${c}`).join('\n');
const fmtTranscript = (t) => (t || []).map((x, i) =>
  `Q${i + 1} (Comp. ${x.competence}) : ${x.question}\nRéponse : ${x.answer || '—'}${x.note ? `\n[éval interne : ${x.note}]` : ''}`
).join('\n\n');

// Découpe un long texte en blocs paragraphe (≤ 1900 caractères) pour le corps de page.
function paragraphBlocks(text) {
  const chunks = [];
  let s = text || '';
  while (s.length > 1900) { chunks.push(s.slice(0, 1900)); s = s.slice(1900); }
  chunks.push(s);
  return chunks.map(c => ({
    object: 'block', type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: c } }] },
  }));
}
const heading = (text) => ({
  object: 'block', type: 'heading_3',
  heading_3: { rich_text: [{ type: 'text', text: { content: text } }] },
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { bilan, transcript, horodatageISO, horodatageLabel } = req.body || {};
  if (!bilan || typeof bilan !== 'object') {
    return res.status(400).json({ error: 'Bilan manquant.' });
  }
  if (!process.env.NOTION_TOKEN) {
    // Pas de token configuré → no-op silencieux (ne casse rien).
    return res.status(200).json({ logged: false });
  }

  try {
    const transcriptText = fmtTranscript(transcript);
    const isoNow = new Date().toISOString();

    const body = {
      parent: { database_id: DB_ID },
      properties: {
        'Date & heure':                     { title: [{ text: { content: (horodatageLabel || isoNow).slice(0, 200) } }] },
        'Horodatage':                       { date: { start: horodatageISO || isoNow } },
        'Compétence 1 — Stratégie':         { select: { name: compStatus(bilan, '1') } },
        'Compétence 2 — Création':          { select: { name: compStatus(bilan, '2') } },
        'Compétence 3 — Éthique':           { select: { name: compStatus(bilan, '3') } },
        'Points forts':                     { rich_text: richText(fmtPF(bilan.points_forts)) },
        'Axes à travailler':                { rich_text: richText(fmtLac(bilan.lacunes)) },
        'Conseils':                         { rich_text: richText(fmtConseils(bilan.conseils)) },
        'Mot de clôture':                   { rich_text: richText(bilan.message_cloture || '') },
        'Transcript (questions / réponses)':{ rich_text: richText(transcriptText) },
        'Source':                           { select: { name: 'Simulateur oral RS6776' } },
      },
      // Transcript complet dans le corps de page (pas de troncature à 2000).
      children: [heading('Transcript complet (questions / réponses)'), ...paragraphBlocks(transcriptText)],
    };

    const r = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: notionHeaders(),
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const err = await r.text();
      console.error(`Notion log error ${r.status}:`, err);
      return res.status(200).json({ logged: false });
    }
    return res.status(200).json({ logged: true });

  } catch (err) {
    console.error('log-preparation-rs6776 error:', err);
    return res.status(200).json({ logged: false });
  }
}
