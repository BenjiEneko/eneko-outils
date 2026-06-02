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
| Proxy de lecture des médias privés | `api/recrutement-media.js` |
| Sauvegarde Notion + emails recruteurs & candidat (Resend) | `api/recrutement-save.js` |

- **Transcription** : `SpeechRecognition` du navigateur (Chrome recommandé) remplit le texte
  pendant l'enregistrement. L'audio/vidéo reste la pièce maîtresse ; le texte alimente l'IA.
- **Stockage des médias** : les vidéos/audios sont déposés sur **Vercel Blob** (store **privé**
  `blob-eneko`). Le navigateur envoie les fichiers **directement à Vercel Blob** via
  `@vercel/blob@2/client` (SDK **v2**, chargé depuis jsDelivr) en `access: 'private'` — la v2 est
  obligatoire pour les stores « nouveau modèle » privés ; la v1 échoue (PUT incompatible). Ça
  contourne aussi la limite de 4,5 Mo des fonctions serverless.
- **Lecture des médias** : comme le store est privé, les URLs `*.private.blob.vercel-storage.com`
  ne sont pas accessibles directement. La fiche Notion pointe donc vers un **proxy permanent** :
  `/api/recrutement-media?p=<pathname>`, qui récupère le blob côté serveur (token projet) et le
  streame. Liens **permanents et cliquables**, sans exposer publiquement le bucket. Le `pathname`
  porte un suffixe aléatoire (non devinable). Si l'upload échoue, l'entretien et le transcript sont
  quand même sauvegardés (fail-soft).

  > Pré-requis Blob : store **privé** + variable `BLOB_READ_WRITE_TOKEN` sur le projet (obtenue via
  > le bouton **Rotate Credentials** de la page du store, qui pousse le token aux projets connectés).
  > Une colonne « Dossier Drive » existe dans la base pour brancher plus tard une éventuelle
  > automatisation n8n vers Google Drive (non utilisée).

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
- `BLOB_READ_WRITE_TOKEN` — du Blob store privé (via *Rotate Credentials*)
- `CANDIDATURE_DB_ID` — *facultatif* (l'ID est déjà câblé ; ne le définir que pour pointer vers une autre base)
- `RECRUITER_EMAIL` — *facultatif* : liste de destinataires séparés par des virgules. Par défaut
  `benjamin@eneko-formation.fr,deborah@eneko-formation.fr` (câblé). Définir cette variable pour la surcharger.

### 4. Notification des recruteurs
En fin de candidature, un **email récap** (profil, note, reco, points forts/vigilance, synthèse,
liens médias, lien fiche Notion) est envoyé à **benjamin@ et deborah@eneko-formation.fr** via Resend.
Le candidat reçoit en parallèle un email de confirmation. (Pas de Slack.)

## Notes

- Modèle IA : `claude-haiku-4-5` (relance + évaluation). L'évaluation peut être passée à un modèle
  Sonnet pour un jugement plus fin (constante `MODEL` dans `api/recrutement-evaluation.js`).
- L'évaluation IA ne porte que sur le **contenu écrit** (transcript). La voix, le débit et la
  présence caméra se jugent à l'**écoute des enregistrements** (rappelé dans la fiche et l'email).
- Tout est **fail-soft** : un échec Notion / email / upload n'interrompt jamais le candidat.
