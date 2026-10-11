// Exécution d'un agent CLI quand l'utilisateur active la sandbox (mode « Autonome en sandbox »).
// - Fichiers : seul le dossier de travail est visible (plus le binaire du CLI, en lecture seule).
// - Connexion : la session du CLI (ex. ~/.claude) est montée dans SA sandbox, pour qu'il fonctionne (choix de l'utilisateur).
// - Réseau : aucun accès direct ; un proxy hôte n'autorise que les domaines du fournisseur (+ ceux ajoutés dans les
//   réglages). Un pont socat expose ce proxy dans la sandbox, et HTTPS_PROXY y pointe.
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { SandboxProfile } from "@nexus/contracts";
import type { RunOptions, RunResult } from "@nexus/process-supervisor";
import {
  createSandboxedRunner,
  sandboxInvocation,
  startEgressProxy,
  writeSeccompFile,
  type SandboxCapabilities,
} from "@nexus/sandbox";

const BRIDGE_PORT = 3128;
const SOCAT = "/usr/bin/socat";

/** Domaines nécessaires à chaque fournisseur (hôte:port) et dossiers de session du CLI (relatifs au HOME). */
export const PROVIDER_PROFILES: Record<
  string,
  {
    allow: string[];
    credentialPaths: string[];
    /** Fichiers d'exécution du CLI hors de son binaire (relatifs au HOME), visibles en LECTURE SEULE au même chemin. */
    runtimePaths?: string[];
    env?: Record<string, string>;
  }
> = {
  "claude-cli": {
    allow: ["api.anthropic.com:443", "claude.ai:443", "console.anthropic.com:443", "platform.claude.com:443"],
    credentialPaths: [".claude", ".claude.json"],
    env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_AUTOUPDATER: "1" },
  },
  "codex-cli": {
    allow: ["api.openai.com:443", "chatgpt.com:443", "auth.openai.com:443", "ab.chatgpt.com:443"],
    credentialPaths: [".codex"],
  },
  "gemini-cli": {
    allow: [
      "generativelanguage.googleapis.com:443",
      "oauth2.googleapis.com:443",
      "cloudcode-pa.googleapis.com:443",
      "www.googleapis.com:443",
      "play.googleapis.com:443",
    ],
    credentialPaths: [".gemini"],
  },
  // Domaines par défaut des fournisseurs usuels ; un domaine manquant est signalé (« Autoriser ce domaine »).
  "opencode-cli": {
    allow: [
      "opencode.ai:443",
      "models.opencode.ai:443",
      "models.dev:443",
      "registry.npmjs.org:443",
      "api.openai.com:443",
      "api.anthropic.com:443",
      "openrouter.ai:443",
    ],
    credentialPaths: [".config/opencode", ".local/share/opencode"],
  },
  "qwen-cli": {
    allow: ["chat.qwen.ai:443", "portal.qwen.ai:443", "dashscope.aliyuncs.com:443", "dashscope-intl.aliyuncs.com:443"],
    credentialPaths: [".qwen"],
  },
  "hermes-cli": {
    allow: [
      "inference-api.nousresearch.com:443",
      "portal.nousresearch.com:443",
      "openrouter.ai:443",
      "api.openai.com:443",
      "chatgpt.com:443",
      "auth.openai.com:443",
    ],
    credentialPaths: [".hermes"],
    // Le lanceur ~/.local/bin/hermes exécute l'environnement Python ~/.hermes/hermes-agent (interpréteur géré par uv).
    runtimePaths: [".hermes/hermes-agent", ".local/share/uv/python"],
  },
};

export function sandboxNetworkAvailable(): boolean {
  return existsSync(SOCAT);
}

const fail = (spawnError: string): RunResult => ({
  exitCode: null,
  signal: null,
  timedOut: false,
  cancelled: false,
  outputLimitExceeded: false,
  spawnError,
  durationMs: 0,
});

