# eneko-outils — outils.eneko.ai

Site statique multi-outils d'Eneko Formation (quiz, diagnostics IA, simulateur d'oral,
recrutement) déployé sur Vercel. **Pas de build** : chaque outil est un `index.html`
monolithique (HTML + CSS + JS inline, en français), les fonctions serverless vivent
dans `/api`. Un push sur `main` déploie automatiquement en production.

## Structure

- `index.html` — hub d'accueil (gate par email via `/api/auth` + `/api/verify`)
- `<outil>/index.html` — un dossier par outil, fichier autonome
- `api/*.js` — fonctions serverless Vercel (ESM). `submit-quiz*.js` sont en runtime edge.
- `api/_lib/` — **modules partagés, non exposés comme endpoints** (préfixe `_` ignoré par Vercel) :
  - `anthropic.js` — `callClaude()` (timeout 25 s, 1 retry, prompt caching), `extractText`, `extractToolUse`, `safeParseJson`, constante `MODEL`
  - `guard.js` — `guardPost()` (méthode + Origin/Referer + rate-limit IP + plafond de taille), `capMessages`, `capString`, `originAllowed`, `rateLimited`
  - `token.js` — tokens d'accès signés HMAC avec expiration 30 j (`signToken`/`verifyToken`, fail-closed sans `AUTH_SECRET`)
  - `quiz-submit.js` — implémentation commune de `submit-quiz.js` et `submit-quiz-auto.js` (edge-compatible)

## Règles pour tout nouvel endpoint

1. **Tout proxy IA ou endpoint à effet de bord commence par `guardPost(req, res)`** et borne
   ses entrées (`capMessages`/`capString`) AVANT d'appeler l'extérieur.
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

- `/simulateur-chatbot` est un **rewrite** vers `/calculateur-chatbot` (version prospect
  du même fichier) — la grille tarifaire interne est encore lisible dans la source, chantier ouvert.
- `prepa-oral-rs6776` (V1 texte) est déprécié mais encore déployé ; la V2 est
  `preparation-oral-rs6776` (clips vidéo dans `clips/`, chemins absolus obligatoires).
- Les deux quiz `positionnement-ia-*` partagent ~80 % de leur code par copier-coller :
  tout correctif du moteur doit être appliqué **dans les deux fichiers**.
- Le « gate » email ne protège que l'affichage du hub — les pages outils restent
  accessibles en URL directe (assumé pour l'instant).
- Design system dupliqué dans chaque HTML (`:root`, fonts Outfit/Fraunces) : attention
  aux dérives de palette entre fichiers.
