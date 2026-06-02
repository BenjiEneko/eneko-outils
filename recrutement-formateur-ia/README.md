# Recrutement — Formateur·trice IA

Outil de qualification des candidatures pour le poste de formateur·trice / tuteur·trice IA
chez Eneko. Mini-entretien mené par un assistant IA : **vidéo de présentation**, réponses
**vocales enregistrées**, **relances IA**, puis génération d'une **fiche candidat notée** et
notification du recruteur.

URL de partage (à diffuser aux candidats uniquement) :
`https://outils.eneko.ai/recrutement-formateur-ia`

> 🔒 La page est en `noindex, nofollow` et **n'est pas listée** sur la landing `/`. Elle se
> partage seulement par lien.

## Parcours

1. **Accueil** — prénom / nom / email + consentement RGPD + activation caméra & micro.
2. **Entretien** — 7 questions socle (identiques pour tous → comparables) :
   1. Présentation **vidéo** 60 s
   2. Parcours digital pré-IA (audio)
   3. Cas pédagogique / tutorat (audio)
   4. Vulgarisation d'un outil IA (audio)
   5. Réalisation concrète + lien optionnel (audio)
   6. Cadre & disponibilité (texte)
   7. Mot de la fin (audio, optionnel)
   L'IA **relance** quand une réponse est vague (1 relance max par question).
3. **Fin** — upload des médias, évaluation IA, sauvegarde Notion + emails.

## Architecture

| Élément | Fichier |
|---|---|
| Front (UI + capture `MediaRecorder` + upload) | `recrutement-formateur-ia/index.html` |
| Moteur de relance IA | `api/recrutement-chat.js` |
| Fiche candidat notée (JSON) | `api/recrutement-evaluation.js` |
| Jeton d'upload Vercel Blob | `api/recrutement-upload-token.js` |
| Sauvegarde Notion + emails (Resend) + notif Slack | `api/recrutement-save.js` |

- **Transcription** : `SpeechRecognition` du navigateur (Chrome recommandé) remplit le texte
  pendant l'enregistrement. L'audio/vidéo reste la pièce maîtresse ; le texte alimente l'IA.
- **Stockage des médias** : les vidéos/audios sont déposés sur **Vercel Blob** (le candidat
  étant anonyme, son navigateur ne peut pas écrire dans un Drive sans login). Le navigateur
  envoie les fichiers **directement à Vercel Blob** via `@vercel/blob/client` (chargé depuis
  `esm.sh`) pour contourner la limite de 4,5 Mo des fonctions serverless. **Chaque fiche Notion
  contient les liens cliquables** (vidéo + audios) dans le corps de page → tu les ouvres /
  télécharges d'un clic. Si l'upload échoue, l'entretien et le transcript sont quand même sauvegardés.

  > Une colonne « Dossier Drive » existe dans la base si tu veux, plus tard, brancher une
  > automatisation n8n qui recopie les fichiers vers un Google Drive. Non utilisée pour l'instant
  > (tu peux la masquer/supprimer en un clic).

## ⚙️ Mise en service (à faire une fois)

### 1. Activer Vercel Blob
Dashboard Vercel → projet `eneko-outils` → **Storage → Create → Blob**. Vercel injecte
automatiquement `BLOB_READ_WRITE_TOKEN` dans les variables d'environnement.

### 2. Connecter l'intégration à la base Notion (déjà créée)
La base **« Candidatures — Formateur·trice IA »** existe déjà sous *Documentation & Process*
(ID `4686ad1f10954f21ac66578209681906`, câblé en dur dans `api/recrutement-save.js`).
Propriétés : `Nom complet` (title), `Email`, `Date`, `Statut`, `Note`, `Recommandation`,
`Dossier Drive`. Le **détail complet** (compétences, points, transcript, liens vidéo/audio) est
écrit dans le **corps de chaque page**.

⚠️ **Seule action requise** : ouvrir la base → menu `•••` → **Connexions** → ajouter
l'**intégration Eneko** (celle qui porte le `NOTION_TOKEN`, déjà utilisée par le diagnostic),
sinon les fonctions serverless ne pourront pas y écrire.

### 3. Variables d'environnement (Vercel)
Déjà présentes (réutilisées) : `ANTHROPIC_API_KEY`, `NOTION_TOKEN`, `RESEND_API_KEY`, `RESEND_FROM`.

À ajouter :
- `BLOB_READ_WRITE_TOKEN` — auto via le Blob store (étape 1)
- `RECRUITER_EMAIL` — destinataire des notifications (défaut : `benjamin@studio-ulk.fr`)
- `SLACK_WEBHOOK_URL` — webhook Slack pour la notif `#administration` (étape 4)
- `CANDIDATURE_DB_ID` — *facultatif* (l'ID est déjà câblé ; ne le définir que pour pointer vers une autre base)

### 4. Notification Slack `#administration`
En fin de candidature, un message récap (nom, note, reco, points forts, liens médias, fiche Notion)
est posté dans **#administration** via un **Incoming Webhook**.
1. Slack → *Apps* → **Incoming Webhooks** → *Add to Slack* → choisir le canal **#administration**.
2. Copier l'URL générée (`https://hooks.slack.com/services/...`) et la mettre dans la variable
   d'env Vercel `SLACK_WEBHOOK_URL`.

> Fail-soft : sans `SLACK_WEBHOOK_URL`, la candidature est quand même sauvegardée (Notion + emails),
> seul le message Slack est ignoré.

## Notes

- Modèle IA : `claude-haiku-4-5` (relance + évaluation). L'évaluation peut être passée à un modèle
  Sonnet pour un jugement plus fin (constante `MODEL` dans `api/recrutement-evaluation.js`).
- L'évaluation IA ne porte que sur le **contenu écrit** (transcript). La voix, le débit et la
  présence caméra se jugent à l'**écoute des enregistrements** (rappelé dans la fiche et l'email).
- Tout est **fail-soft** : un échec Notion / email / upload n'interrompt jamais le candidat.
