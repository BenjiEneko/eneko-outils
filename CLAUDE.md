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
  par `/api/dossier-pdf?f=…` qui streame le fichier), **met à jour la fiche CONTACTS du
  CRM** (`api/_lib/dossier-contact.js` : coordonnées confirmées, poste, statut pipeline
  avancé vers « Inscrit » sans jamais rétrograder un Alumni, détail du dossier dans le
  corps de la fiche) et notifie Slack. ⚠️ La base « Candidats » RS6776 sert aux
  évaluations écrites/orales (jury) — le dossier d'inscription ne l'alimente pas.
  Le PDF reproduit fidèlement le dossier InKréa d'origine (logo `_lib/inkrea-logo.js`,
  bandeaux saumon, typographie et pied de page relevés au point près). Énumérations et
  validation : UNE source de vérité, `api/_lib/dossier-rs6776.js` (les pages ne font que
  reproduire les libellés, astérisques compris).
- `cockpit-dossiers/` — Cockpit Dossiers Apprenants (interne, gaté, noindex, hors hub) :
  interface MINCE au-dessus du CRM Notion via `/api/cockpit-dossiers` (actions
  meta/list/detail/update). Lecture en direct de la base DOSSIERS (+ CONTACTS,
  ENTREPRISES, SESSIONS, Candidats RS6776), écritures limitées à **« Étape admin »**
  (axe de progression UNIQUE, 8 valeurs dont « 🚫 Refusé / annulé ») et **« Statut
  paiement »** (axe financier indépendant) — chaque valeur est validée contre le
  **schéma Notion live** avant écriture (Notion crée silencieusement toute option de
  select inconnue !). ⚠️ « Statut dossier » a été supprimé le 2026-09-08 : il doublonnait
  « Étape admin » et se contredisait avec elle. Le code lit « Étape admin » que la
  propriété soit encore un multi-select ou déjà un select, et écrit dans la forme du
  type réel (`meta.etapeType`) : ne jamais présumer l'un ou l'autre. Les règles
  raisonnent en POSITION dans le pipeline (`PIPELINE` + `stageIndex`), pas en
  appartenance. Les options des filtres viennent aussi du schéma : ajouter une
  option dans Notion suffit, pas de déploiement. Alertes (convocation, attestation,
  paiement…) calculées côté page depuis les dates/étapes. **Génération de documents**
  (`/api/cockpit-docs` + `api/_lib/documents-dossiers.js` + `api/_lib/google.js`) :
  fusion de modèles Google Docs (les modèles restent dans Drive, aux mains de Déborah)
  → PDF sur Blob privé (servi via `/api/dossier-pdf?d=docs`) + trace horodatée sur la
  fiche Notion. Un document = une entrée du registre `documents-dossiers.js` (champs
  EXACTS du modèle, matchCase) ; modèles convention CPF / convocation à créer (env
  `GDOC_TPL_*`). Entrée spéciale `kind: 'lien'` : le dossier d'inscription RS6776
  (InKréa) génère depuis la fiche le **lien candidat** pré-rempli (même moteur que la
  page interne : `createCandidateLink()` dans `_lib/dossier-rs6776.js`), désactivé pour
  les dossiers IAA (certification en cours d'obtention). Entrée spéciale `kind: 'pdf'` :
  le **certificat de réalisation** (formulaire ministère du Travail) est rendu NATIVEMENT
  par pdf-lib (`_lib/certificat-realisation.js`, images en base64 dans
  `_lib/certificat-images.js` : logo eneko, bloc-marque ministère, cachet + signature),
  reproduit au point près depuis le certificat de référence du 2026-09-22 — aucun modèle
  Google, aucune config ; la durée est reprise de **« Durée convention (h) »** (DOSSIERS,
  propriété créée le 2026-09-22 : écrite automatiquement quand une convention OPCO/CPF est
  générée depuis le cockpit — `persistDuree` + `parseHeures()` —, modifiable dans la fiche),
  à défaut des heures « Présent » du registre ÉMARGEMENTS ; le reste vient du dossier ;
  mêmes stockage Blob privé et trace Notion que les documents fusionnés. Config Google requise : compte de service (JWT RS256 sans dépendance
  npm, voir `_lib/google.js`) + modèles et dossier de sortie partagés avec son email.
  **Avancement e-learning** (`api/_lib/circle.js`) : l'API Admin de Circle ne LIT pas la
  progression — lecture via l'API Headless (jeton `CIRCLE_HEADLESS_TOKEN` → jeton membre
  par email → `GET /api/headless/v1/courses/{id}/sections`, `progress.status` par leçon).
  Cours IAG 2618650 / IAA 2618652 (override `CIRCLE_COURSE_IAG`/`CIRCLE_COURSE_IAA`),
  sélection par « Type de formation » du dossier. **Préchargement** : le cron
  `/api/cron-elearning` (tous les 2 jours, 04:00 UTC, `maxDuration` 300 s) calcule la
  progression de TOUS les dossiers dans un blob privé `elearning-cache/snapshot.json`
  (`_lib/elearning-snapshot.js`) ; la liste l'affiche dès le chargement (action
  `elearning-snapshot`), puis rafraîchit en direct les dossiers ACTIFS affichés.
  La propriété **« Email »** de CONTACTS peut porter PLUSIEURS adresses (« pro, perso »,
  séparées par virgule) : `emails()`/`emailPrincipal()` dans `_lib/notion-crm.js` — la
  première est l'adresse principale (convocations, relances), toutes servent à retrouver la
  personne (Circle essaie chacune, registre d'émargement et quiz cherchent en « contient »).
  ⚠️ Toujours filtrer `email: { contains }`, jamais `equals`. (« Email e-learning » a été
  supprimé le 2026-09-22, de même que « Date accès e-learning » et « Lien Drive financeur ».)
  **« Plateforme e-learning »** (DOSSIERS) = « Digiforma » pour les parcours suivis sur
  l'ancienne plateforme : aucun appel Circle, la liste et la fiche affichent « Digiforma ».
  **Relances** : UN fichier de règles `api/_lib/relances.js` (kind `email` = message
  pré-rédigé à copier, kind `action` = tâche interne ; rien n'est envoyé automatiquement),
  collecte des signaux dans `_lib/relances-sources.js` (liens InKréa non remplis via
  marqueurs Blob `dossier-liens/<id>.done.json`, sessions sans émargement/éval, Circle
  borné à 15 dossiers). Même moteur pour l'onglet « Relances » du cockpit et le récap
  Slack du lundi (`/api/cron-relances`, cron `vercel.json`, protégé par `CRON_SECRET`).
  « Fait » = marqueur Blob `relances-faites/<dossierId>__<ruleId>.json` (sommeil
  `snoozeDays`) + trace sur la fiche Notion.
  **Écriture complète (2026-09-22)** : la fiche est un formulaire sur 18 propriétés
  (`WRITABLE` typé dans `cockpit-dossiers.js`, `buildProperties()` valide tout) ; assistant
  « Nouveau dossier » (recherche CONTACTS → repli création de contact, 409 si l'email existe
  déjà ; référence normalisée `referenceDossier()` ; doublon refusé si dossier ouvert sur la
  même session) ; relier/retirer un stagiaire, éditer ses coordonnées ; corbeille limitée aux
  coquilles vides et aux créations < 24 h. **Parcours amont** (`_lib/parcours-amont.js`) :
  quiz IAG/IAA + diagnostic rapprochés par email puis nom (aucune relation Notion).
  **Lien Drive** : un seul champ « Lien Drive dossier » (bouton en tête de fiche), renseigné
  le 2026-09-22 depuis l'arborescence de Déborah (`1YYpYo9jCeHOapWzeJg1wEP2hZ4EG-vwm` nominatif,
  `1NtHPHD4…` OPCO). Le bloc « Pièces au Drive » a été retiré à la demande de Benjamin
  (`listerDossierDrive` reste dans `_lib/google.js`, inutilisé).
  **Santé des données** (`_lib/sante-donnees.js`, onglet « Santé ») : contrôles avec fix en
  un clic. Le rapprochement avec le suivi historique de Déborah a été fait UNE fois le
  2026-09-22 (décision Benjamin : ne pas l'intégrer au cockpit) — ne pas le rebrancher.
- `emargement/` + `emargement-interne/` — **outil d'émargement Eneko** (remplace Edusign).
  Rien à re-saisir : les participants sont DÉDUITS du CRM (session Planning → « Dossiers
  apprenants » → « Stagiaire(s) » → CONTACTS, + « Formateur » → FORMATEURS) par
  `buildParticipants()` dans `api/_lib/emargement.js`. La page interne (gatée, noindex,
  hors hub) liste les sessions, ouvre une feuille, envoie les liens (Resend), marque
  présent/absent/excusé à la main et clôture. La page publique est un **écran de
  signature manuscrite** (doigt/souris, canvas DPR-aware, recadrage au bounding box)
  ouvert par un lien nominal unique `#<token>`.
  ⚠️ **Stockage anti-course** : la définition de la feuille (`emargements/<sessionId>.json`)
  est écrite rarement ; **chaque signataire écrit SON propre blob**
  (`emargement-signatures/<sessionId>/<pid>.json|.png`, marques manuelles en `.mark.json`) —
  jamais de relecture-modification-réécriture d'un fichier commun, sinon deux signatures
  simultanées s'écrasent. Les liens courts passent par `emargement-liens/<token>.json`.
  `cloturer()` fige le PDF horodaté (pdf-lib), calcule son **SHA-256** et écrit dans Notion
  (« Émargement OK », « Présents », bloc de trace). Valeur juridique : signature
  électronique **simple** (eIDAS) adossée à un faisceau de preuves (lien nominal unique,
  horodatage serveur, IP, user-agent, empreinte du PDF) — la conformité Qualiopi/OPCO
  reste à valider par le référent.
  **Registre d'assiduité** : base Notion **ÉMARGEMENTS** (`37ae7fb1…`, sous « CRM & Suivi
  Apprenants », une ligne = stagiaire × séance, reliée à CONTACTS et DOSSIERS), module
  `_lib/emargements-registre.js` — `upsertLignes()` idempotent par « ID source », rattachement
  contact (email puis nom) et dossier (session du titre, dates, plus récent). Alimentée par
  l'historique Edusign (action cockpit `emargements-import`, import du 2026-09-22) et par
  chaque `cloturer()` (source « Cockpit »). La fiche cockpit affiche la section « Assiduité ».
  Tout texte entrant dans un PDF passe par `winAnsi()` (`api/_lib/pdf-text.js`) :
  pdf-lib ne sait pas encoder les emoji et les selects Notion en contiennent.
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
Cockpit documents : `GOOGLE_SERVICE_ACCOUNT_KEY` (JSON complet de la clé). Sortie :
le **Drive partagé « Cockpit Eneko »** dont le compte de service est membre, découvert
automatiquement (⚠️ un compte de service n'a aucun quota : jamais de sortie dans un
« Mon Drive » → storageQuotaExceeded) ; `GDRIVE_OUTPUT_FOLDER_ID` optionnelle pour
forcer un dossier précis ;
`GDOC_TPL_CONVENTION_OPCO` (défaut codé) et `GDOC_TPL_ATTESTATION` /
`GDOC_TPL_CONVENTION_CPF` / `GDOC_TPL_CONVOCATION` (sans défaut : document désactivé
tant que le modèle n'existe pas — l'ancien « Modèle Attestation Vierge » BPI/FranceNum
est obsolète, ne pas le rebrancher). E-learning : `CIRCLE_HEADLESS_TOKEN` (jeton « Headless
Auth » créé dans Circle → Paramètres → Développeurs — PAS un jeton Admin V2 ; absent,
la section E-learning du cockpit affiche simplement la marche à suivre). Slack : `SLACK_WEBHOOK_ADMIN` = webhook du canal **#administration** (dossiers d'inscription
reçus + récap des relances) ; `SLACK_WEBHOOK_URL` reste celui des quiz (#dossiers-formation)
et sert de repli. Cron :
`CRON_SECRET` (Vercel l'envoie en `Authorization: Bearer` au cron du lundi ; sans lui,
`/api/cron-relances` refuse tout).
Émargement : `RESEND_API_KEY` (envoi des liens de signature ; sans elle l'envoi est
refusé et les liens restent copiables à la main depuis la page interne),
`SLACK_WEBHOOK_ADMIN` (feuille clôturée) et `BLOB_READ_WRITE_TOKEN`.
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
- Hors quiz, le design system reste dupliqué dans chaque HTML (`:root`) : attention aux
  dérives de palette entre fichiers. **Le cockpit suit eneko.ai** (relevé du 2026-09-23 :
  violet `#7643E5`, minuit `#0B0C2E`, lavande `#EFF0F9`, bordures `#E4E4EF`, Playfair
  Display pour les titres, Outfit pour l'UI, Poppins pour le texte, boutons en pilule,
  cartes 20 px, ombre `0 12px 40px rgba(11,12,46,.16)`) — les autres pages internes
  (émargement, dossier d'inscription) sont encore sur l'ancien thème Fraunces/papier `#FAFAF8`.
  Contraste minimum : `--ink-soft` ≥ `#6E7086` sur fond clair.
- **Le store Vercel Blob est en accès PRIVÉ** : tout `put` doit être `access: 'private'`
  et toute lecture passe par `get()` du SDK ou un endpoint qui streame. L'outil
  `recrutement-formateur-ia` (non utilisé, jamais configuré — décision du 2026-09-06)
  a été écrit pour des blobs publics : à adapter avant toute mise en service.
- Le dossier d'inscription lit/écrit deux bases Notion du CRM (CONTACTS
  `db1c5927…` et Candidats RS6776 `2fad56ab…`, IDs en dur avec override env
  `NOTION_DB_CONTACTS` / `NOTION_DB_CANDIDATS_RS6776`) : l'intégration Notion de
  `NOTION_TOKEN` doit être **connectée à ces deux bases** (••• → Connexions),
  sinon `/api/dossier-admin` renvoie 500 et la fiche Candidats n'est pas créée.
