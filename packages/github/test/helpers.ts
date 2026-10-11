// Fixtures : vrai dépôt git temporaire + dépôt nu local comme remote (file://), HOME isolé, fausse CLI gh,
// vrai ApprovalService via un NexusCore temporaire. Aucun accès réseau, aucune configuration globale touchée.
import type { TestContext } from "node:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { SensitiveAction } from "@nexus/contracts";
import { NexusCore, OWNER, SYSTEM } from "@nexus/core";
import { locateGit } from "@nexus/git";
import { runProcess, type RunOptions, type RunResult } from "@nexus/process-supervisor";
import { GitHubBroker, type GitHubBrokerOptions } from "../src/index.ts";

export const GIT = locateGit("/usr/bin:/bin:/usr/local/bin");
export const PATH_ENV = "/usr/bin:/bin";

export type Fixture = {
  root: string;
  repo: string;
  bare: string;
  home: string;
  core: NexusCore;
  projectId: string;
  /** Horloge contrôlée du NexusCore (ms depuis l'epoch). */
  clock: { now: number };
  /** Tous les appels de processus effectués par le broker (argv complet). */
  calls: { file: string; args: string[]; env: Record<string, string> }[];
  broker: (extra?: Partial<GitHubBrokerOptions>) => GitHubBroker;
};

export async function g(home: string, cwd: string, ...args: string[]): Promise<string> {
  let out = "";
  let err = "";
  const r = await runProcess({
    file: GIT!,
    args,
    cwd,
    env: { HOME: home, LANG: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
    timeoutMs: 20_000,
    onChunk: (c, ch) => (ch === "stdout" ? (out += c) : (err += c)),
  });
  if (r.exitCode !== 0) throw new Error(`fixture git ${args.join(" ")} -> ${r.exitCode}: ${err}`);
  return out;
}

export function write(dir: string, rel: string, content: string): void {
  const p = join(dir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

export async function commit(fx: Fixture, rel: string, content: string, message: string): Promise<string> {
  write(fx.repo, rel, content);
  await g(fx.home, fx.repo, "add", "-A");
  await g(fx.home, fx.repo, "commit", "--quiet", "-m", message);
  return (await g(fx.home, fx.repo, "rev-parse", "HEAD")).trim();
}

/** Tête d'une branche dans le dépôt nu, ou null si absente. */
export async function bareHead(fx: Fixture, branch: string): Promise<string | null> {
  try {
    return (await g(fx.home, fx.bare, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`)).trim() || null;
  } catch {
    return null;
  }
}

export async function makeFixture(t: TestContext): Promise<Fixture> {
  if (!GIT) throw new Error("git introuvable");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "nexus-github-test-")));
  const home = join(root, "home");
  const repo = join(root, "repo");
  const bare = join(root, "remote.git");
  mkdirSync(home);
  mkdirSync(repo);
  await g(home, root, "init", "--quiet", "--bare", bare);
  await g(home, repo, "init", "--quiet", "-b", "main");
  await g(home, repo, "config", "user.name", "Nexus Test");
  await g(home, repo, "config", "user.email", "test@nexus.invalid");
  await g(home, repo, "config", "commit.gpgsign", "false");
  await g(home, repo, "remote", "add", "origin", `file://${bare}`);
  write(repo, "README.md", "# fixture\n");
  await g(home, repo, "add", "-A");
  await g(home, repo, "commit", "--quiet", "-m", "initial");
  await g(home, repo, "push", "--quiet", "origin", "main");
  await g(home, repo, "checkout", "--quiet", "-b", "feature/x");

  const clock = { now: Date.parse("2026-10-11T10:00:00.000Z") };
  const core = await NexusCore.open({ dbFile: join(root, "nexus.db"), clock: () => new Date(clock.now).toISOString() });
  t.after(async () => {
    await core.close();
    rmSync(root, { recursive: true, force: true });
  });
  const project = await core.projects.create({ name: "Fixture", rootPath: repo }, OWNER);
  const calls: Fixture["calls"] = [];
  const runner = (opts: RunOptions): Promise<RunResult> => {
    calls.push({ file: opts.file, args: [...opts.args], env: { ...opts.env } });
    return runProcess(opts);
  };
  const fx: Fixture = {
    root,
    repo,
    bare,
    home,
    core,
    projectId: project.projectId,
    clock,
    calls,
    broker: (extra = {}) =>
      new GitHubBroker({
        gitPath: GIT,
        home,
        pathEnv: PATH_ENV,
        approvals: core.approvals,
        allowedProtocols: ["file"],
        runner,
        ...extra,
      }),
  };
  return fx;
}

/** Demande une approbation pour `plan` et la décide en tant qu'utilisateur (OWNER). */
export async function approval(
  fx: Fixture,
  action: SensitiveAction,
  plan: unknown,
  opts: { decision?: "allow" | "deny"; ttlMs?: number } = {},
): Promise<string> {
  const req = await fx.core.approvals.request(
    { action, projectId: fx.projectId, summary: `test ${action}`, plan, ttlMs: opts.ttlMs ?? 60_000 },
    SYSTEM,
  );
  await fx.core.approvals.respond(req.approvalId, opts.decision ?? "allow", OWNER);
  return req.approvalId;
}

export type FakeCli = { path: string; dir: string; argv: () => string[][]; stdin: () => string; env: () => string };

/**
 * Fausse CLI gh : enregistre argv (un argument par ligne, appels séparés par `--CALL--`), stdin et env.
 * `authOutput` : texte écrit sur stderr par `gh auth status` ; `authCode` : son code de sortie.
 */
export function fakeGh(root: string, opts: { authOutput?: string; authCode?: number; prCode?: number } = {}): FakeCli {
  const dir = join(root, "fake-gh");
  mkdirSync(join(dir, "bin"), { recursive: true });
  const path = join(dir, "bin", "gh");
  writeFileSync(
    join(dir, "auth.txt"),
    opts.authOutput ?? "github.com\n  ✓ Logged in to github.com account octo (keyring)\n  - Token: gho_************\n",
  );
  const script = `#!/bin/sh
LOG='${dir}'
printf '%s\\n' '--CALL--' >> "$LOG/argv"
for a in "$@"; do printf '%s\\n' "$a" >> "$LOG/argv"; done
/usr/bin/env > "$LOG/env"
case "$1" in
  --version) echo "gh version 2.99.0 (2026-01-01)"; echo "https://github.com/cli/cli/releases/tag/v2.99.0" ;;
  auth) /bin/cat "$LOG/auth.txt" >&2; exit ${opts.authCode ?? 0} ;;
  pr)
    /bin/cat > "$LOG/stdin"
    if [ ${opts.prCode ?? 0} -ne 0 ]; then echo "error" >&2; exit ${opts.prCode ?? 0}; fi
    echo "Creating pull request for feature/x into main in octo/repo" >&2
    echo "https://github.com/octo/repo/pull/42" ;;
esac
exit 0
`;
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  const read = (f: string): string => {
    try {
      return readFileSync(join(dir, f), "utf8");
    } catch {
      return "";
    }
  };
  return {
    path,
    dir,
    argv: () =>
      read("argv")
        .split("--CALL--\n")
        .filter(Boolean)
        .map((c) => c.split("\n").filter((l, i, a) => i < a.length - 1 || l !== "")),
    stdin: () => read("stdin"),
    env: () => read("env"),
  };
}
