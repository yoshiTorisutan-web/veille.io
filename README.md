# 📊 Tableau de Veille v4 — Toutes les fonctionnalités

## Fonctionnalités

**Interface**
- ☀/☾ Thème clair / sombre
- ⊞/☰ Vue grille et vue liste
- Panneau de lecture latéral (sans quitter l'app)
- Drag & drop pour réordonner les mots-clés

**Articles**
- Score de pertinence pondéré + barre visuelle
- Filtres avancés : score min, dates, tags, doublons
- Recherche booléenne dans le panneau (AND, NOT, OR)
- Marquage lu / non lu + compteur dans les stats
- Marquage favori avec page dédiée
- Notes personnelles sur chaque article
- Tags personnalisés avec filtre

**Organisation**
- Collections : grouper des articles dans des dossiers
- Tags filtrables sur le dashboard
- Action rapide "Tout marquer lu" par mot-clé

**Données**
- Export CSV filtré
- Détection de doublons sémantiques (badge ≈)
- Trending : détecte quand un mot-clé s'emballe (🔥)

**Analytics**
- Graphique articles/jour (30 jours, Chart.js)
- Donut top sources
- Table stats par mot-clé (articles, pertinence, favoris)
- Tableau de tendances
- Historique des refreshs

**Backend**
- SQLite persistant (articles, tags, notes, collections, log)
- Cron configurable
- Déduplication sémantique (similarité cosinus sur les titres)
- Logging de chaque refresh

## Démarrage

```bash
cd backend
npm install
node server.js
# puis ouvre frontend/index.html
```
