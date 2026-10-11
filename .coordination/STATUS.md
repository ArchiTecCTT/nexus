# État des tickets

Responsable unique depuis le 11/10/2026 : Claude (Hermes ne participe plus). Rien n'est commité : le propriétaire commite.
Contrôle global : `npm run check` (lint + typecheck + tests) ; E2E Electron : `npm run e2e --workspace @nexus/desktop`.

| Ticket | État | Preuves | Reste / bloqué par |
|---|---|---|---|
| T-000 | fait (Hermes) | `docs/runbooks/environment.md` | — |
| T-001 | fait | `docs/adr/001-runtime.md` rév. 2, 45 tests + 2 réels | — |
| T-002 | fait (Hermes, repris) | bootstrap Forge/Electron 44/Vite 8 | — |
| T-003 | fait | 8 E2E Playwright : pas de Node dans le renderer, pont gelé, IPC invalide refusé, CSP, navigation/fenêtres/permissions bloquées, persistance après redémarrage | CSP de prod à resserrer (connect-src dev) |
| T-004 | fait | workspaces, `tsconfig.base`, `npm run check`, CI GitHub, ADR-002 | CI non exécutée (pas de push) |
| T-005 | fait | Prisma 7.10 + libSQL, migrateur, journal append-only (triggers), 12 tests dont crash SIGKILL | — |
| T-006 | fait | registre + sondes sûres (PATH absolu, binaire modifiable par tous refusé, --version borné, auth jamais lue) | — |
| T-007 | fait | `@nexus/process-supervisor` (12 tests), connecteurs Claude réel / Codex fixture-only / générique (12 tests + 1 réel) | Codex : format à vérifier quand installé |
| T-008 | fait | `@nexus/connectors-api` OpenAI/Anthropic/Google/OpenRouter, fetch natif, 48 tests (sous-agent, revu) | formats SSE non vérifiés sans clé réelle |
| T-009 | fait | runs, journalisation des événements d'agent, recovery UC-05, reprise native/reconstruite AC-05 | — |
| T-010 | fait | équipes, rôles, gouvernance (bascule journalisée), D-1 appliqué à la configuration | — |
| T-011 | fait | bus question/réponse corrélé, artefacts versionnés et hachés | — |
| T-012 | fait | DAG, ordonnanceur (chemins, parallélisme, réessais, deadlock), 9 tests | — |
| T-013 | fait | moteur de politiques (matrice), approbations (empreinte, expiration, usage unique), plan IA validé + routage explicable, orchestrateur | — |
| T-014 | fait (Linux) | `@nexus/sandbox` bwrap + seccomp BPF + cgroups v2 + proxy egress anti-rebinding, 11 tests réels, ADR-003 | Windows/macOS : aucun backend (sandbox-auto refusé) |
| T-015 | fait | `@nexus/secrets` coffre safeStorage (backend non sûr refusé), broker par usage, test de fuite rouge/vert | — |
| T-016 | fait | `@nexus/git` worktrees, diff, merge approuvé, conflits sans écrasement (AC-03), scanner de secrets, 21 tests (sous-agent, revu) | push : T-018 |
| T-017 | fait | React 19 + Zustand + Monaco + xterm + Mermaid ; 9 pages, tâches manuelles, dictée, push, déploiement ; E2E interface 12/12 + sécurité 8/8 | terminal interactif PTY non fourni (flux en lecture seule) |
| T-018 | fait (fixtures) | `@nexus/github` push approuvé sans force possible, PR via gh, 16 tests ; branché en IPC | essai réel bloqué : `gh` à installer/authentifier |
| T-019 | fait (fixtures) | `@nexus/deploy-vercel` preview/prod à approbations distinctes, jeton par env, 7 tests ; branché en IPC | essai réel bloqué : `vercel` à installer/authentifier |
| T-020 | fait (logique) | `@nexus/voice` consentement, fenêtre micro armée, relecture obligatoire ; permission Electron audio seule | aucun moteur STT installé : dictée réelle indisponible |
| T-021 | fait | `@nexus/usage` provenance reported/estimated/indisponible, budgets, LoopGuard (sous-agent, revu) | persistance à brancher |
| T-022 | fait | `@nexus/diagrams` analyse lecture seule + Mermaid échappé + hypothèses (sous-agent, revu) | rendu image dans l'UI |
| T-023 | fait | matrice AC-01..AC-14 (`docs/testing/matrice-acceptation.md`), modèle de menace M1..M18, revue des packages des sous-agents | revue humaine avant publication |
| T-024 | fait (Linux) | `.deb` + `.zip` construits, smoke test du paquet réel | Windows/macOS : machines réelles requises ; `.rpm` : `rpmbuild` à installer |
| T-025 | fait | `npm run licenses` : 153 paquets, 0 incompatible ; `docs/licences/` ; LICENSE Apache-2.0 **proposée** | choix de licence et titulaire : propriétaire |
| T-026 | fait (docs) | guides d'installation FR/EN, notes de version, README, CONTRIBUTING, SECURITY | publication publique : décision du propriétaire |
| FR-025 | fait | export/import d'archive avec intégrité, secrets exclus, dialogues natifs | — |

