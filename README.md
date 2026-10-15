# Nexus AI

> **The orchestra for AI coding agents.** Give Nexus a development goal and let compatible agents plan, divide, discuss, review, and integrate the work as one team - while you remain in control.

Nexus AI is a local-first desktop workspace for coordinating AI coding agents such as Claude Code, Codex, Gemini, OpenCode, Qwen, and Hermes. It is designed for real development repositories, not isolated chat demos: agents can work in parallel, exchange structured context, hand work off to one another, and submit their output for review.

## Preview status

Nexus AI is currently a **source-first 0.1.0 preview**. The primary verified platform is Linux. The repository includes release automation for Linux, Windows, and macOS, but a public 0.1.0 release has not yet been published.

Before using Nexus AI on a valuable repository, read the [security policy](SECURITY.md), [threat model](docs/threat-model/README.md), and [release notes](docs/RELEASE_NOTES.md). Preview software may contain incomplete integrations and platform-specific limitations.

## Why Nexus AI

Most multi-agent tools run agents next to each other. Nexus is built to make them collaborate:

- **An autonomous conductor** turns a goal into a dependency graph, assigns work according to agent capabilities, and reviews completed tasks against the acceptance criteria.
- **A mixed-vendor team** can run independent work in parallel from a shared, isolated project copy.
- **Agent-to-agent messaging** gives agents a constrained team bus for status, hand-offs, questions, and warnings while they work.
- **Reviewed hand-offs** pass relevant reports and changes to dependent tasks instead of treating each agent run as an isolated chat.
- **Failure-aware orchestration** surfaces unavailable CLIs and execution errors, then enables reassignment rather than hiding the failure.
- **Human control at every boundary** supports plan approval, direct conductor messaging, immediate stopping, and an explicit merge decision.

The desktop workspace also includes a project explorer, Monaco editor, terminals, Git workflows, pull-request support, deployment planning, local event storage, secret handling through the OS keychain, and French/English UI and logs.

## Platform support and safety

| Platform | Application builds | Verified agent sandbox |
| --- | --- | --- |
| Linux | Primary development and verification platform | Yes: Bubblewrap, seccomp, cgroups v2, and restricted egress proxy |
| Windows | Release automation is present | No; `sandbox-auto` is refused |
| macOS | Release automation is present | No; `sandbox-auto` is refused |

Sandbox guarantees are deliberately conservative. Nexus does not advertise a sandbox as available until its isolation tests pass on that platform. See [SECURITY.md](SECURITY.md) and the [threat model](docs/threat-model/README.md) for residual risks and operational guidance.

## Get started from source

### Requirements

- Node.js `24.18.x`
- pnpm `11.10.x`
- Git
- Linux is recommended for the verified development path. Sandbox tests additionally require Bubblewrap (`bwrap`) and unprivileged user namespaces.
- At least one supported agent CLI installed and authenticated locally (`claude`, `codex`, `gemini`, `qwen`, `opencode`, or `hermes`). Nexus detects available CLIs; it never supplies provider accounts or credentials.

### Run locally

```bash
git clone https://github.com/Dayifour/nexus.git
cd nexus
pnpm install --frozen-lockfile
pnpm run generate
pnpm run check
pnpm start
```

Build distributable packages locally with:

```bash
pnpm --filter @nexus/desktop run make
```

For a reproducible Linux build without a local Node.js toolchain:

```bash
docker build -f Dockerfile.release --target export -o dist .
```

The release workflow produces Linux, Windows, and macOS artefacts when a maintainer pushes a `vX.Y.Z` tag. Publishing instructions are in [docs/RELEASING.md](docs/RELEASING.md).

## Architecture

```text
React renderer (untrusted UI)
    <-> typed IPC, validated in preload and main (Zod)
Electron main
    |- Orchestra: conductor, parallel task graph, reviews, MCP team bus
    |- Event store: SQLite + Prisma, projections, crash recovery
    |- Connectors: CLI agents and HTTPS API models
    |- Process supervisor and Linux sandbox
    |- Git worktrees, GitHub, and deployment planner
    `- Secret vault, voice, and usage services
```

The workspace is organised as follows:

```text
apps/desktop/          Electron desktop application
packages/contracts/    Shared schemas and public contracts
packages/*/            Domain, agent, sandbox, storage, Git, and integration packages
docs/                  Architecture, ADRs, threat model, test evidence, and release notes
tests/                 Cross-package security and verification tests
```

## Contributing

We want contributions from developers, security researchers, documentation writers, and AI-tooling enthusiasts.

- Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, verified commands, engineering rules, and pull-request expectations.
- Use GitHub issues for reproducible bugs, feature proposals, and documentation gaps.
- Read [SECURITY.md](SECURITY.md) before reporting a vulnerability; do not disclose security issues in public tickets.

The CI workflow validates linting, type checks, unit/integration tests, and Electron end-to-end tests on Ubuntu. Contributions that alter security boundaries, shared contracts, or architecture may require an ADR and additional evidence.

## Roadmap and releases

The immediate goal is a trustworthy public preview: repeatable verification, transparent platform support, tested integrations, and a contributor-friendly project foundation. Current capabilities, known limitations, and verification status are recorded in the [release notes](docs/RELEASE_NOTES.md) and [project status](.coordination/STATUS.md).

## License and notices

Nexus AI is licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for project and third-party notices. Copyright 2026 Dayifour.
