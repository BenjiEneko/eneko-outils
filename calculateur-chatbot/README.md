# Calculateur de devis chatbot

Outil commercial Eneko en deux usages, dans une seule page :

| Usage | URL | Accès | Contenu |
|-------|-----|-------|---------|
| **Interne** (Benjamin + commercial) | `/calculateur-chatbot` | Gate email (liste `ALLOWED_EMAILS`) — **non listé sur le hub** | Pricing détaillé, override setup/abonnement, **marge & TJM**, total année 1, gain de temps. |
| **Light / prospect** | `/simulateur-chatbot` | Public (pas de gate) | Centré sur le **gain estimé** (ETP, heures), prix indicatif sans marge ni décomposition. |

> Les deux URLs sont **découplées** : le slug prospect `/simulateur-chatbot` (rewrite Vercel vers le même fichier) ne laisse pas deviner l'URL interne. Le mode prospect se déclenche aussi via `?client` en secours. Pricing de base : **setup à partir de 1 900 €** ; **charte graphique** et **transfert vers agent humain** sont inclus (0 €, pré-cochés).

## Parcours

1. **Cadrage** — un agent IA pose ≤ 3 questions ouvertes puis propose une configuration complète (moteur, intégrations, canaux, options, volume, ROI). On peut aussi sauter directement au configurateur.
2. **Proposition** — la config est éditable à la main ; les montants se recalculent en direct.
3. **Envoi** — bouton en bas de page : formulaire **prénom / nom / email / téléphone** → le récapitulatif part par email à **bonjour@eneko-formation.fr** (avec `reply-to` sur le prospect).

## Architecture

- `index.html` — page autonome (React UMD + Babel + Tailwind CDN configuré à la charte Eneko). Aucune étape de build, comme les autres outils du repo.
- `api/calculateur-chat.js` — proxy serverless vers l'API Anthropic. **La clé `ANTHROPIC_API_KEY` reste côté serveur**, jamais dans le bundle front.
- `api/calculateur-email.js` — envoi du récapitulatif via **Resend** (HTTP).

## Variables d'environnement (déjà sur Vercel)

| Variable | Usage |
|----------|-------|
| `ANTHROPIC_API_KEY` | Appel à l'agent de cadrage (`api/calculateur-chat.js`). |
| `RESEND_API_KEY` | Envoi de l'email (`api/calculateur-email.js`). |
| `RESEND_FROM` | *(optionnel)* expéditeur ; défaut `Eneko Formation <outils@eneko-formation.fr>`. |
| `ALLOWED_EMAILS` | Liste blanche d'emails autorisés à la vue interne (gate). |
| `AUTH_SECRET` | Secret HMAC de signature du token de session. |

## Pricing

Les constantes (`BASE`, `MOTEUR`, `INTEG`, `CANAUX`, `OPTIONS`, `VOLUME`, `TJM_DEFAUT`, `URGENCE_PCT`) sont en haut de `index.html`. Elles reprennent **telles quelles** les valeurs validées dans le prototype — à ajuster là si la grille évolue.

## Build (précompilation)

La page ne charge plus Babel ni Tailwind CDN : le JSX est compilé en `app.js`
et le CSS Tailwind est généré statiquement dans `tailwind.css`. React est
auto-hébergé dans `/assets/vendor/`.

Après toute modification de `app.jsx` :

```bash
# 1. JSX → JS
npx -y esbuild@0.24.2 app.jsx --loader:.jsx=jsx --jsx=transform --target=es2018 --minify --outfile=app.js

# 2. CSS Tailwind (config : thème Eneko, indigo remappé sur #8037EE)
#    Le fichier tailwind.config.js à utiliser est documenté ci-dessous.
npx -y tailwindcss@3.4.17 -c tailwind.config.js -i input.css -o tailwind.css --minify
```

`tailwind.config.js` (content: `app.jsx` + `index.html`) :

```js
module.exports = {
  content: ['./app.jsx', './index.html'],
  theme: { extend: {
    fontFamily: { sans: ['Outfit','sans-serif'], serif: ['Fraunces','serif'] },
    colors: {
      indigo: { 50:'#F5F3FF',100:'#EDE7FE',200:'#D6C7FB',500:'#9B5DF0',600:'#8037EE',700:'#6B21D4' },
      midnight: '#0B0C2E', paper: '#FAFAF8',
    },
  } },
};
```

`input.css` : `@tailwind base; @tailwind components; @tailwind utilities;`

## Grille tarifaire — côté serveur uniquement

Depuis le 28/08/2026, aucun prix n'est embarqué dans la page. Le catalogue, le TJM,
la charge en jours, la formule de marge et la note stratégique interne vivent dans
`api/_lib/pricing.js` et transitent par `/api/calculateur-devis` :

| Appelant | Ce qu'il reçoit |
|---|---|
| Prospect (`/simulateur-chatbot`, ou non connecté) | libellés sans prix, **fourchette** ±12 %, argumentaire ROI |
| Session interne (email + token valides) | catalogue complet, montants exacts, charge, marge, note interne |

Le serveur ignore le TJM et les overrides envoyés par un appelant non authentifié.
**Pour ajuster les prix, éditer `api/_lib/pricing.js`** — pas besoin de recompiler le front.
