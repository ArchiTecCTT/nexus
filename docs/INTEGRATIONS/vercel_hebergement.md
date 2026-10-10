# Vercel Hebergement

> Nexus AI — version documentaire 1.1, 10 octobre 2026. Statut : spécification, pas implémentation.

**Source :** chapitres 14 de `ID/idee.md`. Ce fichier est une extraction documentaire, sans remplacement du maître.

## Chapitre 14 — Vercel, hébergement et architecture visuelle

**MVP Vercel :** détecter `package.json` et framework, vérifier dépôt, construire, ouvrir connexion officielle `vercel login` si nécessaire, `vercel link`, `vercel deploy` preview, récupérer URL et logs, `vercel deploy --prod` après validation séparée ; parser correctement stdout/stderr et codes retour. Préférer commandes officielles et capacités déclarées ; nom de projet/domaine et environnements visibles avant exécution. Politique concernant fichiers `.vercel`, `.env.local` : ne pas remonter dans contexte IA ni committer. Le déploiement est un processus réseau privilégié et passe par un broker distinct.

**Hébergement général :** conseiller choix entre Vercel, VPS, conteneur, hébergement statique selon stack ; ne pas prétendre pouvoir déployer n'importe quel backend via Vercel. **Architecture diagrams :** Mermaid `flowchart`, `sequenceDiagram`, diagrammes de services et README, avec prévisualisation locale et export texte/image ; l'IA documente hypothèses, coûts et limites.
