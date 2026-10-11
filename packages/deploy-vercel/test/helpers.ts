// Fixtures : projets factices (Next.js, Vite, Express), fausse CLI vercel qui enregistre argv/env/cwd,
// vrai ApprovalService via un NexusCore temporaire. Aucun accès réseau.
import type { TestContext } from "node:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { SensitiveAction } from "@nexus/contracts";
import { NexusCore, OWNER, SYSTEM } from "@nexus/core";

export function write(dir: string, rel: string, content: string): void {
  const p = join(dir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

export type Env = { root: string; core: NexusCore; projectId: string; clock: { now: number } };

export async function makeEnv(t: TestContext): Promise<Env> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "nexus-vercel-test-")));
  mkdirSync(join(root, "home"));
  mkdirSync(join(root, "work"));
  const clock = { now: Date.parse("2026-10-11T10:00:00.000Z") };
  const core = await NexusCore.open({ dbFile: join(root, "nexus.db"), clock: () => new Date(clock.now).toISOString() });
  t.after(async () => {
    await core.close();
    rmSync(root, { recursive: true, force: true });
  });
  const project = await core.projects.create({ name: "Vercel", rootPath: join(root, "work") }, OWNER);
  return { root, core, projectId: project.projectId, clock };
}

export async function approval(
  env: Env,
  action: SensitiveAction,
  plan: unknown,
  opts: { decision?: "allow" | "deny"; ttlMs?: number } = {},
): Promise<string> {
  const req = await env.core.approvals.request(
    { action, projectId: env.projectId, summary: `test ${action}`, plan, ttlMs: opts.ttlMs ?? 60_000 },
    SYSTEM,
  );
  await env.core.approvals.respond(req.approvalId, opts.decision ?? "allow", OWNER);
  return req.approvalId;
}

export function nextProject(root: string): string {
  const dir = join(root, "work", "next-app");
  write(
    dir,
    "package.json",
    JSON.stringify({
      name: "next-app",
      scripts: { dev: "next dev", build: "next build", start: "next start" },
      dependencies: { next: "15.0.0", react: "19.0.0", "react-dom": "19.0.0" },
    }),
  );
  write(dir, ".env.example", "# gabarit\nDATABASE_URL=postgres://exemple\nexport NEXT_PUBLIC_API=\n");
  write(dir, ".env.local", "DATABASE_URL=postgres://user:VraiMotDePasseLocal@db/prod\n");
  write(dir, "pages/index.js", "export default () => null;\n");
  return dir;
}

export function viteProject(root: string): string {
  const dir = join(root, "work", "vite-app");
  write(
    dir,
    "package.json",
    JSON.stringify({
      name: "vite-app",
      scripts: { build: "vite build" },
      devDependencies: { vite: "6.0.0", "@vitejs/plugin-react": "4.0.0" },
    }),
  );
  write(dir, "vercel.json", JSON.stringify({ outputDirectory: "dist", env: { VITE_API_URL: "valeur-ignorée" } }));
  write(dir, "index.html", "<!doctype html>\n");
  return dir;
}

export function expressProject(root: string): string {
  const dir = join(root, "work", "express-api");
  write(
    dir,
    "package.json",
    JSON.stringify({
      name: "express-api",
      scripts: { start: "node server.js" },
      dependencies: { express: "5.0.0", "better-sqlite3": "11.0.0", ws: "8.0.0" },
    }),
  );
  write(dir, "server.js", "require('express')().listen(3000);\n");
  return dir;
}

export type FakeVercel = { path: string; argv: () => string[][]; env: () => string[]; cwd: () => string[] };

/**
 * Fausse CLI vercel : enregistre argv (un argument par ligne, appels séparés), env et cwd de chaque appel.
 * Elle affiche sur stderr un journal contenant volontairement le jeton reçu (pour vérifier l'expurgation),
 * puis l'URL du déploiement seule sur stdout. `exitCode` simule un échec.
 */
export function fakeVercel(root: string, opts: { exitCode?: number; stderr?: string } = {}): FakeVercel {
  const dir = join(root, "fake-vercel");
  mkdirSync(join(dir, "bin"), { recursive: true });
  const path = join(dir, "bin", "vercel");
  const script = `#!/bin/sh
LOG='${dir}'
printf '%s\\n' '--CALL--' >> "$LOG/argv"
for a in "$@"; do printf '%s\\n' "$a" >> "$LOG/argv"; done
printf '%s\\n' '--CALL--' >> "$LOG/env"
/usr/bin/env >> "$LOG/env"
printf '%s\\n' "$PWD" >> "$LOG/cwd"
echo "Vercel CLI 99.0.0 (fake)" >&2
echo "Debug: token=$VERCEL_TOKEN" >&2
${opts.stderr ? `echo '${opts.stderr}' >&2` : ""}
if [ ${opts.exitCode ?? 0} -ne 0 ]; then echo "Error: build failed" >&2; exit ${opts.exitCode ?? 0}; fi
PROD=0
for a in "$@"; do [ "$a" = "--prod" ] && PROD=1; done
if [ $PROD -eq 1 ]; then
  echo "Production: https://app-prod.vercel.app [12s]" >&2
  echo "https://app-prod.vercel.app"
else
  echo "Preview: https://app-git-abc123-team.vercel.app [9s]" >&2
  echo "https://app-git-abc123-team.vercel.app"
fi
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
  const calls = (f: string) =>
    read(f)
      .split("--CALL--\n")
      .filter(Boolean)
      .map((c) => c.split("\n").filter((l) => l !== ""));
  return {
    path,
    argv: () => calls("argv"),
    env: () => calls("env").map((c) => c.join("\n")),
    cwd: () => read("cwd").split("\n").filter(Boolean),
  };
}
