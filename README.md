# Nexus AI

> **The orchestra for your AI coding agents.** Describe a goal: Claude, Codex, Gemini, OpenCode, Qwen and Hermes take it
> on **together** — they split the work, **talk to each other while they code**, review each other, and hand you an
> integrated result. In a real development environment, running locally, with a real sandbox.

**Status: preview 0.1.0 — Linux first** (Windows and macOS builds are produced, without the verified sandbox).
Details: [`.coordination/STATUS.md`](.coordination/STATUS.md) · [release notes](docs/RELEASE_NOTES.md).

## Download

Grab the latest build from the [**Releases**](https://github.com/Dayifour/nexus/releases) page:

| System | File | Install |
|---|---|---|
| Ubuntu / Debian | `nexus-ai_<version>_amd64.deb` | `sudo apt install ./nexus-ai_<version>_amd64.deb` |
| Fedora / openSUSE | `nexus-ai-<version>.x86_64.rpm` | `sudo dnf install ./nexus-ai-<version>.x86_64.rpm` |
| Any Linux | `Nexus AI-linux-x64-<version>.zip` | unzip, then run `nexus-ai` |
| Windows | `Nexus AI-<version> Setup.exe` (or the `.zip`) | run the installer |
| macOS | `Nexus AI-darwin-arm64-<version>.zip` | unzip, then right-click → Open (unsigned build) |

`SHA256SUMS.txt` lists the checksum of every file. Nexus drives the agent CLIs you already use: install and sign in to at
least one of them (`claude`, `codex`, `gemini`, `qwen`, `opencode`, `hermes`) — Nexus detects them automatically.

## What makes Nexus different

Other tools run several agents **side by side**. Nexus makes them **work together**:

- **An autonomous conductor.** One agent (e.g. Claude) breaks the goal into tasks, assigns each task to the agent best
  suited for it (architecture, tests, front-end, large context…) and orders them as a dependency graph.
- **Agents from different vendors on one team.** Independent tasks run in parallel in a shared, isolated copy of the
  project.
- **Real agent-to-agent messaging.** Every agent gets the `nexus` MCP tools — `team_status`, `send_message`,
  `read_messages`, `ask_lead`. Codex can ask the conductor for an exact API signature, or warn Claude about an interface
  contract, while it works. Verified with real Claude Code, Codex CLI and OpenCode runs.
- **Hand-offs.** Each agent receives the report and the changes of the tasks it depends on.
- **Reviews by the conductor.** Every result is reviewed (diff + acceptance criteria): accepted, or sent back with precise
  changes.
- **Resilient.** If an agent fails (not signed in, CLI error), the conductor shows why and reassigns its tasks to another
  team member.
- **You stay in control.** Full autonomy or plan approval; message the conductor at any time; stop instantly; merge the
  team's branch into your project in one confirmed click.

## Everything else you expect from a coding workspace

- **Three simple modes**: Autonomous (directly in the project), Sandboxed (bubblewrap + seccomp + network proxy limited to
  the agent's provider), Reviewed (isolated copy, you accept the changes).
- **Agents in their real terminal** (interactive TUI, live status, desktop notifications) or as a conversation; sessions
  are kept per project, can be resumed, searched and deleted.
- **A VS Code-like IDE**: file explorer, Monaco editor, real terminals, command palette, full keyboard shortcuts, Git,
  pull requests.
- **Deployment planning**: the AI proposes hosting architectures (Vercel, Render, Railway, Hostinger VPS, MongoDB
  Atlas…), you pick one, Nexus deploys it step by step with confirmation.
- **Local-first and secure**: SQLite event log, OS keychain for secrets, validated IPC, native confirmation dialogs for
  sensitive actions. See the [threat model](docs/threat-model/README.md).
- **French and English** interface, messages and logs.

## Architecture

```text
React renderer (untrusted UI)
    ⇅ typed IPC, validated in preload and main (Zod)
Electron main
    ├── Orchestra: conductor, parallel task graph, reviews, MCP team bus between agents
    ├── Event store (SQLite + Prisma), projections, crash recovery
    ├── Connectors: CLI agents (stream-json / PTY) and API models (HTTPS)
    ├── Process supervisor (PID namespace) and Linux sandbox (bwrap, seccomp, cgroups, egress proxy)
    ├── Git worktrees, GitHub, deployment planner
    └── Secret vault (safeStorage), voice, usage
```

## Develop

Requirements: Node 24.18, pnpm 11, Linux (bubblewrap and unprivileged user namespaces for the sandbox tests).

```bash
pnpm install --frozen-lockfile && pnpm run generate
pnpm run check     # lint, typecheck, tests
pnpm start         # run the app in development
pnpm --filter @nexus/desktop run make   # build packages into apps/desktop/out/make
```

Reproducible Linux build in Docker (no local toolchain needed):

```bash
docker build -f Dockerfile.release --target export -o dist .
```

Publishing a release: see [`docs/RELEASING.md`](docs/RELEASING.md). Contributing: [`CONTRIBUTING.md`](CONTRIBUTING.md) ·
security: [`SECURITY.md`](SECURITY.md).

## License

Apache-2.0 — Copyright 2026 Dayifour. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
