# Notes de version — Nexus AI 0.1.0 (préversion)

*English version below.*

**Statut : préversion, Linux vérifié.** Les versions Windows et macOS sont construites par le workflow de publication mais
restent expérimentales. Licence Apache-2.0 appliquée (`LICENSE`, `NOTICE`, « Copyright 2026 Dayifour »).

## Principe

Les CLI des agents (Claude Code, Codex, Gemini CLI, Qwen Code, OpenCode, Hermes) codent avec leurs propres outils. Nexus
ne les remplace pas : il les lance, les isole, les orchestre, relaie leurs messages, relit et intègre leurs résultats.

## Contenu

- **Sessions** : un agent, une consigne, dans son vrai terminal (PTY interactif) ou en conversation. Trois modes : *Avec
  validation* (défaut, copie Git puis relecture du diff), *Autonome* (directement dans le projet), *Autonome en sandbox*
  (opt-in, Linux). Composer : Entrée envoie, messages mis en file pendant que l'agent travaille.
- **Diffusion** d'une même consigne à 2–6 agents, chacun dans sa copie.
- **Orchestre** : un chef d'orchestre en lecture seule planifie un DAG ; tâches parallèles dans une copie commune isolée ;
  bus MCP `nexus` (`team_status`, `send_message`, `read_messages`, `ask_lead`) ; revue par le chef ; intégration confirmée ;
  arrêt par orchestre ; **reprise après redémarrage**.
- **Espace de travail IDE** : explorateur, Monaco, terminaux PTY, palette, raccourcis façon VS Code, Git, PR via `gh`.
- **Plan de déploiement** : Vercel, Render, Railway, VPS Hostinger, MongoDB Atlas, étape par étape avec confirmation.
- **Consommation**, thèmes clair/sombre/système, interface et processus principal en français et en anglais (langue du
  système au premier lancement), écran d'accueil avec les commandes d'installation des agents.

## Agents

- Vérifiés en réel (hors sandbox et dans la sandbox) : **Claude Code, Codex CLI, OpenCode, Hermes**. Bus de l'équipe vérifié
  avec Claude, Codex et OpenCode.
- **Gemini CLI et Qwen Code** : adaptateurs prêts, jamais lancés en réel.
- Lecture seule imposée par CLI pour le chef d'orchestre : Gemini/Qwen `--approval-mode plan`, OpenCode `--agent plan` ;
  Hermes ne peut pas être chef (pas de mode lecture seule). Claude : nouvel identifiant de session à chaque exécution.
- API OpenAI / Anthropic / Google / OpenRouter : conversation seulement (aucun outil), non vérifiées avec de vraies clés.

## Sécurité

- Renderer sans Node, CSP stricte en production, IPC validé par Zod dans le preload et le main, pas de `shell: true`.
- Frontière de processus par plateforme : Linux PID namespace + mort du parent (`setpriv --pdeathsig`) ; macOS groupe de
  processus ; Windows arbre `taskkill` (ces deux derniers non testés sur de vraies machines).
- Sandbox Linux : bwrap, seccomp, cgroups v2, proxy réseau limité au fournisseur ; métadonnées Git en lecture seule ; Git hôte
  et push refusent une configuration de dépôt qui définit des commandes (M24). D-1 levée : la connexion du CLI est montée en
  lecture-écriture dans sa sandbox (M19). D-4 : `.env` visibles par défaut.
- Bus de l'équipe : socket Unix privée / tube nommé Windows, jeton par tâche.
- Barrières d'erreur dans l'interface, garde des modifications non enregistrées, confirmation avant de fermer le terminal
  d'un agent actif.
- Paquet allégé : archive asar de 146 Mo à 18 Mo.

## Limites connues

- Windows / macOS : pas de sandbox (mode refusé), processus et terminaux non vérifiés en réel, macOS non signé.
- `.rpm` construit par le workflow de publication, non testé.
- PR GitHub et hébergeurs de déploiement : vérifiés uniquement contre des faux (`gh` simulé, API simulées).
- Dictée : exige whisper.cpp ou un consentement cloud explicite ; jamais exécutée en réel.
- Messagerie entre agents indisponible pour les agents en sandbox.
- Protection des `.env` par projet : présente dans le moteur, sans réglage dans l'interface.

---

# Release notes — Nexus AI 0.1.0 (preview)

**Status: preview, Linux verified.** Windows and macOS builds are produced by the release workflow but are experimental.
Apache-2.0 licence applied.

**Principle.** The agent CLIs do the coding with their own tools; Nexus launches, isolates, orchestrates, relays, reviews
and merges.

**What's in it.** Sessions in three modes (Supervised by default, Autonomous, Sandboxed opt-in on Linux), real PTY
terminals, composer with Enter-to-send and queued messages; broadcast to 2–6 agents; Orchestra (read-only conductor, DAG,
parallel tasks in a shared isolated copy, MCP team bus, reviews, confirmed merge, per-mission stop, resume after
restart); IDE workspace (explorer, Monaco, terminals, Git, PRs via `gh`); deployment planner (Vercel, Render, Railway,
Hostinger VPS, MongoDB Atlas, step by step with confirmation); usage view; light/dark/system themes; French/English with
first-run language from the OS; onboarding with install commands.

**Agents.** Verified for real: Claude Code, Codex CLI, OpenCode, Hermes. Pending: Gemini CLI, Qwen Code (never run for
real). API connectors are chat-only and unverified with real keys.

**Security.** Strict production CSP, Zod-validated IPC, no shell; per-platform kill boundary (Linux verified; macOS process
group and Windows `taskkill` tree unverified); Linux sandbox with read-only Git metadata and host Git refusing
command-defining repo configs (also on push); team bus over a private Unix socket / Windows named pipe; error boundaries,
unsaved-changes guard, agent-terminal close confirmation; asar reduced from 146 MB to 18 MB.

**Known limits.** No sandbox on Windows/macOS; `.rpm` built but untested; GitHub PR and deploy providers verified only
against fakes; voice dictation never run for real; no team bus for sandboxed agents; no UI switch for per-project `.env`
protection.