## Refonte du 11/10/2026 (décisions du propriétaire : simplicité, 3 modes, interface de niveau IDE)

| Élément | État | Preuves | Reste |
|---|---|---|---|
| Trois modes (Autonome / Autonome en sandbox / Avec validation) | fait | `workspace.test.ts` : autonome dans le projet, validation en worktree, sandbox réelle (réseau direct coupé) | — |
| Espace de travail IDE (projets par glisser-déposer, fichiers, PTY, surveillance, recherche, Git, réglages) | fait | `workspace.test.ts` 22/22 avec PTY réel | — |
| Interface dockview (explorateur, Monaco, terminaux xterm, palette, sessions, contrôle de source…) | fait | E2E interface 18/18 + sécurité 8/8 (sous-agent, revu) | — |
| Backlog P0 n°1 : TUI de l'agent dans un PTY, saisie directe, reprise | fait | test PTY réel + test **dans la sandbox réelle** | — |
| P0 n°2 : état de l'agent par hooks (UserPromptSubmit/PostToolUse → travaille, Notification → attend, Stop → tour fini) | fait | vérifié avec le **vrai Claude** (`working`, `idle`) | autres CLI : pas de hooks, état « démarré / terminé » seulement |
| P0 n°3 : notifications système cliquables (ouvrent la session) | fait | `main.ts` ; n'apparaissent que si la fenêtre n'a pas le focus | — |
| P0 n°5 : PR depuis l'app (`git.createPr`, confirmée par dialogue) | fait | refus explicite sans `gh` testé | essai réel : `gh` à installer et connecter |
| P1 n°6 : quotas Claude (`rate_limit_event` → événement `quota` + instantané persistant) | fait | test du connecteur | flux non interactifs seulement (la TUI n'émet pas de JSON) |
| P1 n°7 : diffusion d'une consigne à 2–6 agents (`sessions.startMany`), copies isolées | fait | test de diffusion | — |
| Refus réseau de la sandbox remontés à l'interface (`sandbox-denied`, « Autoriser ce domaine ») | fait | test sandbox réel (CONNECT refusé 403 + événement) | — |
| P0 n°4 : Codex / Gemini en réel | bloqué | — | CLI à installer et connecter (accord du propriétaire) |
| pnpm (migration depuis npm) | fait | `pnpm run check` 245 tests, E2E 28/28 sur le paquet | — |
| Agents réels via le lanceur Nexus | fait | Claude, Codex (après `/proc` propre au namespace + `approval_policy="never"`), Hermes (`chat -Q -q`), OpenCode (`run`) : fichier créé, hors sandbox ET dans la sandbox | Gemini, Qwen : connexion du propriétaire requise |
| Plan de déploiement (`@nexus/deploy-planner`, panneau Déploiement) | fait (API simulées) | 8 tests (serveurs factices au format des API Vercel/Render/Railway/Atlas, faux ssh) + intégration + E2E | essai réel : comptes et jetons des hébergeurs requis |
| **Orchestre (chef d'orchestre autonome)** | fait (moteur) | plan par le chef, DAG parallèle en copie commune, transmission, revue avec corrections, synthèse, intégration ; 4 tests + **runs réels** : Claude chef + Codex (module + tests), Claude + Codex coopérant via le bus (question de Codex à Claude, réponse, confirmation du chef) | interface en cours ; bus indisponible en sandbox |
| Bus MCP de l'équipe (`team_status`, `send_message`, `read_messages`, `ask_lead`) | fait | test protocole MCP réel ; vérifié en réel avec Claude, Codex, OpenCode | Gemini/Qwen : connexion requise ; Hermes : non branché |
| Déploiement durci (Atlas moindre privilège + CIDR, empreinte SSH vérifiée) | fait | 10 tests deploy-planner | essai réel : comptes requis |
| Messages et journaux dans la langue choisie | fait | test FR→EN | — |