type SandboxCtx = {
  caps: SandboxCapabilities;
  connectorId: string;
  home: string;
  protectEnvFiles: boolean;
  extraAllow: readonly string[];
  /** Dossiers supplémentaires inscriptibles (ex. fichier de hooks de statut), montés au même chemin. */
  extraWritable?: readonly string[];
  extraEnv?: Record<string, string>;
  /** Connexion refusée par le proxy (domaine non autorisé, adresse privée…). */
  onDenied?: (target: string, reason: string) => void;
  /** PATH de l'utilisateur : sert à retrouver SON Node pour les CLI écrites en Node (codex, gemini, qwen…). */
  pathEnv?: string;
};

/** Première ligne d'un fichier (shebang), lue sur 200 octets au plus. */
function shebang(file: string): string {
  try {
    const fd = openSync(file, "r");
    const buf = Buffer.alloc(200);
    const n = readSync(fd, buf, 0, 200, 0);
    closeSync(fd);
    const line = buf.subarray(0, n).toString("utf8").split("\n")[0] ?? "";
    return line.startsWith("#!") ? line : "";
  } catch {
    return "";
  }
}

function onPath(name: string, pathEnv: string | undefined): string | undefined {
  for (const d of (pathEnv ?? "").split(":")) {
    if (!d.startsWith("/")) continue;
    const p = join(d, name);
    if (existsSync(p)) return realpathSync(p);
  }
  return undefined;
}

/** Prépare le profil, le proxy réseau et le lanceur interne d'une exécution sandboxée. */
async function prepare(file: string, cwd: string, ctx: SandboxCtx) {
  const profileFor = PROVIDER_PROFILES[ctx.connectorId] ?? { allow: [], credentialPaths: [] };
  const real = realpathSync(file);
  const binDir = dirname(real);
  const binds: Array<[string, string]> = [[binDir, binDir]];
  // Paquet npm du CLI (ses dépendances et binaires natifs sont à côté du script) : visible en lecture seule.
  const nm = real.lastIndexOf("/node_modules/");
  if (nm > 0) binds.push([real.slice(0, nm + 13), real.slice(0, nm + 13)]);
  for (const p of profileFor.runtimePaths ?? []) {
    const abs = join(ctx.home, p);
    if (existsSync(abs)) binds.push([abs, abs]);
  }
  // CLI écrit en Node : le Node de l'utilisateur (et non celui du système, souvent trop ancien) en tête du PATH.
  let nodeBinDir: string | undefined;
  if (/\bnode\b/.test(shebang(real))) {
    const node = onPath("node", ctx.pathEnv);
    if (node && !node.startsWith("/usr/")) {
      nodeBinDir = dirname(node);
      binds.push([nodeBinDir, nodeBinDir]);
    }
  }

  const allow = [...new Set([...profileFor.allow, ...ctx.extraAllow])];
  const useNetwork = allow.length > 0 && sandboxNetworkAvailable();
  const sockDir = mkdtempSync(join(tmpdir(), "nexus-egress-"));
  const proxy = useNetwork
    ? await startEgressProxy({
        socketPath: join(sockDir, "egress.sock"),
        allow,
        onDecision: (d) => d.decision === "deny" && ctx.onDenied?.(d.target ?? "inconnu", d.reason ?? "refusé"),
      })
    : undefined;
  // Session du CLI montée en lecture-écriture dans le HOME de la sandbox (le CLI y rafraîchit ses jetons).
  const credentialBinds = profileFor.credentialPaths
    .map((p) => [join(ctx.home, p), join("/home/agent", p)] as [string, string])
    .filter(([src]) => existsSync(src));
  const profile: SandboxProfile = {
    workspace: cwd,
    readOnlyBinds: binds,
    writableBinds: [...credentialBinds, ...(ctx.extraWritable ?? []).map((d) => [d, d] as [string, string])],
    protectEnvFiles: ctx.protectEnvFiles,
    network: proxy ? { mode: "proxy", allow } : { mode: "none" },
    env: {
      PATH: `${nodeBinDir ? `${nodeBinDir}:` : ""}${binDir}:/usr/local/bin:/usr/bin:/bin`,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      ...profileFor.env,
      ...ctx.extraEnv,
      ...(proxy && {
        HTTPS_PROXY: `http://127.0.0.1:${BRIDGE_PORT}`,
        HTTP_PROXY: `http://127.0.0.1:${BRIDGE_PORT}`,
        NO_PROXY: "localhost,127.0.0.1",
        NODE_USE_ENV_PROXY: "1",
      }),
    },
    limits: ctx.caps.cgroups ? { memoryMaxBytes: 8 * 1024 * 1024 * 1024, tasksMax: 1024 } : {},
  };
  // Lanceur dans la sandbox : démarre le pont socat (si réseau), attend qu'il écoute, puis exécute le CLI.
  // Le pont ne doit hériter d'aucun flux : sinon il garderait stdout ouvert après la fin du CLI (constaté).
  const inner = proxy
    ? `${SOCAT} TCP-LISTEN:${BRIDGE_PORT},bind=127.0.0.1,fork,reuseaddr UNIX-CONNECT:"$NEXUS_EGRESS_SOCKET" </dev/null >/dev/null 2>&1 &
for i in $(seq 1 50); do ${SOCAT} -u /dev/null TCP:127.0.0.1:${BRIDGE_PORT} 2>/dev/null && break; sleep 0.05; done
exec "$@"`
    : `exec "$@"`;
  const cleanup = async () => {
    await proxy?.close();
    rmSync(sockDir, { recursive: true, force: true });
  };
  return { profile, proxy, inner, cleanup };
}

