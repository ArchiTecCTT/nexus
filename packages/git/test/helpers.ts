// Fixtures : vrais dépôts git temporaires dans os.tmpdir(), HOME isolé (jamais la config globale de l'utilisateur).
// Les commandes de préparation passent elles aussi par runProcess (tableau d'arguments, environnement explicite).
import type { TestContext } from "node:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runProcess } from "@nexus/process-supervisor";
import { GitBroker, locateGit } from "../src/index.ts";

export const GIT = locateGit("/usr/bin:/bin:/usr/local/bin");
export const AUTHOR = { name: "Nexus Test", email: "test@nexus.invalid" };

export type Fixture = { root: string; repo: string; home: string; wtRoot: string; broker: GitBroker };

/** Exécute git pour préparer les fixtures ; lève si le code de sortie n'est pas 0. */
export async function g(fx: Pick<Fixture, "home">, cwd: string, ...args: string[]): Promise<string> {
  let out = "";
  let err = "";
  const r = await runProcess({
    file: GIT!,
    args,
    cwd,
    env: { HOME: fx.home, LANG: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
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

export async function makeRepo(t: TestContext): Promise<Fixture> {
  if (!GIT) throw new Error("git introuvable");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "nexus-git-test-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "home");
  const repo = join(root, "repo");
  const wtRoot = join(root, "worktrees");
  mkdirSync(home);
  mkdirSync(repo);
  const fx = { root, repo, home, wtRoot, broker: new GitBroker({ gitPath: GIT, home, worktreesRoot: wtRoot }) };
  await g(fx, repo, "init", "--quiet", "-b", "main");
  // Identité configurée LOCALEMENT au dépôt de test.
  await g(fx, repo, "config", "user.name", AUTHOR.name);
  await g(fx, repo, "config", "user.email", AUTHOR.email);
  await g(fx, repo, "config", "commit.gpgsign", "false");
  write(repo, "README.md", "# fixture\n");
  write(repo, "src/app.txt", "ligne 1\nligne 2\nligne 3\n");
  await g(fx, repo, "add", "-A");
  await g(fx, repo, "commit", "--quiet", "-m", "initial");
  return fx;
}

export async function head(fx: Fixture, cwd: string): Promise<string> {
  return (await g(fx, cwd, "rev-parse", "HEAD")).trim();
}
