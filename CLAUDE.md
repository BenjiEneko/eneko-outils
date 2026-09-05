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
- `dossier-inscription/` + `dossier-inscription-interne/` — dossier d'inscription
  certification RS6776 dématérialisé. La page interne (gatée, noindex, non listée sur le
  hub — Déborah utilise l'URL directe) permet de choisir un contact Notion (base CONTACTS)
  et de générer un lien
  candidat court (`#prenom-nom-<aléa>`, expiration 30 j) : le payload pré-rempli vit dans
  Vercel Blob (`dossier-liens/<id>.json`, chemin non devinable), l'identifiant est dans le
  **fragment** `#` de l'URL — jamais dans les logs. Les anciens liens longs (payload signé
  HMAC embarqué) restent acceptés. La page publique ne s'affiche qu'avec un token
  décodable ; à la soumission, `/api/dossier-submit` régénère le **PDF définitif** au
  format InKréa (pdf-lib), le stocke sur Vercel Blob (⚠️ **store en accès privé** :
  toujours `access: 'private'`, lecture via `get()` du SDK ; les liens humains passent
  par `/api/dossier-pdf?f=…` qui streame le fichier), crée/complète la fiche dans la base
  Notion « Candidats » RS6776 et notifie Slack. Énumérations et validation : UNE source
  de vérité, `api/_lib/dossier-rs6776.js` (les pages ne font que reproduire les libellés).
- `cockpit-dossiers/` — Cockpit Dossiers Apprenants (interne, gaté, noindex, hors hub) :
  interface MINCE au-dessus du CRM Notion via `/api/cockpit-dossiers` (actions
  meta/list/detail/update). Lecture en direct de la base DOSSIERS (+ CONTACTS,
  ENTREPRISES, SESSIONS, Candidats RS6776), écritures limitées à « Étape admin »,
  « Statut dossier », « Statut paiement » — chaque valeur est validée contre le
  **schéma Notion live** avant écriture (Notion crée silencieusement toute option de
  select inconnue !). Les options des filtres viennent aussi du schéma : ajouter une
  option dans Notion suffit, pas de déploiement. Alertes (convocation, attestation,
  paiement…) calculées côté page depuis les dates/étapes. **Génération de documents**
  (`/api/cockpit-docs` + `api/_lib/documents-dossiers.js` + `api/_lib/google.js`) :
  fusion de modèles Google Docs (les modèles restent dans Drive, aux mains de Déborah)
  → PDF sur Blob privé (servi via `/api/dossier-pdf?d=docs`) + trace horodatée sur la
  fiche Notion. Un document = une entrée du registre `documents-dossiers.js` (champs
  EXACTS du modèle, matchCase) ; modèles convention CPF / convocation à créer (env
  `GDOC_TPL_*`). Config Google requise : compte de service (JWT RS256 sans dépendance
  npm, voir `_lib/google.js`) + modèles et dossier de sortie partagés avec son email.
  **Avancement e-learning** (`api/_lib/circle.js`) : l'API Admin de Circle ne LIT pas la
  progression — lecture via l'API Headless (jeton `CIRCLE_HEADLESS_TOKEN` → jeton membre
  par email → `GET /api/headless/v1/courses/{id}/sections`, `progress.status` par leçon).
  Cours IAG 2618650 / IAA 2618652 (override `CIRCLE_COURSE_IAG`/`CIRCLE_COURSE_IAA`),
  sélection par « Type de formation » du dossier.
  Phase 3 prévue (relances + digest Slack) : voir la mémoire projet.
- `api/*.js` — fonctions serverless Vercel (ESM). `submit-quiz*.js` sont en runtime edge.
- `api/_lib/` — **modules partagés, non exposés comme endpoints** (préfixe `_` ignoré par Vercel) :
  - `anthropic.js` — `callClaude()` (timeout 25 s, 1 retry, prompt caching), `extractText`, `extractToolUse`, `safeParseJson`, constante `MODEL`
  - `guard.js` — `guardPost()` (**asynchrone** : `if (!(await guardPost(req, res))) return;`) : méthode + Origin/Referer + rate-limit IP + plafond de taille ; aussi `capMessages`, `capString`, `originAllowed`, `checkRateLimit`
  - `pricing.js` — grille tarifaire du calculateur (**jamais importé par une page**)
  - `token.js` — tokens d'accès signés HMAC avec expiration 30 j (`signToken`/`verifyToken`, fail-closed sans `AUTH_SECRET`) ; aussi `signPayloadToken`/`verifyPayloadToken` (tokens de lien à payload JSON, domaine de signature par `purpose`)
  - `dossier-rs6776.js` — spec des champs + validation + génération PDF du dossier d'inscription RS6776 (pdf-lib)
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
Cockpit documents : `GOOGLE_SERVICE_ACCOUNT_KEY` (JSON complet de la clé) +
`GDRIVE_OUTPUT_FOLDER_ID` (dossier Drive de sortie, partagé avec le compte de service) ;
`GDOC_TPL_CONVENTION_OPCO` (défaut codé) et `GDOC_TPL_ATTESTATION` /
`GDOC_TPL_CONVENTION_CPF` / `GDOC_TPL_CONVOCATION` (sans défaut : document désactivé
tant que le modèle n'existe pas — l'ancien « Modèle Attestation Vierge » BPI/FranceNum
est obsolète, ne pas le rebrancher). E-learning : `CIRCLE_HEADLESS_TOKEN` (jeton « Headless
Auth » créé dans Circle → Paramètres → Développeurs — PAS un jeton Admin V2 ; absent,
la section E-learning du cockpit affiche simplement la marche à suivre).
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
- Le dossier d'inscription lit/écrit deux bases Notion du CRM (CONTACTS
  `db1c5927…` et Candidats RS6776 `2fad56ab…`, IDs en dur avec override env
  `NOTION_DB_CONTACTS` / `NOTION_DB_CANDIDATS_RS6776`) : l'intégration Notion de
  `NOTION_TOKEN` doit être **connectée à ces deux bases** (••• → Connexions),
  sinon `/api/dossier-admin` renvoie 500 et la fiche Candidats n'est pas créée.
