# Diagnostic Opportunités IA — Eneko

Page de diagnostic conversationnel IA à l'URL `outils.eneko.ai/diagnostic-opportunite-ia`.

Un agent Claude Haiku conduit un diagnostic en 3 phases (métier, tâches, frictions), puis produit une restitution personnalisée sauvegardée dans Notion et envoyée par email via Resend.

---

## Prérequis

- Comptes actifs : **Anthropic**, **Notion**, **Resend**
- Domaine d'envoi Resend vérifié (ex : `eneko.ai`)
- Accès au projet Vercel `eneko-outils`

---

## 1. Créer la base Notion

Dans la page **"Parcours Apprenants"** de votre workspace Notion :

1. Créer une nouvelle **base de données** (vue Table)
2. Nommer la base : `Diagnostics IA`
3. Ajouter ces propriétés exactement :

| Propriété | Type |
|---|---|
| Nom complet | **Title** (propriété par défaut) |
| Email | Email |
| Date diagnostic | Date |
| Métier | Rich text |
| Opportunités IA | Rich text |
| Outils recommandés | Rich text |
| Quick win | Rich text |
| Restitution complète | Rich text |

4. Récupérer l'**ID de la base** dans l'URL Notion :  
   `notion.so/{workspace}/**{DATABASE_ID}**?v=...`

5. Ajouter l'intégration Notion à cette base :  
   `···` → `Connections` → chercher votre intégration

---

## 2. Variables d'environnement

Copier `.env.local.example` → `.env.local` et remplir :

```
ANTHROPIC_API_KEY=sk-ant-...
NOTION_TOKEN=secret_...
NOTION_DIAGNOSTIC_DB_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=diagnostic@eneko.ai
```

**Sur Vercel** : ajouter ces 5 variables dans Settings → Environment Variables.

> `NOTION_TOKEN` est déjà utilisé par les autres outils du projet. Si la variable est déjà configurée, ne pas la dupliquer.

---

## 3. Test en local

Ce site est purement statique côté HTML. Pour tester les API routes en local, utiliser la CLI Vercel :

```bash
npm i -g vercel
vercel dev
```

Ouvrir `http://localhost:3000/diagnostic-opportunite-ia`

---

## 4. Déploiement

```bash
vercel --prod
```

Les routes `/api/check-email`, `/api/chat`, `/api/save-diagnostic` sont déployées automatiquement par Vercel.

---

## Architecture

```
/diagnostic-opportunite-ia/index.html   ← Page SPA (vanilla JS)
/api/check-email.js                     ← Vérifie doublon email dans Notion
/api/chat.js                            ← Relay Anthropic (Claude Haiku)
/api/save-diagnostic.js                 ← Sauvegarde Notion + email Resend
```

### Flux utilisateur

1. **Formulaire** (prénom, nom, email)
2. `POST /api/check-email` → si email déjà présent, affiche message bloquant
3. Chat conversationnel — 3 phases, max 12 échanges
4. L'agent produit la **restitution** (format markdown structuré)
5. La page détecte la restitution et appelle `POST /api/save-diagnostic`
6. Notion reçoit la fiche + email envoyé via Resend

### Gestion d'erreurs

| Erreur | Comportement |
|---|---|
| `check-email` échoue | Fail open → le chat démarre quand même |
| API Anthropic | Message d'erreur dans le chat |
| Notion save | Log serveur, UX non bloquée |
| Resend email | Log serveur, UX non bloquée |
