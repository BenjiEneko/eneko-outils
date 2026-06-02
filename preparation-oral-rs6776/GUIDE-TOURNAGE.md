# 🎬 Script de tournage — Simulateur d'oral RS6776 (V2)

**13 clips à tourner** (6 questions + 5 relances + 1 clôture + 1 boucle d'écoute).
> ℹ️ Plus besoin de clip d'accueil : l'outil démarre directement sur la Question 1.

Le **texte ci-dessous = le sous-titre affiché à l'écran**. Dis-le mot pour mot (ou très proche) pour que vidéo et sous-titre restent alignés. Ton : vouvoiement, chaleureux et posé, comme un vrai jury bienveillant.

## ⚙️ Réglages de tournage (identiques pour TOUS les clips)
- **Format** : portrait 9:16, **1080 × 1920**, H.264 + AAC, `.mp4`
- **Cadrage** : buste, regard caméra, un peu d'air au-dessus de la tête
- **Fond / lumière / tenue / placement** : **strictement identiques** d'un clip à l'autre (les vidéos s'enchaînent → la moindre différence se voit)
- **Marges** : ~0,5 s de silence neutre **au début et à la fin** de chaque clip (pour des coupes propres)
- **Nom de fichier** : respecte EXACTEMENT les noms indiqués → à déposer dans `preparation-oral-rs6776/clips/`

---

## 🟣 COMPÉTENCE 1 — Stratégie d'implémentation

### `q1a.mp4` — Opportunités métier
> « Dans votre métier, où voyez-vous les opportunités les plus concrètes pour l'IA générative ? Donnez-moi un ou deux exemples de tâches que vous gagneriez à lui confier. »

### `q1b.mp4` — Bon outil / ce qu'on n'automatise pas
> « À l'inverse : quelles tâches choisiriez-vous de **ne pas** déléguer à l'IA, et pourquoi ? Et comment décidez-vous quel outil convient à quel besoin ? »

---

## 🟣 COMPÉTENCE 2 — Création de contenus

### `q2a.mp4` — Prompting structuré / itération
> « Quand vous voulez un contenu de qualité, comment construisez-vous votre prompt ? Décrivez-moi votre méthode, étape par étape. »

### `q2b.mp4` — Contrôle humain / accessibilité
> « Une fois que l'IA vous a produit un texte ou un visuel, que faites-vous avant de le considérer comme livrable ? Je pense au contrôle humain et à l'accessibilité. »

---

## 🟣 COMPÉTENCE 3 — Éthique & réglementation

### `q3a.mp4` — RGPD dans les prompts
> « Quand vous rédigez un prompt, comment gérez-vous les données personnelles ? Qu'est-ce que vous vous interdisez d'y mettre ? »

### `q3b.mp4` — IA Act / transparence / hallucinations
> « L'IA Act impose de la transparence sur les contenus générés. Comment appliquez-vous ça concrètement ? Et que faites-vous face au risque d'hallucinations ou de biais ? »

---

## 🔁 RELANCES (clips courts, ~3–6 s)
Jouées quand une réponse est trop vague/courte. Garde-les **génériques** (pas de référence à une question précise) : elles peuvent servir sur n'importe quelle question.

### `relance-preciser.mp4`
> « Pouvez-vous préciser un peu ce que vous entendez par là ? »

### `relance-exemple.mp4`
> « Auriez-vous un exemple concret à me donner ? »

### `relance-developper.mp4`
> « Intéressant — pouvez-vous développer ? »

### `relance-concret.mp4`
> « Et concrètement, comment vous y prendriez-vous ? »

### `relance-creuser.mp4`
> « D'accord. Et si on creuse un peu : qu'est-ce qui vous fait dire ça ? »

---

## 🎬 CLÔTURE

### `cloture.mp4` (~15 s)
> « Eh bien, je vous remercie : la simulation est terminée. Je vais maintenant vous préparer un bilan personnalisé. Ça s'affiche juste en dessous. À très vite. »

---

## 🎥 BOUCLE D'ÉCOUTE (sans parole)

### `ecoute-loop.mp4` (~4–6 s, muette, jouée en boucle)
- **Aucun texte.** Tu écoutes : regard attentif, léger hochement de tête, petit sourire bienveillant.
- Pense à un début et une fin qui se raccordent (la boucle tourne en continu pendant que l'apprenant répond).
- Conseil : reste assez neutre/statique pour que la boucle ne « saute » pas trop visiblement.

---

## ✅ Récap des 13 fichiers à livrer dans `/clips`
```
q1a.mp4   q1b.mp4   q2a.mp4   q2b.mp4   q3a.mp4   q3b.mp4
relance-preciser.mp4   relance-exemple.mp4   relance-developper.mp4
relance-concret.mp4    relance-creuser.mp4
cloture.mp4
ecoute-loop.mp4
```
Une fois tous les clips déposés, on passe `DEV_PLACEHOLDER = null` dans `index.html` et c'est en ligne pour de bon.
