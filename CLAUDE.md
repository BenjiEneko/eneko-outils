# eneko-outils — outils.eneko.ai

Site statique multi-outils d'Eneko Formation (quiz, diagnostics IA, simulateur d'oral,
recrutement) déployé sur Vercel. **Pas de build** : chaque outil est un `index.html`
monolithique (HTML + CSS + JS inline, en français), les fonctions serverless vivent
dans `/api`. Un push sur `main` déploie automatiquement en production.

## Structure

- `index.html` — hub d'accueil (gate par email via `/api/auth` + `/api/verify`)
- `<outil>/index.html` — un dossier par outil, fichier autonome
- `assets/quiz.css` + `assets/quiz-engine.js` — design system et moteur PARTAGÉS des
  deux quiz (`positionnement-ia-*`) : les pages ne contiennent que leurs données
  (QUESTIONS/PROFILES/…) et un objet `window.QUIZ` (endpoint, copy, hooks
  `getProfile`/`gaugePct`/`resultNote`). Tout correctif moteur ou style de quiz se
  fait dans `assets/`, jamais dans les pages.
- `calculateur-chatbot/` — seul outil React : source `app.jsx` compilée en `app.js`
  (esbuild) + `tailwind.css` statique + React auto-hébergé dans `assets/vendor/`.
  **Ne jamais éditer `app.js` directement** : modifier `app.jsx` puis recompiler
  (commandes dans son README, section Build). **La grille tarifaire n'est PAS
  dans la page** : elle vit dans `api/_lib/pricing.js` et n'est servie qu'au
  travers de `/api/calculateur-devis` (fourchette seule pour un prospect,
  détail complet pour une session interne authentifiée).
  **Deux pages, un seul bundle** : `/calculateur-chatbot` (prospect, public) et
  `devis-chatbot-interne/` (interne, gaté, noindex, non listé sur le hub). Chaque
  page déclare `window.ENEKO_MODE`. La page prospect n'envoie jamais les
  identifiants stockés, et la vue interne ne s'affiche que si le serveur a
  confirmé la session (`devis.mode === 'interne'`).
- `api/*.js` — fonctions serverless Vercel (ESM). `submit-quiz*.js` sont en runtime edge.
- `api/_lib/` — **modules partagés, non exposés comme endpoints** (préfixe `_` ignoré par Vercel) :
  - `anthropic.js` — `callClaude()` (timeout 25 s, 1 retry, prompt caching), `extractText`, `extractToolUse`, `safeParseJson`, constante `MODEL`
  - `guard.js` — `guardPost()` (**asynchrone** : `if (!(await guardPost(req, res))) return;`) : méthode + Origin/Referer + rate-limit IP + plafond de taille ; aussi `capMessages`, `capString`, `originAllowed`, `checkRateLimit`
  - `pricing.js` — grille tarifaire du calculateur (**jamais importé par une page**)
  - `token.js` — tokens d'accès signés HMAC avec expiration 30 j (`signToken`/`verifyToken`, fail-closed sans `AUTH_SECRET`)
  - `quiz-submit.js` — implémentation commune de `submit-quiz.js` et `submit-quiz-auto.js` (edge-compatible)

## Règles pour tout nouvel endpoint

1. **Tout proxy IA ou endpoint à effet de bord commence par `await guardPost(req, res)`**
   et borne ses entrées (`capMessages`/`capString`) AVANT d'appeler l'extérieur.
2. Appels Anthropic via `callClaude()` uniquement — jamais de `fetch` brut vers
   `api.anthropic.com`, jamais de nouveau modèle en dur (utiliser `MODEL` de `_lib/anthropic.js`).
3. **Ne jamais renvoyer une erreur upstream brute au client** (les erreurs Notion exposent
   IDs de bases et propriétés) : `console.error` du détail côté serveur, message générique
   en français côté client.
4. Tout `fetch` sortant porte un `signal: AbortSignal.timeout(...)`.
5. Côté front : tout `fetch` critique a un timeout, un état d'erreur avec retry, et jamais
   d'écran de succès sans avoir vérifié `res.ok`.

## Variables d'environnement (Vercel)

`ANTHROPIC_API_KEY`, `NOTION_TOKEN`, `NOTION_DB_ID` (quiz IA gé), `NOTION_DB_ID_AUTO`
(quiz Automatisation), `SLACK_WEBHOOK_URL`, `AUTH_SECRET` + `ALLOWED_EMAILS` (gate),
`RESEND_API_KEY`, `BLOB_READ_WRITE_TOKEN` (recrutement).
Optionnelles : `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` — activent le
rate-limit partagé entre instances ; absentes, le compteur mémoire prend le relais.
⚠️ Plusieurs sont de type **Sensitive** : `vercel env pull` les renvoie **vides** — c'est
normal, ne pas en conclure qu'elles manquent (vérifier avec `vercel env ls`).

## Dev & vérification

- Preview local : `.claude/launch.json` → config `static` (port 4321, mocke
  `/api/assistants` et `/api/assistant-blocks` ; les autres routes API n'existent pas en local).
- Les handlers se testent sans réseau en les important avec des req/res factices
  (voir le pattern : status/json chaînables, headers avec `origin` + `x-forwarded-for`).
- Avant de pousser : `node --check` sur chaque fichier `api/` modifié, et valider les
  scripts inline extraits des HTML modifiés.

## Pièges connus

- `/simulateur-chatbot` est un **rewrite** vers `/calculateur-chatbot` : même page, mais
  le serveur décide de ce qu'il envoie. Un prospect ne reçoit qu'une fourchette et des
  libellés ; ajouter une donnée tarifaire dans `app.jsx` la rendrait publique.
- La V1 de l'oral (`prepa-oral-rs6776`) a été supprimée le 2026-08-28 (redirect 308 vers
  `/preparation-oral-rs6776` dans vercel.json) — ne pas la recréer. Les clips de la V2
  exigent des chemins absolus (`/preparation-oral-rs6776/clips/…`).
- Le « gate » email ne protège que l'affichage du hub — les pages outils restent
  accessibles en URL directe. **Choix assumé** (décision du 2026-08-28) : ne pas
  proposer de le durcir.
- Hors quiz, le design system reste dupliqué dans chaque HTML (`:root`, fonts
  Outfit/Fraunces) : attention aux dérives de palette entre fichiers. Contraste
  minimum : `--ink-soft` ≥ `#767676` sur fond clair.
