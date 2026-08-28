export const config = { runtime: 'edge' };

import { handleQuizSubmit } from './_lib/quiz-submit.js';

// Quiz de positionnement IA générative — logique partagée dans
// _lib/quiz-submit.js (seuls varient la base Notion, le mapping de
// profils et l'en-tête Slack).
export default function handler(req) {
  return handleQuizSubmit(req, {
    dbEnvKey: 'NOTION_DB_ID',
    slackHeader: '🎯 Nouveau résultat — Quiz IA Eneko',
    profileMap: {
      'Explorateur IA':     'Débutant',
      'Pratiquant Averti':  'Curieux',
      'Utilisateur Avancé': 'Utilisateur Avancé',
      'Expert IA':          'Expert',
    },
  });
}
