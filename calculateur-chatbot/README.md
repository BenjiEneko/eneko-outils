# Calculateur de devis chatbot

Outil commercial Eneko en deux usages, dans une seule page :

| Usage | URL | Accès | Contenu |
|-------|-----|-------|---------|
| **Interne** (Benjamin + commercial) | `/calculateur-chatbot` | Gate email (liste `ALLOWED_EMAILS`) | Pricing détaillé, override setup/abonnement, **marge & TJM**, total année 1, gain de temps. |
| **Light / prospect** | `/calculateur-chatbot?client` | Public (pas de gate) | Centré sur le **gain estimé** (ETP, heures), prix indicatif sans marge ni décomposition. |

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
