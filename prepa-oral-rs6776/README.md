# Prépa Oral RS6776

Agent conversationnel web qui simule la soutenance orale de la certification
**RS6776** — « Création de contenus rédactionnels et visuels par l'usage
responsable de l'IA générative » (Inkréa Certifications).

Un jury IA bienveillant mais exigeant mène une simulation dynamique sur les
**3 compétences** de la certification, puis rend un **bilan qualitatif** à l'écran.

> **Gratuit, anonyme, sans stockage.** Aucune donnée personnelle n'est collectée,
> aucune identité, aucun email, aucune persistance. Tout vit en mémoire le temps
> de la session : fermer l'onglet efface tout.

URL de prod : `outils.eneko.ai/prepa-oral-rs6776`

---

## Architecture

| Élément | Fichier | Rôle |
|---|---|---|
| Frontend | [`index.html`](index.html) | Single-page (HTML/CSS/JS pur). 3 écrans : accueil → chat → bilan. État 100 % en mémoire. |
| Proxy simulation | [`../api/jury-rs6776.js`](../api/jury-rs6776.js) | Relaie la conversation vers l'API Anthropic (phase 2). |
| Proxy bilan | [`../api/bilan-rs6776.js`](../api/bilan-rs6776.js) | Analyse la transcription et renvoie le bilan structuré en JSON (phase 3). |

**Pourquoi un proxy `/api` et pas un `fetch` direct vers `api.anthropic.com` ?**
Sur un site statique, un appel direct depuis le navigateur exposerait la clé API
côté client (lisible par tous). Le proxy serverless garde la clé côté serveur
(`process.env.ANTHROPIC_API_KEY`) — c'est la seule façon de respecter à la fois
« appel à l'API Anthropic » **et** « jamais de clé dans le code ». C'est le même
pattern que les autres outils du repo (`api/chat.js`).

- **Modèle** : `claude-sonnet-4-20250514`
- **`max_tokens`** : `1000`
- **Stateless** : l'API Anthropic n'a pas de mémoire — le front renvoie **tout**
  l'historique `messages` à chaque appel.

---

## Déroulé

1. **Accueil** — rappel rassurant (oral réel de 20 min, jury Inkréa, 3 compétences),
   bouton « Commencer la simulation ».
2. **Simulation** — chat : le jury pose une question à la fois, relance si la
   réponse est faible, couvre les 3 compétences dans l'ordre (~2 questions chacune),
   puis annonce la fin. La détection de fin repose sur un marqueur technique
   `[FIN_SIMULATION]` ajouté par le modèle et retiré avant affichage.
3. **Bilan** — un dernier appel produit : points forts, angles morts (avec modules
   Eneko à revoir), 3 conseils, message de clôture (invitation au tutorat 1:1).
   Boutons « Copier mon bilan » et « Refaire une simulation ».

---

## Lancer en local

Le frontend a besoin que les routes `/api/*` répondent. Le plus simple, comme
pour les autres outils du repo, est d'utiliser le CLI Vercel :

```bash
# À la racine du repo (eneko-outils/)
npm i -g vercel        # si pas déjà installé
vercel dev             # sert le statique + les fonctions /api
```

Puis ouvre `http://localhost:3000/prepa-oral-rs6776`.

### Clé API (variable d'environnement — jamais en dur)

Crée un fichier `.env.local` à la racine du repo (déjà ignoré par git) :

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

Récupère la clé sur [console.anthropic.com](https://console.anthropic.com) →
*API Keys* → *Create Key*. Voir [`.env.local.example`](../.env.local.example).

> ⚠️ Ne mets **jamais** la clé dans `index.html` ni dans le code committé.

---

## Build pour la prod

Aucun build : c'est du statique + des fonctions serverless. Le déploiement se fait
via Vercel (le repo est déjà lié, voir `.vercel/project.json`).

1. Pousse sur la branche déployée → Vercel build automatiquement.
2. Dans les **Project Settings → Environment Variables** de Vercel, renseigne
   `ANTHROPIC_API_KEY` (Production + Preview).
3. L'outil est servi sur `outils.eneko.ai/prepa-oral-rs6776`.

Appel depuis Circle : un simple bouton/lien vers l'URL (pas d'iframe, pas
d'injection JS).
