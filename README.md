# Nexus AI

> Un atelier local de développement logiciel, orienté agents de code, pour piloter des équipes d’agents IA de façon observable, persistante et sécurisée.

**Statut : spécification en cours — aucune application n’est encore implémentée.**

Nexus AI vise à réunir dans une application desktop les agents accessibles en CLI (Claude Code, Codex, Gemini CLI, Hermes et futurs connecteurs) et les modèles accessibles par API (OpenAI, Anthropic, Google AI Studio, OpenRouter, serveurs locaux, etc.).

L’objectif est d’aider un développeur indépendant ou une petite équipe à créer des projets, organiser plusieurs agents, leur assigner des missions, suivre leurs actions en temps réel et retrouver durablement les conversations, décisions, tâches et artefacts produits.

## Principes du produit

- **Local-first** : le fonctionnement de base ne requiert pas de serveur central.
- **Travail multi-agents contrôlé** : rôles, équipes, tâches, dépendances et messages inter-agents structurés.
- **Gouvernance configurable** : mode manuel, assisté ou supervisé par une IA choisie par l’utilisateur.
- **Exécution isolée** : worktrees Git, sandbox réelle des processus CLI et permissions appliquées hors de l’interface.
- **Sécurité des secrets** : aucun secret ne doit atteindre le renderer, les sorties sont redirigées et les accès protégés sont filtrés.
- **Traçabilité et persistance** : journal d’événements, décisions et état des tâches conservés localement dans SQLite.
- **Actions sensibles confirmées** : push GitHub, déploiement Vercel de production et autres actions à impact demandent une validation explicite.

## Fonctionnalités prévues

- Création et gestion de projets et d’équipes d’agents.
- Inventaire local des CLI disponibles, sans authentification ou installation intrusive.
- Connecteurs CLI et API pour agents et modèles de code.
- Planification des missions sous forme de DAG et exécution parallèle lorsque les dépendances et chemins le permettent.
- Mémoire de projet versionnée, conversations persistantes, reprise contrôlée après interruption.
- Visualisation du streaming, des tâches, des logs, des diffs et des erreurs.
- Explorateur de fichiers, éditeur Monaco et terminaux intégrés.
- Git, GitHub, worktrees, revue et push avec consentement utilisateur.
- Déploiements Vercel de prévisualisation puis de production avec validations distinctes.
- Dictée vocale avec consentement et validation de la transcription avant envoi.
- Génération de plans d’architecture et de diagrammes Mermaid exportables.

## Architecture cible

```text
Renderer React (UI non fiable)
    ⇅ IPC typé et validé via preload/contextBridge
Electron Main
    ⇅
Orchestrateur local
    ├── Event Store SQLite, snapshots et migrations
    ├── Registry des connecteurs et diagnostic des CLI
    ├── Scheduler de tâches DAG et bus de messages
    ├── Sandbox Broker, Secret Broker et superviseur de processus
    ├── Git/Worktree Broker et GitHub Broker
    ├── Vercel Deploy Broker, mesure d’usage et adaptateur voix
    └── Adaptateurs CLI (PTY/JSONL) et API (HTTPS)
```

Le renderer n’a pas d’accès Node direct. Les entrées IPC sont validées, les clés API restent hors de l’interface, et les processus externes sont lancés par un runner contrôlé.

## Feuille de route

Le développement est organisé en six phases :

1. **Faisabilité et ADR** : inspection de l’environnement, POC de streaming CLI, sandbox et stockage des secrets.
2. **Socle** : Electron Forge, Vite, TypeScript, React, IPC sécurisé, packages de contrats, SQLite et CI.
3. **Agents et mémoire** : connecteurs Claude/Codex, streaming, événements, reprise et messages inter-agents.
4. **Supervision et sécurité** : politiques, budgets, sandbox, secrets, worktrees et audit.
5. **MVP produit** : interface de code, GitHub, Vercel, voix, suivi d’usage et diagrammes.
6. **Release cross-platform** : sandbox Windows/macOS, packaging, tests réels, documentation et release.

La première tâche est [`T-000`](docs/TICKETS/T-000.md) : documenter l’environnement Ubuntu et vérifier les outils disponibles avant de démarrer l’implémentation.

## Documentation

La documentation est la source de vérité du projet à ce stade.

- [Point de départ pour les agents](docs/00_START_HERE.md)
- [Vision et parcours produit](docs/PRODUIT/vision_et_parcours.md)
- [Architecture système](docs/ARCHITECTURE/systeme.md)
- [Contrats et IPC](docs/ARCHITECTURE/contrats.md)
- [Politique de sécurité](docs/SECURITE/politique.md)
- [Décisions et priorités](docs/GOUVERNANCE/decisions_et_priorites.md)
- [Plan de développement](docs/ROADMAP/plan_developpement.md)
- [Tickets de développement](docs/TICKETS/)

## Contribution

Avant toute implémentation, lire [`docs/00_START_HERE.md`](docs/00_START_HERE.md), puis la spécification maîtresse, les décisions de gouvernance, le ticket concerné et les contrats associés.

Une contribution doit indiquer son ticket, les fichiers modifiés, les tests exécutés, l’impact sécurité, les éventuelles évolutions de contrats et une procédure de retour arrière. Aucun secret ne doit être ajouté au dépôt.

## Licence

La licence n’est pas encore ajoutée au dépôt. Apache-2.0 est actuellement la recommandation documentaire, sous réserve de validation finale du propriétaire du projet.
