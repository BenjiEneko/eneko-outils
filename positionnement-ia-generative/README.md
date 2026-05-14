# Quiz de Positionnement IA — Eneko

Quiz interactif pour évaluer le niveau de maîtrise de l'IA générative des apprenants Eneko Formation, avant ou pendant une formation.

## Lancer en local

Double-clic sur `index.html` — aucune dépendance serveur, tout fonctionne en local.  
*(jsPDF est chargé via CDN, une connexion internet est nécessaire pour le premier chargement des polices et la génération PDF.)*

## Fonctionnement

1. **Profil** — collecte prénom, nom, email, entreprise (optionnel)
2. **Objectifs** — sélection de 1 à 3 objectifs parmi 8 (pré-quiz, sans impact sur le score)
3. **14 questions** — une par écran, scoring 0 / 1 / 2 pts chacune
4. **Résultats** — profil, score, correction pédagogique détaillée, export PDF, envoi webhook

### Scoring

| Question | Type | Règle |
|---|---|---|
| Q1 — Fréquence | Choix unique | 0 / 1 / 2 selon l'option |
| Q2 — Outils | Multi-sélection | ≥1 outil avancé → 2 pts · ≥1 outil standard → 1 pt · aucun → 0 pt |
| Q3–Q14 | Choix unique | 0 / 1 / 2 selon l'option |

**Score total max : 28 points**

### Profils de sortie

| Score | Profil |
|---|---|
| ≤ 9 | Explorateur IA 🔍 |
| 10 – 18 | Pratiquant Averti 🧑‍💼 |
| ≥ 19 | Power User / Expert 🚀 |

## Webhook n8n

Le bouton "Envoyer mon résultat" poste en JSON vers :
```
https://placeholder-webhook-eneko.invalid
```
Remplacer cette URL dans `index.html` (variable `WEBHOOK_URL` en tête de script) par l'URL réelle n8n avant mise en production.

**Payload envoyé :**
```json
{
  "submitted_at": "ISO 8601",
  "participant": { "firstName", "lastName", "email", "company" },
  "quiz": {
    "objectives": ["..."],
    "totalScore": 0,
    "maxScore": 28,
    "profile": "Explorateur IA 🔍",
    "answers": [{ "questionId", "theme", "question", "answer", "score" }]
  }
}
```

## Charte graphique

Palette Eneko appliquée :
- **Midnight blue** `#0B0C2E` — fond principal
- **Hokkaido Lavender** `#8037EE` — CTA, highlights, progress bar
- **Bubblegum pink** `#C45AE4` — accents secondaires
- **Foundation White** `#EFF0FA` — cartes de résultat PDF

Typographie : **Outfit** (titres) + **Poppins** (corps) via Google Fonts.

---

## Changelog

### v1.0 — 2026-05-14
- Quiz initial 14 questions + scoring 0/1/2 pts
- Collecte profil apprenant (prénom, nom, email, entreprise)
- Pré-quiz objectifs (multi-select, 3 max, hors score)
- 3 profils de sortie avec textes pédagogiques
- Correction statique dépliable question par question
- Export PDF côté client (jsPDF CDN)
- POST webhook n8n (URL placeholder)
- Design mobile-first, charte Eneko (Outfit + Poppins, palette brand)
- Fichier autonome `index.html` (double-clic)

---

## TODO V2

- [ ] Remplacer `WEBHOOK_URL` par l'URL n8n réelle
- [ ] Déploiement Vercel (drag & drop du dossier)
- [ ] Intégration Notion CRM (création fiche candidat automatique)
- [ ] Ajout du logo SVG Eneko (remplacer le texte `eneko.ai` dans le header)
- [ ] Favicon
- [ ] Tracking analytics (Plausible ou GA4)
- [ ] Mode sombre / clair
