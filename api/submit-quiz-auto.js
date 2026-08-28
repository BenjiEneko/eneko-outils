export const config = { runtime: 'edge' };

import { handleQuizSubmit } from './_lib/quiz-submit.js';

// Quiz de positionnement Automatisation IA — logique partagée dans
// _lib/quiz-submit.js. Nécessite la variable d'env NOTION_DB_ID_AUTO
// (base Notion dédiée) sur Vercel.
export default function handler(req) {
  return handleQuizSubmit(req, {
    dbEnvKey: 'NOTION_DB_ID_AUTO',
    slackHeader: '⚙️ Nouveau résultat — Quiz Automatisation IA',
    formationDefault: 'Automatisation IA',
    profileMap: {
      'Découvrant':            'Découvrant',
      'Praticien Curieux':     'Curieux',
      'Automatiseur Confirmé': 'Expérimenté',
      'Architecte Automation': 'Expert',
    },
  });
}
