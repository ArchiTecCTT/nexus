# Notes de version — Nexus AI 0.1.0 (préversion Linux interne)

**Statut : préversion interne, Linux uniquement, non publiée.** Une publication publique attend les décisions du propriétaire
(licence, marque) et les validations sur Windows et macOS (cahier maître §12 et §20, phase 5).

## Nouveautés majeures

- **Orchestre** : un chef d'orchestre IA découpe un objectif, répartit le travail entre agents de fournisseurs différents
  (Claude, Codex, Gemini, OpenCode, Qwen, Hermes), leur transmet le travail des autres, relit chaque résultat et rédige la
  synthèse. Les agents **se parlent en direct** par le bus MCP « nexus » (vérifié avec Claude, Codex et OpenCode réels).
- Tous les agents vérifiés en réel hors sandbox et dans la sandbox (Claude, Codex, Hermes, OpenCode) ; Gemini et Qwen
  prêts, en attente de connexion.
- Interface façon VS Code, agents dans leur vrai terminal, plan de déploiement, sessions supprimables avec historique,
  raccourcis complets, interface et messages dans la langue choisie, gestionnaire de paquets pnpm.

## Contenu

- Application desktop Electron 44 (React 19 + Zustand) avec frontière de sécurité testée : renderer sans Node, pont IPC minimal
  validé des deux côtés, CSP stricte, navigation, fenêtres et permissions bloquées (8 tests E2E).
- Journal d'événements local en ajout seul (Prisma 7 + libSQL), reprise après crash et après redémarrage, export/import de projet.
- Équipes, rôles, trois gouvernances (manuelle, assistée, supervisée par IA), plans validés et routés de façon explicable, DAG avec
  parallélisme borné, chemins disjoints, réessais et détection de blocage, revue humaine avant acceptation.
- Connecteurs : Claude Code (testé en réel), Codex (fixtures, binaire absent), Gemini/Hermes/OpenCode/Qwen (adaptateur générique),
  API OpenAI/Anthropic/Google/OpenRouter (fixtures, aucune clé réelle utilisée).
- Isolation Linux : bwrap, seccomp, cgroups v2, proxy réseau en liste blanche ; frontière PID namespace pour tous les processus.
- Coffre de secrets adossé au trousseau de l'OS, broker par usage, expurgation des journaux.
- Git : un worktree et une branche par tâche, revue par diff, merge seulement sur approbation, détection de secrets.
- GitHub et Vercel : push, PR et déploiements soumis à approbation liée au plan exact (production toujours distincte).
- Dictée à consentement explicite (aucun moteur installé par défaut), suivi d'usage sans chiffre inventé, diagrammes Mermaid.

## Décisions du propriétaire appliquées

- D-1 : Claude sous abonnement en mode manuel ; jamais de session de connexion montée dans un sandbox.
- D-4 : fichiers `.env*` visibles par défaut, protection activable par projet (divergence assumée avec le cahier maître UC-09).

## Limites connues

- Windows, macOS : aucune isolation ; `sandbox-auto` refusé ; aucun installateur testé.
- `gh`, `vercel`, Codex et les API par clé : intégrations validées sur fixtures seulement.
- `sandbox-auto` : réseau absent et aucun identifiant injecté ; adapté aux exécutions hors ligne (tests, builds).
- Dictée : nécessite l'installation de whisper.cpp ou un consentement explicite au service cloud.
- Terminal : flux de sortie des agents en lecture seule (pas de terminal interactif PTY).
- Licence : Apache-2.0 proposée, non appliquée (décision du propriétaire).
