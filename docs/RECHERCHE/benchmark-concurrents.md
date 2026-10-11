# Benchmark concurrentiel — Nexus AI

> Version 1.0 — 11 octobre 2026. Analyse fondée sur des sources publiques (API GitHub, README, arborescences, pages web)
> et sur la lecture d'une copie locale du code d'Emdash. Aucun code ni texte des concurrents n'est repris dans Nexus :
> on analyse des comportements et on s'inspire d'idées.

## 0. Méthode et légende

**Niveaux de preuve** utilisés dans tout le document :

- **[DOC]** : documenté par le concurrent (README, site, docs officielles).
- **[CODE]** : vérifié dans le code source (fichier cité).
- **[ISSUE]** : constaté dans le suivi de tickets public.
- **[SUPPOSÉ]** : déduction raisonnable, non vérifiée.
- **[NON VÉRIFIABLE]** : source fermée ou inaccessible.

**Sources collectées le 11/10/2026** via `api.github.com/repos/<owner>/<repo>` (métadonnées, `/releases`,
`/issues`, `/contributors`, `/git/trees/main?recursive=1`), `raw.githubusercontent.com` (README et fichiers précis),
`https://pivio.app/` et `https://emdash.sh/docs/*` (curl). Les chiffres (étoiles, versions) sont des instantanés.