export async function runInSandbox(o: RunOptions, ctx: SandboxCtx): Promise<RunResult> {
  let prepared: Awaited<ReturnType<typeof prepare>> | undefined;
  try {
    prepared = await prepare(o.file, o.cwd, ctx);
    const run = createSandboxedRunner(
      prepared.profile,
      ctx.caps,
      prepared.proxy ? { egressSocketPath: prepared.proxy.socketPath } : {},
    );
    return await run({
      ...o,
      file: "/bin/sh",
      args: ["-c", prepared.inner, "nexus-launcher", realpathSync(o.file), ...o.args],
    });
  } catch (e) {
    return fail(`sandbox_error:${(e as Error).message}`.slice(0, 200));
  } finally {
    await prepared?.cleanup();
  }
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * Prépare un lancement sandboxé pour un terminal PTY interactif : script lanceur qui ouvre le filtre seccomp sur le
 * descripteur 3 puis exécute systemd-run/bwrap. Renvoie la commande à lancer dans le PTY et le nettoyage à faire à sa fin.
 */
export async function prepareInteractiveSandbox(
  file: string,
  args: readonly string[],
  cwd: string,
  ctx: SandboxCtx,
): Promise<{ file: string; args: string[]; env: Record<string, string>; cleanup: () => Promise<void> }> {
  const prepared = await prepare(file, cwd, ctx);
  const dir = mkdtempSync(join(tmpdir(), "nexus-pty-sandbox-"));
  try {
    const seccomp = writeSeccompFile(dir);
    const inv = sandboxInvocation(
      prepared.profile,
      ctx.caps,
      prepared.proxy ? { egressSocketPath: prepared.proxy.socketPath } : {},
    );
    const script = [
      "#!/bin/sh",
      `exec 3<${shq(seccomp)}`,
      `exec ${[...inv.argv, "/bin/sh", "-c", prepared.inner, "nexus-launcher", realpathSync(file), ...args].map(shq).join(" ")}`,
      "",
    ].join("\n");
    const launcher = join(dir, "launch.sh");
    writeFileSync(launcher, script, { mode: 0o700 });
    return {
      file: "/bin/sh",
      args: [launcher],
      env: inv.env,
      cleanup: async () => {
        await prepared.cleanup();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  } catch (e) {
    await prepared.cleanup();
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

export function ensureDir(p: string): string {
  mkdirSync(p, { recursive: true });
  return p;
}