**Remarque importante sur la copie locale d'Emdash** (`/home/dayif/Desktop/projects/nexus-ai/`) : elle correspond au
commit `760b60caa` (fusion de la PR #3314, v1.2.8, 10/10/2026), mais la marque y a été remplacée par « Nexus AI »
(`CONTEXT.md`, paquets `@nexus/*`, `package.json` « nexus-monorepo »), alors que `LICENSE.md` reste
« Copyright 2026 General Action, Inc. » (Apache-2.0). **Ce dossier n'est pas Nexus AI** : c'est Emdash renommé. Risque à
signaler au propriétaire : confusion de marque et obligation Apache-2.0 de conserver avis de copyright/NOTICE si ce code
était redistribué. Conformément à `.coordination/DECISIONS.md` (« s'inspirer d'Emdash sans copier son code »), il ne sert
ici que de matériau d'analyse.

---

## 1. Fiches concurrents

### 1.1 Hydra — https://github.com/jpdlr/hydra

**Positionnement.** « Orchestrer Claude Code et OpenAI Codex en parallèle depuis une app desktop » [DOC README].
Public : développeur individuel qui jongle avec plusieurs sessions Claude/Codex.

| Critère | Constat | Source |
|---|---|---|
| Licence | MIT | API repo (`license.spdx_id`) |
| Plateformes | macOS Apple Silicon (DMG non signé), Windows x64, Linux x64 (AppImage, `.deb`) ; Homebrew tap, workflows AUR/winget | README ; assets release v0.2.52 ; `.github/workflows/update-aur.yml` [CODE] |
| Pile | Electron 33, React 18, node-pty + xterm.js, SDK MCP, Zod | README « Tech Stack » |
| Maturité | 8 étoiles, 2 forks, 1 contributeur ; dernière release publiée v0.2.52 (24/04/2026) alors que `package.json` est en 0.2.61 ; dernier push 11/05/2026 (**5 mois sans activité**) | API repo, `/releases`, `/commits`, `package.json` |
| Modèle économique | Gratuit, open source, pas d'offre commerciale identifiée | README |

**Fonctionnalités réelles.**

- Agents : Claude Code et Codex uniquement [DOC].
- Jusqu'à 10 agents simultanés (limite dure), chacun dans un PTY ; regroupement par projet ; YOLO global/par agent [DOC].
- Vue Chat (un agent) et vue Grille (tuiles, **diffusion d'un même prompt à tous les agents**), bascule `Ctrl+\` [DOC].
- Import et reprise des sessions Claude depuis `~/.claude/projects`, filtres d'âge/recherche [DOC].
- **Agent manager MCP** : serveur MCP HTTP/SSE exposant `hydra_list_agents`, `hydra_create_agent`, `hydra_send_prompt`,
  `hydra_get_output`, `hydra_broadcast`, `hydra_kill_agent`, `hydra_restart_agent` [DOC] ; `electron/mcp/McpServer.ts` [CODE].
- Exécutions headless en file, journaux JSONL, annulation [DOC] ; `electron/headless/HeadlessOrchestrator.ts` [CODE].
- Tableau d'usage (tokens/coûts **déduits de la sortie CLI**), budgets journaliers souples, alertes de seuil [DOC].
- Télécommande mobile : PWA appairée par QR code, **relais Firebase** [DOC] ; `electron/remote/firebaseConfig.ts` [CODE].
- Git : statut, log, diff, commit, push, branches, **revue de PR (`fetchPr`, `getPrFileDiff`)**, création/suppression de
  worktree dans `.worktrees/` [CODE `electron/git/GitService.ts`]. L'exposition UI des worktrees n'est pas documentée [SUPPOSÉ partielle].
- Observabilité : logs JSONL rotatifs, export de diagnostic, rapport d'erreurs distant optionnel [DOC].

**Points forts.** Concept de « manager » orchestrant d'autres agents via MCP (simple et puissant) ; diffusion de prompt
en grille ; budgets d'usage ; distribution Linux réelle (AppImage/deb) ; documentation de configuration claire.

**Points faibles.**

- Projet **dormant** depuis mai 2026, contributeur unique, seulement 2 fournisseurs.
- Sur Linux, l'application se lance **automatiquement avec `--no-sandbox`** (désactive le sandbox Chromium) pour
  contourner `chrome-sandbox` [DOC README §Linux] — choix de sécurité discutable.
- Télécommande dépendante d'un projet Firebase (données qui transitent par un tiers) [DOC].
- Usage estimé par analyse de la sortie texte (fragile) [DOC] ; macOS non signé.
- Aucun isolement OS des agents, pas d'intégration de tickets (Linear/Jira), pas de PR créée depuis l'app documentée.
- Une seule issue publique, fermée : incompatibilité CachyOS [ISSUE #1].

---

### 1.2 Runner — https://github.com/yicheng47/runner

**Positionnement.** « Là où les agents terminal travaillent ensemble » : une tâche, plusieurs rôles, un fil partagé, un
chef qui sollicite l'humain [DOC README]. Opiniâtre sur le flux de travail, neutre sur le fournisseur.

| Critère | Constat | Source |
|---|---|---|
| Licence | MIT (versions du 22/08 au 22/09/2026 publiées sous GPL-3.0-only) | README §License |
| Plateformes | macOS Apple Silicon (signé, notarisé) et Windows x64 (signé). **Pas de Linux**, pas d'Intel Mac | README §Download ; assets v0.15.1 |
| Linux | Prévu en 0.16 (x86_64, `.tar.gz` + `.deb`/`.rpm`, pas d'AppImage/Flatpak, pas d'updater) | ISSUE #823 ; `docs/impls/briefs/823-linux.md` [CODE] |
| Pile | Rust, GPUI (Zed), `alacritty_terminal`, SQLite ; pas de webview ; démon `runnerd` | README §About |
| Maturité | 275 étoiles, 17 forks, 3 contributeurs, v0.15.1 (11/10/2026), statut « alpha », publication quasi quotidienne | API repo, `/releases` |
| Modèle économique | Gratuit, open source, mainteneur solo « side project » | commentaire du mainteneur, ISSUE #823 |

**Fonctionnalités réelles.**

- Agents : Codex, Claude Code, Antigravity CLI (Google), pi, GitHub Copilot CLI, Cursor (désactivé par défaut) — tableau
  de compatibilité détaillé par capacité [DOC].
- **Rôle / Équipe (crew) / Mission** : rôles réutilisables (runtime, prompt système, cwd), équipe avec un chef et des
  conventions, mission = un terminal par slot + **fil d'événements persistant et rejouable**, `ask_human` [DOC].
- Équipe par défaut « pair-coding » codeur/relecteur en boucle sur le diff ; exemples d'équipes (dev, docs, jeux) [DOC].
- **Vrais terminaux** : chaque agent garde sa TUI dans un PTY GPU ; IME ; tiroir shell sous chaque chat [DOC].
- **Démon `runnerd`** : les agents continuent quand l'app est fermée ou plante ; reprise des conversations [DOC].
- **CLI complète** (`runner mission start/feed/answer/stop`, `--json`) ; une *skill* `runner` est installée dans chaque
  agent détecté pour qu'il pilote Runner lui-même [DOC].
- Gestion centralisée des serveurs MCP et des skills par agent [DOC].
- Pastille d'usage hebdomadaire (Codex, Claude, Antigravity) [DOC] ; `crates/runner-daemon/src/runtimes/*/usage.rs` [CODE].
- Onglets scindés, dossiers d'onglets, multi-fenêtres ; palette ⌘K limitée à un sélecteur [CODE `docs/features/559-command-palette.md`].
- Mise à jour des CLI d'agents depuis les réglages [DOC].

**Points forts.** Modèle mental clair et différenciant (rôles/équipe/mission/chef/`ask_human`) ; persistance robuste via
démon ; agents pilotables par CLI ; rendu terminal natif performant ; rythme de livraison très élevé ; signature des
binaires ; communauté sinophone (README zh-CN, groupe WeChat).

**Points faibles.**

- **Pas de Linux** à ce jour (demande ouverte, ISSUE #823) ; pas de SSH distant (ISSUE #808).
- **Pas d'isolation par worktree, refusée volontairement** : « Jason ne veut pas que Runner devienne un environnement de
  développement d'agents » [CODE `docs/features/archive/403-mission-worktree-isolation.md`]. Toutes les missions d'un
  projet partagent le même checkout.
- **Accès de mission = « Bypass »** des permissions pour la plupart des agents [DOC tableau « Mission access »] : aucun
  garde-fou, aucun sandbox.
- Pas de revue de code ni d'aperçu de fichiers (ISSUE #634), pas de notifications desktop (ISSUE #701), pas de palette de
  commandes complète (ISSUE #559), pas de registre de tokens par session (ISSUE #630).
- Performances : un chat Codex consomme ~24 % d'un cœur (ISSUE #840) ; aller-retour bloquant au démon à chaque frappe (ISSUE #818).
- Messagerie d'équipe qui ne passe pas l'échelle au-delà de trois agents (ISSUE #826).
- Mainteneur unique.

---

### 1.3 Codey — https://github.com/its-ahoh/codey

**Positionnement.** « Plan de contrôle des agents de code que vous utilisez déjà » : workspaces par projet, équipes de
bots, graphes de flux, exécutions parallèles, accès depuis app macOS, Telegram/Discord/iMessage ou voix [DOC README].

| Critère | Constat | Source |
|---|---|---|
| Licence | MIT | API repo |
| Plateformes | App desktop et voix : **macOS uniquement** ; passerelle Node « partout où Node tourne » | README §FAQ ; assets v0.13.4 (arm64 seulement) |
| Pile | Monorepo `@codey/core`, `@codey/gateway`, `codey-mac` (Electron + React), helper Swift (WhisperKit) | README §Project Structure |
| Maturité | 17 étoiles, 5 forks, 3 contributeurs, v0.13.4 (05/10/2026) ; tags incohérents (v1.13.x pour des binaires 0.13.x) | API repo, `/releases` |
| Modèle économique | Gratuit, open source | README |

**Fonctionnalités réelles.**

- Agents : Claude Code, Codex, OpenCode, pi, avec reprise de session ; réglage d'effort de raisonnement unifié [DOC].
- **Exécution parallèle du même prompt** sur plusieurs agents pour comparer (`/parallel`) [DOC].
- **Bots** définis en Markdown (rôle, « âme », agent, modèle, outils) ; **équipes** en mode séquentiel (chaîne), `auto`
  (un « Advisor » choisit le sous-ensemble pertinent) ou **table ronde** (bots concurrents + Advisor modérateur) [DOC].
- **Graphes de flux** dessinés sur un canevas : un LLM juge choisit l'arête suivante selon une condition en langage
  naturel ; boucles de révision, `maxHops`, pause `[ASK_USER]` [DOC] ; `codey-mac/src/components/FlowEditor.tsx` [CODE].
- **Mémoire** utilisateur + projet via le paquet Co-memo (MCP stdio), versions, conflits, archivage ; héritage de
  mémoire dans les worktrees [DOC] ; `packages/gateway/src/worktree-memory.ts` [CODE].
- **Worktree Git par chat** optionnel, sélecteur de branche, diffs par fichier, bouton « Create PR » [DOC] ;
  `packages/gateway/src/chat-worktree.ts`, plan `2026-06-21-branch-picker-worktree-pr.md` [CODE].
- **Automatisations** planifiées (cron) ; chaque exécution dans un worktree jetable nommé « sandbox »
  [CODE `packages/gateway/src/automations/sandbox.ts`] — **ce n'est pas un isolement OS**.
- **Navigateur contrôlé par l'agent**, lecture seule par défaut, actions modifiantes soumises à approbation [DOC] ;
  `codey-mac/electron/browser-*.ts` [CODE].
- Voix : push-to-talk système, WhisperKit local ou API compatible OpenAI, mode conversation [DOC].
- Canaux distants : Telegram, Discord, iMessage avec appairage QR [DOC] ; endpoints `/health`, `/metrics` Prometheus [DOC].
- Skills par workspace et **playbooks** appris des exécutions répétées ; serveurs MCP externes [DOC].
- Panneau terminal (node-pty) [CODE `codey-mac/src/components/TerminalPanel.tsx`].

**Points forts.** Couverture fonctionnelle la plus proche de la vision « équipe d'agents » de Nexus (équipes, graphes,
mémoire, voix) ; mémoire inter-agents réellement versionnée ; accès mobile par messageries ; navigateur à approbations.

**Points faibles.**

- **macOS uniquement** pour l'app et la voix ; aucune version Linux/Windows.
- Communauté très réduite (17 étoiles) ; pas d'issues ouvertes publiques (activité portée par des PR du mainteneur).
- **Complexité conceptuelle élevée** : workspaces, bots, équipes (3 modes), graphes, Advisor, mémoire, playbooks, canaux,
  `gateway.json` à éditer à la main [DOC].
- Contradiction documentaire : README « builds non signés » vs workflow de release qui signe et notarise [DOC].
- Exigence Node 24.12+ pour la passerelle ; dépendance forte à Co-memo [DOC].
- Exposition à distance via bots Telegram/Discord : surface d'attaque à gérer par l'utilisateur [SUPPOSÉ].
- Pas d'isolement OS, pas d'intégration de tickets, pas de suivi de coûts/limites d'abonnement documenté.

---

### 1.4 Emdash — https://github.com/generalaction/emdash (+ copie locale)

**Positionnement.** « Agentic Development Environment » open source (YC W26) : agents en parallèle, chacun dans son
worktree, revue des diffs, PR et merge depuis un seul endroit, en local ou via SSH [DOC README].

| Critère | Constat | Source |
|---|---|---|
| Licence | Apache-2.0 | API repo ; `LICENSE.md` |
| Plateformes | macOS (arm64, x64, Homebrew), Windows (MSI, portable), **Linux x64 et ARM64** (AppImage, `.deb`, `.rpm`) | README §Installation ; assets v1.2.8 |
| Maturité | **5 951 étoiles**, 626 forks, ~139 contributeurs, v1.2.8 (10/10/2026), canaris quotidiens | API repo, `/contributors`, `/releases` |
| Modèle économique | App gratuite et open source ; **Emdash Cloud** (espaces éphémères isolés par tâche) et **Enterprise** sur devis ; télémétrie activée par défaut, désactivable | `emdash.sh/cloud`, `/enterprise`, README §Privacy |

**Fonctionnalités réelles.**

- **37 fournisseurs CLI** dans le code (docs : 34), dont Claude, Codex, OpenCode, **Hermes**, Copilot, Cursor, Amp,
  Qwen, Antigravity (modèles Gemini), Goose, Kiro, pi… [CODE `agents/integrations/providers.md`,
  `packages/plugins/src/agents/impl/`]. **Aucun plugin « Gemini CLI » distinct** (Google via Antigravity) [CODE].
  **Aucun connecteur API direct** : uniquement des CLI (clés API transmises aux CLI) [CODE `providers.md` §Provider API Keys].
- **Mode chat ACP** pour 23 fournisseurs, en plus du mode TUI [CODE `providers.md`].
- **Statut d'agent via hooks** installés dans la config globale de chaque CLI (pas d'inférence depuis la sortie) ;
  notifications « attente d'entrée » [CODE `providers.md` §Agent Hooks].
- **Tâche = branche + worktree** (désactivable), création depuis branche, issue ou PR, choix du modèle [DOC `/docs/tasks`].
  Plusieurs conversations par tâche, scission à droite (⌘D) [DOC raccourcis].
- **Diff view**, éditeur Monaco, explorateur, recherche [DOC ; CODE `core/features/editor`, `search`].
- **PR, checks CI GitHub Actions, merge** dans l'app [DOC ; CODE `core/services/pull-requests`, `checks-list.tsx`] ;
  commentaires de diff mentionnables dans le chat [CODE `diff-comments-mention.ts`]. Comptes GitHub multiples.
- **13 intégrations de tickets** : GitHub, GitLab, Linear, Jira, Asana, Notion, Plane, Trello, Monday, Featurebase,
  Forgejo, Plain, YouTrack [CODE `packages/plugins/src/issues/impl/`].
- **Distant SSH/SFTP** (agent, clé, mot de passe, certificats), worktrees distants, **sessions tmux** persistantes,
  redirection de ports [DOC `/docs/remote-development`, `/docs/tmux-sessions` ; CODE `preview-servers/node/port-forward-*`].
- **Navigateur intégré** pour aperçu des serveurs de dev [DOC `/docs/in-app-browser`].
- **Automatisations** planifiées (cron) avec historique et relances, catalogue intégré (bugs critiques, résumé quotidien,
  scan de vulnérabilités, couverture de tests…) [CODE `automations/browser/builtin-catalog.ts`].
- **Bibliothèque** : prompts, skills, serveurs MCP synchronisés entre écosystèmes d'agents [DOC ; CODE `agents/integrations/mcp.md`].
- **Usage** : fenêtres de limites par compte fournisseur et par machine [CODE `core/features/usage/api/schemas.ts`].
- Palette ⌘K, raccourcis reconfigurables, panneaux Changes/Files/Conversations, tiroir terminal [DOC `/docs/keyboard-shortcuts`].
- **Absences vérifiées dans le code** : aucun sandbox OS (aucune occurrence bwrap/docker/devcontainer hors coloration
  syntaxique), aucune dictée vocale, aucune orchestration superviseur/DAG entre agents [CODE grep sur `apps/desktop/src`,
  `packages/core/src`]. L'isolement « fort » est vendu via Emdash Cloud (payant) [DOC].

**Points forts.** Produit le plus mature et complet ; Linux de première classe (x64/ARM64, deb/rpm/AppImage) ; flux
« issue → worktree → diff → PR → CI → merge » de bout en bout ; largeur de compatibilité agents ; distant SSH ; communauté
nombreuse ; demandes historiques satisfaites (tmux, terminal backend, palette ⌘K) [ISSUE #1215, #2044, #160 fermées].

**Points faibles.**

- **Complexité** : le glossaire `CONTEXT.md` (modèle inventaire/commande, tombstones, générations de session, « outcome
  unknown »…) traduit une architecture lourde ; nombreuses régressions liées à Git/FS.
- Bugs ouverts récurrents : ne fonctionne pas sous Debian sid (#3306) ; CPU soutenu sur l'onglet Workspaces (#3262) ;
  worktree orphelin bloquant (#3247) ; création de tâche silencieusement désactivée si `origin/HEAD` pointe vers une
  branche supprimée (#3198) ; échec de push via proxy d'identifiants (#3192) ; fermer un onglet ne tue pas l'agent (#3293).
- Historique Linux douloureux (fermés) : crash GLIBC 2.38 sur Ubuntu 22.04 (#1619), `safeStorage` en texte clair hors
  GNOME/KDE (#1875), saturation fs-watch (#3084) [ISSUE].
- Demandes non satisfaites : serveur MCP d'Emdash (#2937), API HTTP locale (#1995), merge local sans PR (#1269), diff
  « depuis le dernier tour » (#1635), sous-modules (#1104), GitLab complet (#1096) [ISSUE].
- Pas de gouvernance (approbations, politiques), pas de sandbox local, pas d'orchestration multi-agents coordonnée,
  télémétrie activée par défaut.

---

### 1.5 Pivio — https://pivio.app/

**Positionnement.** « Lancez tous vos agents de code en parallèle. Une fenêtre. » GUI desktop qui orchestre des agents
terminal (Claude Code, Codex, OpenCode) avec kanban, prompts planifiés et pipelines ; le téléphone devient télécommande
[DOC page d'accueil, FAQ].

| Critère | Constat | Source |
|---|---|---|
| Licence | **Propriétaire (freeware)**, code fermé ; clé de licence gratuite contre e-mail, 5 machines | FAQ pivio.app |
| Plateformes | macOS (arm64, Intel), Windows, Linux (AppImage, `.deb`) ; Electron | FAQ ; assets `pivio-labs/pivio-releases` v0.0.55 |
| Maturité | Le site affiche « v1.0.0 » ; le dépôt de releases public est en **v0.0.55 (02/10/2026)**, 0 étoile, 1 issue | pivio.app ; API `pivio-labs/pivio-releases` |
| Modèle économique | Desktop gratuit à vie ; **Pivio Mobile** optionnel 3,99 $/mois (annuel) ou 5,99 $/mois, en bêta | section Pricing |

**Fonctionnalités annoncées** (toutes [DOC], code [NON VÉRIFIABLE]) :

- Agents : Claude Code, Codex, OpenCode ; Gemini CLI et Cursor CLI « bientôt ». **Jusqu'à six agents** par fenêtre.
- Diffusion d'un prompt à tous les agents, **immédiate ou planifiée à la réinitialisation d'une limite de débit**.
- **Multi-comptes** Claude/Codex, bascule d'un agent entre comptes en deux clics.
- **Suivi d'usage** par fenêtre de limite avec minuteurs de réinitialisation.
- « Command composer » : mur d'agents choisis dans plusieurs projets.
- Worktree par agent ; **Kanban synchronisé avec les issues GitHub** ; notifications (fin, besoin d'entrée, blocage).
- Reprise/restauration complète des sessions à la réouverture.
- Marketplace de skills Claude glissées sur un panneau.
- **« Local stack »** : services de dev définis une fois, démarrés en un clic, logs à côté des agents.
- **Navigateur intégré** : sélectionner une zone de la page et l'envoyer à un agent avec son contexte.
- Mobile (bêta) : suivre, piloter, approuver des diffs, commit/push ; relais **chiffré de bout en bout** annoncé.

**Points forts.** Proposition très simple et lisible ; détails ergonomiques remarquables (planification au reset des
limites, multi-comptes, sélection visuelle dans le navigateur, stack locale) ; multiplateforme dont Linux.

**Points faibles.** Code fermé, impossible d'auditer sécurité et confidentialité ; e-mail obligatoire pour la clé ;
pas de suivi de tickets public ; incohérence de version (1.0.0 vs 0.0.55) ; trois agents seulement ; limite de six agents ;
mobile payant ; aucune orchestration (rôles, superviseur, DAG) ni isolement OS annoncés.

---

## 2. Matrice de fonctionnalités

Légende : ✅ présent · 🟡 partiel / limité · ❌ absent · ❔ inconnu · (D) documenté · (C) vérifié code · (I) issue.
Colonne Nexus : état lu dans `.coordination/STATUS.md`, `DECISIONS.md`, `packages/contracts/src/ipc.ts`,
`docs/RELEASE_NOTES.md` (préversion 0.1.0 interne Linux, non publiée).

| Fonctionnalité | Hydra | Runner | Codey | Emdash | Pivio | **Nexus AI** |
|---|---|---|---|---|---|---|
| **Linux** | ✅ AppImage/deb (D) | ❌ prévu 0.16 (I #823) | ❌ (D) | ✅ x64+ARM64 (D) | ✅ AppImage/deb (D) | ✅ `.deb`/`.zip` (préversion) |
| Windows | ✅ | ✅ | ❌ | ✅ | ✅ | 🟡 sans sandbox, non testé |
| macOS | 🟡 non signé | ✅ arm64 signé | ✅ | ✅ | ✅ | 🟡 sans sandbox, non testé |
| Licence | MIT | MIT | MIT | Apache-2.0 | Propriétaire | Apache-2.0 |
| Nombre d'agents CLI | 2 | 6 | 4 | 37 (C) | 3 | Claude réel, Codex fixtures, générique (Gemini/Hermes/OpenCode/Qwen) |
| **Modèles par API directe** | ❌ | ❌ | 🟡 clés dans config (D) | ❌ CLI seulement (C) | ❌ | ✅ OpenAI/Anthropic/Google/OpenRouter (fixtures) |
| Terminal interactif agent (TUI dans PTY) | ✅ | ✅ natif GPU | 🟡 | ✅ | ✅ | ❌ flux en lecture seule |
| Terminal utilisateur PTY | ✅ | ✅ | ✅ (C) | ✅ | ✅ | ✅ `terminal.create` (C) |
| Mode chat structuré | 🟡 bulles | ❌ | ✅ | ✅ ACP (C) | ✅ | ✅ (sessions/évènements) |
| Éditeur de code | ❌ | ❌ (I #634) | ❌ | ✅ Monaco | ✅ (D) | ✅ Monaco |
| Worktree par tâche | 🟡 (C) | ❌ refusé (C) | ✅ par chat | ✅ | ✅ | ✅ |
| Revue de diff | 🟡 diff + PR (C) | ❌ (I #634) | ✅ | ✅ | ✅ | ✅ revue avant acceptation |
| Merge contrôlé / conflits | ❌ | ❌ | ❔ | ✅ | ❔ | ✅ merge approuvé, conflits sans écrasement |
| Création de PR | ❌ | ❌ | ✅ | ✅ | 🟡 | 🟡 paquet `@nexus/github` (fixtures), pas de canal IPC dédié |
| Checks CI dans l'app | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Tickets (GitHub/Linear/Jira…) | ❌ | ❌ | ❌ | ✅ 13 (C) | 🟡 GitHub Kanban | ❌ |
| Multi-agents parallèles | ✅ ≤10 | ✅ | ✅ | ✅ | ✅ ≤6 | ✅ DAG à parallélisme borné |
| Diffusion d'un prompt à N agents | ✅ | ❌ | ✅ `/parallel` | 🟡 | ✅ (+ planifiée) | ❌ |
| Équipes / rôles | ❌ | ✅ crews | ✅ bots/équipes | ❌ | ❌ | ✅ équipes, rôles |
| Superviseur / chef | ✅ manager MCP | ✅ lead | ✅ Advisor | ❌ | ❌ | ✅ supervision IA + plan validé |
| DAG / graphe de tâches | ❌ | ❌ | ✅ graphes + juge LLM | ❌ | 🟡 « pipelines » | ✅ DAG, réessais, détection de blocage |
| Escalade vers l'humain | ❌ | ✅ `ask_human` | ✅ `[ASK_USER]` | 🟡 statut « attente » | ✅ notifs | ✅ bus question/réponse + approbations |
| Mémoire partagée inter-agents | ❌ | 🟡 fil d'équipe | ✅ Co-memo versionnée | ❌ | ❌ | 🟡 artefacts versionnés/hachés, bus de messages |
| Gouvernance / politiques / approbations | ❌ | ❌ (Bypass) | 🟡 navigateur | ❌ | ❌ | ✅ moteur de politiques, 3 modes |
| **Sandbox OS des agents** | ❌ | ❌ | ❌ (worktree) | ❌ local (Cloud payant) | ❔ | ✅ Linux : bwrap + seccomp + cgroups v2 + proxy egress |
| Coffre de secrets / anti-fuite | ❌ | ❌ | ❌ | 🟡 trousseau SSH | ❔ | ✅ coffre, broker, scanner de secrets |
| Suivi d'usage / coûts | ✅ estimé + budgets | 🟡 pastille hebdo | ❌ | ✅ fenêtres de limites | ✅ minuteurs | 🟡 provenance + budgets + LoopGuard (persistance à brancher) |
| Multi-comptes fournisseur | ❌ | ❌ | 🟡 profils | ✅ (C) | ✅ | ❌ |
| Persistance / reprise | ✅ | ✅ démon | ✅ | ✅ tmux | ✅ | ✅ journal append-only, reprise après crash |
| Agents survivent à la fermeture de l'app | 🟡 démon (C) | ✅ `runnerd` | ✅ passerelle | ✅ tmux | ❔ | ❌ |
| Palette de commandes | ❌ | 🟡 sélecteur | ❔ | ✅ ⌘K | ❔ | ✅ `mod+shift+p` (C) |
| Notifications desktop | ✅ budgets | ❌ (I #701) | ✅ | ✅ | ✅ | ❌ non trouvé dans le code |
| Navigateur / aperçu web | ❌ | ❌ | ✅ piloté par agent | ✅ | ✅ sélection → agent | ❌ |
| Stack de dev locale (services) | ❌ | ❌ | ❌ | 🟡 scripts projet | ✅ | ❌ |
| Voix | ❌ | ❌ | ✅ WhisperKit | ❌ | ❌ | 🟡 logique + consentement, aucun moteur STT |
| Distant SSH | ❌ | ❌ (I #808) | ❌ | ✅ | ❌ | ❌ |
| Mobile / télécommande | ✅ PWA Firebase | ❌ (I #836) | ✅ messageries | ❌ | ✅ payant | ❌ |
| Automatisations planifiées | 🟡 headless | ❌ | ✅ cron | ✅ cron + catalogue | ✅ prompts planifiés | ❌ |
| CLI / API pour piloter l'app | 🟡 MCP | ✅ CLI `--json` | ✅ commandes chat | ❌ (I #1995, #2937) | ❌ | ❌ |
| MCP / skills gérés | ❌ | ✅ | ✅ | ✅ bibliothèque | ✅ marketplace | ❌ |
| Déploiement (Vercel) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ preview/prod approuvés (fixtures) |
| Diagrammes d'architecture | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ Mermaid (rendu image à faire) |
| Export/import de projet | ❌ | 🟡 (I #804) | ❌ | ❌ | ❌ | ✅ archive avec intégrité |
| Arrêt d'urgence global | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ `app.emergencyStop` (C) |
| Interface en français | ❌ | ❌ (zh-CN prévu) | 🟡 zh | ❌ | ❌ | ✅ i18n fr/en (C) |

Nota : les cases ❌ de Nexus signifient « non trouvé dans les fichiers cités » ; les cases ✅ « fixtures » ne sont pas
encore validées en conditions réelles (`gh`, `vercel`, Codex, clés API).

---

## 3. Ce qu'on fait comme eux (indispensables)

| # | Fonctionnalité | Référence | Priorité | Justification |
|---|---|---|---|---|
| 1 | **Agent dans un vrai terminal interactif (TUI + PTY)** | Runner, Hydra, Emdash, Pivio | **P0** | Tous les concurrents laissent l'utilisateur voir et répondre à la TUI de l'agent ; Nexus n'affiche qu'un flux en lecture seule. C'est l'attente de base de la catégorie. |
| 2 | **Notifications « agent terminé / a besoin de vous »** | Emdash, Pivio, Codey | **P0** | Sans elles, le parallélisme est inutilisable. Runner est critiqué pour leur absence (#701). |
| 3 | **Statut d'agent fiable par hooks** (et non par analyse de texte) | Emdash, Runner | **P0** | Emdash refuse explicitement d'inférer depuis la sortie ; c'est la base des notifications et de l'état « en attente ». |
| 4 | **Création de PR depuis l'app** (canal IPC + UI) | Emdash, Codey | **P0** | La logique existe dans `@nexus/github` mais n'est pas exposée ; boucle « tâche → PR » attendue. |
| 5 | **Validation réelle de Codex, Gemini CLI, OpenCode, Hermes** | tous | **P0** | Codex est seulement en fixtures ; un orchestrateur qui ne lance qu'un agent réel n'est pas crédible. |
| 6 | **Suivi des limites d'abonnement (fenêtres + reset)** | Pivio, Emdash, Runner | **P1** | Principal souci des utilisateurs Claude Max/Codex Pro ; Nexus a la provenance mais pas la persistance ni l'affichage des fenêtres. |
| 7 | **Diffusion d'un prompt à plusieurs agents / comparaison** | Hydra, Codey, Pivio | **P1** | Usage « best-of-N » très demandé et simple. |
| 8 | **Import de tickets (GitHub Issues d'abord, puis Linear/Jira)** | Emdash, Pivio | **P1** | Point d'entrée naturel d'une tâche. |
| 9 | **Sessions qui survivent à la fermeture de l'app** | Runner, Emdash (tmux) | **P1** | Demande la plus votée historiquement chez Emdash (#1215). |
| 10 | **Gestion MCP / skills par agent** | Runner, Emdash, Pivio | **P1** | Tous les concurrents actifs l'ont ; évite d'éditer N fichiers de config. |
| 11 | **Aperçu web intégré** | Emdash, Pivio, Codey | **P2** | Utile pour le front-end ; non différenciant. |
| 12 | **Distant SSH** | Emdash | **P2** | Fort chez Emdash, demandé chez Runner (#808) ; coûteux. |
| 13 | **Automatisations planifiées** | Emdash, Codey, Pivio | **P2** | Le moteur DAG de Nexus s'y prête bien. |
| 14 | **Checks CI dans l'app** | Emdash | **P2** | Complète la boucle PR. |

---

## 4. Ce qu'on fait différemment / mieux

1. **Linux natif de première classe avec isolement réel.** Runner et Codey n'ont pas de Linux ; Hydra désactive le
   sandbox Chromium sur Linux ; Emdash a connu plusieurs incidents Linux (GLIBC, safeStorage, fs-watch). Nexus est
   développé et testé d'abord sur Linux et dispose d'un vrai sandbox (bwrap + seccomp + cgroups v2 + proxy egress) —
   **aucun des cinq concurrents n'annonce ni n'implémente d'isolement OS local** (vérifié dans le code pour Emdash,
   Codey et Runner ; non vérifiable pour Pivio). Emdash vend l'isolement via son Cloud payant : Nexus peut l'offrir en local.
2. **Le mode « Autonome en sandbox » comme bascule simple.** Runner lance ses missions en « Bypass » ; Hydra pousse le
   YOLO. Nexus peut offrir la même autonomie, mais confinée : réseau limité au fournisseur, identifiants masqués.
   Le message : « laissez l'agent foncer, sans lui donner votre machine ».
3. **CLI + API unifiés.** Tous les concurrents sont « CLI uniquement » (Codey accepte des clés mais pour des CLI).
   Nexus pilote des CLI **et** des modèles par API (OpenAI, Anthropic, Google, OpenRouter) dans la même équipe :
   utile pour des rôles bon marché (relecteur, résumeur) ou pour des utilisateurs sans abonnement.
4. **Orchestration explicable et gouvernée.** Runner a des équipes sans isolation ; Codey a des graphes sans garde-fous ;
   Emdash a l'isolation sans orchestration. Nexus combine DAG, plan validé, superviseur IA, approbations liées au plan
   exact et journal append-only. Avantage : traçabilité (« pourquoi cet agent a fait ça »), utile en équipe et en entreprise.
5. **Mémoire inter-agents sobre.** Codey prouve l'intérêt d'une mémoire partagée mais au prix d'une forte complexité.
   Nexus a déjà artefacts versionnés et bus de messages : en faire une mémoire de mission lisible (et non un système de
   plus à apprendre).
6. **Simplicité.** Codey et Emdash empilent les concepts. La décision du propriétaire (« trois modes de session, choix
   simples ») est un argument : une session en un clic (`sessions.start`), le reste (équipes, DAG) caché tant qu'on n'en
   a pas besoin.
7. **Confidentialité et transparence.** Pivio est fermé, Hydra passe par Firebase, Emdash a la télémétrie activée par
   défaut. Nexus : open source Apache-2.0, aucune télémétrie par défaut [à confirmer et maintenir], relais éventuel
   chiffré de bout en bout.
8. **Garde-fous des actions distantes.** Push sans force possible, déploiement production distinct, scanner de secrets
   avant push : aucun concurrent ne documente ce niveau de protection.
9. **Francophonie.** Interface fr/en native ; aucun concurrent ne cible le public francophone.

---

## 5. Backlog priorisé

Complexité : S (≤ 3 j), M (≤ 2 sem.), L (> 2 sem.). Priorité : P0 (bloquant pour une préversion publique), P1, P2.

| # | Titre | Problème utilisateur résolu | Référence(s) | Ce qui rendrait Nexus meilleur | Cplx | Prio |
|---|---|---|---|---|---|---|
| 1 | **Terminal d'agent interactif** (TUI de Claude/Codex dans xterm + PTY, saisie directe) | « Je ne peux pas répondre à mon agent ni voir sa TUI » | Runner, Emdash, Hydra | PTY lancé **dans le sandbox** quand le mode l'exige, et journalisation des entrées/sorties dans le journal d'évènements | L | P0 |
| 2 | **Statut d'agent par hooks** (working / idle / attend une entrée / terminé) | Savoir sans regarder quel agent a besoin de moi | Emdash, Runner | Hooks installés de façon réversible, marqués et versionnés ; aucune inférence sur le texte | M | P0 |
| 3 | **Notifications desktop + badge** | Ne pas rater une question ou une fin de tâche | Emdash, Pivio, Codey | Notification cliquable ouvrant la bonne session ; regroupement ; mode silencieux | S | P0 |
| 4 | **Codex et Gemini CLI validés en réel** (puis OpenCode, Hermes) | « Seul Claude marche vraiment » | tous | Tests de contrat par connecteur exécutés dans la CI quand le binaire est présent ; matrice de capacités publique comme Runner | M | P0 |
| 5 | **Créer une PR depuis la revue de diff** | Fin de boucle tâche → PR sans terminal | Emdash, Codey | Canal IPC + UI ; corps de PR généré depuis le plan et le journal ; approbation par simple dialogue (DECISIONS) | S | P0 |
| 6 | **Persister et afficher l'usage** (fenêtres 5 h/hebdo, reset, budgets, provenance) | « Vais-je atteindre ma limite ? » | Pivio, Emdash, Hydra | Afficher la provenance (rapporté/estimé/indisponible) — honnêteté qu'aucun concurrent ne montre ; LoopGuard visible | M | P0 |
| 7 | **Mode « Autonome en sandbox » de bout en bout dans l'UI** | Laisser un agent travailler seul sans risque pour la machine | aucun (Runner = Bypass) | Indicateur clair de confinement, liste des domaines autorisés éditable, journal des refus réseau | M | P0 |
| 8 | **Onboarding « première session en 60 s »** (détection des CLI, test d'auth, projet, prompt) | Démarrer sans comprendre équipes/DAG | Pivio, Emdash | Diagnostic de chaque agent (version, chemin, auth OK) avec correctif proposé | S | P0 |
| 9 | **Diffusion d'un prompt à N agents + comparaison des diffs** | Choisir la meilleure solution parmi plusieurs agents | Hydra, Codey, Pivio | Un worktree par agent, vue côte à côte des diffs et des tests, « garder celui-ci » en un clic | M | P1 |
| 10 | **Sessions persistantes hors application** (démon ou tmux) | Fermer l'app sans tuer les agents | Runner, Emdash | Démon léger réutilisant le process-supervisor ; reprise rattachée au journal append-only | L | P1 |
| 11 | **Import de GitHub Issues → tâche** (puis Linear, Jira) | Démarrer une tâche depuis un ticket | Emdash, Pivio | Lien bidirectionnel (commentaire de statut sur l'issue après approbation) | M | P1 |
| 12 | **Gestion MCP et skills par agent** | Configurer une fois pour tous les agents | Runner, Emdash | Activation par rôle d'équipe, et serveurs MCP **soumis aux politiques** (réseau du sandbox) | M | P1 |
| 13 | **Pilotage de Nexus par MCP/CLI** (`nexus mission start`, outils MCP) | Laisser un agent « chef » déléguer à d'autres | Hydra, Runner ; demandé chez Emdash (#2937, #1995) | Outils MCP soumis aux mêmes approbations que l'UI ; sortie `--json` | M | P1 |
| 14 | **Mémoire de mission lisible** (faits, décisions, artefacts partagés entre agents) | Les agents se répètent et se contredisent | Codey | Basée sur les artefacts versionnés existants ; édition/suppression par l'utilisateur ; pas de nouveau concept | M | P1 |
| 15 | **Escalade humaine unifiée** (boîte de réception des questions et approbations) | Questions éparpillées entre sessions | Runner (`ask_human`), Codey | Une seule file triée par urgence, réponse au clavier | S | P1 |
| 16 | **Multi-comptes par fournisseur** | Basculer entre compte perso/pro ou au reset | Pivio, Emdash | Comptes rangés dans le coffre de secrets, montés uniquement dans le sandbox concerné | M | P1 |
| 17 | **Planifier un prompt au reset de la limite** | Reprendre automatiquement quand le quota revient | Pivio | S'appuie sur le suivi d'usage (#6) et l'ordonnanceur DAG | S | P1 |
| 18 | **Diff « depuis le dernier tour »** | Voir ce que l'agent vient de changer | demandé chez Emdash (#1635) | Instantané Git léger par tour dans le journal | S | P1 |
| 19 | **Merge local sans PR** | Projets sans remote / solo | demandé chez Emdash (#1269, #451) | Déjà proche : merge approuvé existant à exposer | S | P1 |
| 20 | **Rendu des diagrammes Mermaid dans l'UI** | Comprendre l'architecture d'un projet | aucun | Différenciant déjà à moitié construit (T-022) | S | P2 |
| 21 | **Aperçu web intégré + « sélectionner une zone → agent »** | Corriger une UI sans décrire la page | Pivio, Emdash, Codey | Webview isolée (sans Node), capture envoyée comme artefact | M | P2 |
| 22 | **Stack locale** (services de dev déclarés, logs à côté des agents) | Lancer front + back + DB pour tester | Pivio | Services lancés dans le même confinement réseau que l'agent si mode sandbox | M | P2 |
| 23 | **Automatisations planifiées** (cron) avec modèles | Tâches récurrentes (revue de sécurité, résumé) | Emdash, Codey | Exécutées par défaut en mode sandbox, résultats en revue | M | P2 |
| 24 | **Checks CI GitHub dans la vue PR** | Savoir si la PR passe | Emdash | Relancer l'agent sur l'échec avec le log en contexte | M | P2 |
| 25 | **Moteur STT local (whisper.cpp) pour la dictée** | Dicter des consignes | Codey | Consentement et relecture déjà construits ; installation guidée | M | P2 |
| 26 | **Distant SSH** | Lancer des agents sur un serveur | Emdash | Réutiliser le sandbox côté hôte distant Linux | L | P2 |
| 27 | **Télécommande mobile chiffrée de bout en bout** | Suivre/approuver loin du bureau | Pivio, Hydra, Codey | Relais auto-hébergeable, aucune donnée en clair chez un tiers | L | P2 |
| 28 | **Backend sandbox macOS/Windows** | Mode sandbox indisponible hors Linux | aucun | Seatbelt/AppContainer ou VM légère ; à cadrer par ADR | L | P2 |

### Top 10 recommandé (ordre d'exécution)

1. Terminal d'agent interactif (#1) · 2. Statut par hooks (#2) · 3. Notifications (#3) · 4. Codex/Gemini réels (#4) ·
5. Onboarding 60 s (#8) · 6. Mode sandbox dans l'UI (#7) · 7. PR depuis la revue (#5) · 8. Usage persisté (#6) ·
9. Diffusion + comparaison (#9) · 10. Sessions persistantes (#10).

---

## 6. Conclusion — positionnement défendable

**Ce qui est vrai aujourd'hui.** Emdash domine la catégorie (≈ 6 000 étoiles, ~139 contributeurs, 37 agents, flux
issue → PR → CI → merge, SSH, Linux complet). Runner a le meilleur modèle d'équipe et de persistance, mais pas de Linux ni
d'isolation. Codey a la vision « équipes + graphes + mémoire » la plus riche, mais sur macOS seulement et au prix d'une
grande complexité. Hydra est dormant. Pivio soigne l'ergonomie mais reste fermé. Nexus, lui, est une **préversion interne
Linux non publiée**, dont plusieurs briques ne sont validées que sur fixtures et qui manque d'attendus de base
(terminal d'agent interactif, notifications, PR exposée, Codex réel).

**Ce que Nexus peut défendre honnêtement**, à condition de livrer le top 10 :

- *« L'orchestrateur d'agents de code pensé pour Linux, où l'autonomie peut être confinée. »* Parmi les cinq concurrents
  étudiés, aucun ne propose d'isolement OS local des agents ; Nexus en a un, testé sur Linux. Ce n'est pas une
  revendication d'unicité absolue sur le marché (d'autres outils non étudiés peuvent exister), mais un avantage vérifié
  dans ce panel.
- *CLI et API dans la même équipe*, avec un journal explicable et des approbations liées au plan : pertinent pour des
  équipes et des entreprises qui veulent de la traçabilité.
- *Simplicité assumée* : trois modes de session au lieu d'une taxonomie de concepts.

**Ce que Nexus ne doit pas revendiquer** : la « première orchestration multi-agents » (Runner, Codey, Hydra en ont), la
largeur de compatibilité (Emdash), ni la maturité. Le risque principal est de vouloir égaler Emdash fonction par
fonction : la stratégie conseillée est de combler les attendus P0, puis d'investir là où les autres sont faibles —
sandbox, gouvernance, API + CLI, Linux, simplicité.
