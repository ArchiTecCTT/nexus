import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentEvent, type AgentTaskRequest, type PermissionMode } from "@nexus/contracts";
import {
  AsyncQueue,
  runCliTask,
  ClaudeCliConnector,
  CodexCliConnector,
  ConnectorRegistry,
  EventSequencer,
  GENERIC_INVOCATIONS,
  supportsReadOnly,
  claudeMcpConfig,
  claudeMcpArgs,
  codexMcpArgs,
  mcpConfigFor,
  stripAnsi,
  GenericCliConnector,
  createCodexNormalizer,
  probeCli,
  type CliSignature,
} from "../src/index.ts";

const FIX = fileURLToPath(new URL("./fixtures/", import.meta.url));
const NODE_DIR = dirname(process.execPath);

/** Dossier bin temporaire contenant de fausses CLI sous les noms attendus. */
function binDir(t: TestContext, map: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nexus-conn-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "bin"));
  for (const [name, fixture] of Object.entries(map)) {
    const target = join(dir, "bin", name);
    copyFileSync(join(FIX, fixture), target);
    chmodSync(target, 0o755);
  }
  // Les fausses CLI importent leurs fixtures par URL relative : on les copie à côté.
  for (const f of ["claude-stream-ok.jsonl", "claude-stream-not-logged-in.jsonl"])
    copyFileSync(join(FIX, f), join(dir, "bin", f));
  return dir;
}

function request(workspacePath: string, overrides: Partial<AgentTaskRequest> = {}): AgentTaskRequest {
  return {
    taskId: randomUUID(),
    projectId: randomUUID(),
    sessionId: randomUUID(),
    agentProfileId: randomUUID(),
    workspacePath,
    prompt: "Réponds pong ; ce prompt ne doit jamais apparaître dans argv",
    contextRefs: [],
    permissionsPolicyId: "manual",
    timeoutMs: 15_000,
    ...overrides,
  };
}

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const sig = (connectorId: string, name: string): CliSignature => ({
  connectorId,
  displayName: connectorId,
  binaryNames: [name],
  versionArgs: ["--version"],
  versionPattern: /(\d+\.\d+\.\d+)/,
  probeTimeoutMs: 1500,
  agent: true,
});

const modes = (m: PermissionMode) => () => m;

test("sonde : CLI absente, présente avec version, format inconnu, code non nul, blocage (AC-01, AC-14)", async (t) => {
  const dir = binDir(t, { fakecli: "fake-plain.mjs" });
  const pathEnv = `${join(dir, "bin")}:${NODE_DIR}:/usr/bin:/bin`;
  const absent = await probeCli(sig("x", "absentcli"), { pathEnv });
  assert.equal(absent.installed, false);
  assert.equal(absent.reason, "not_found_on_path");

  const ok = await probeCli(sig("hermes-cli", "fakecli"), { pathEnv });
  assert.deepEqual(
    [ok.installed, ok.version, ok.authenticated, ok.reason],
    [true, "0.18.0", undefined, "auth_not_checked"],
  );

  process.env.FAKE_VERSION = "build unknown";
  t.after(() => delete process.env.FAKE_VERSION);
  // La sonde n'hérite pas de l'environnement : FAKE_VERSION ne doit PAS être vu par la CLI.
  const isolated = await probeCli(sig("hermes-cli", "fakecli"), { pathEnv });
  assert.equal(isolated.version, "0.18.0", "la sonde ne transmet pas l'environnement du parent");

  const hangDir = binDir(t, {});
  writeFileSync(join(hangDir, "bin", "hangcli"), `#!/bin/sh\nsleep 30\n`);
  chmodSync(join(hangDir, "bin", "hangcli"), 0o755);
  const hang = await probeCli(sig("y", "hangcli"), { pathEnv: `${join(hangDir, "bin")}:/usr/bin:/bin` });
  assert.equal(hang.reason, "version_probe_timeout");

  const odd = binDir(t, {});
  writeFileSync(join(odd, "bin", "oddcli"), `#!/bin/sh\necho "no version here"\nexit 3\n`);
  chmodSync(join(odd, "bin", "oddcli"), 0o755);
  const unknown = await probeCli(sig("z", "oddcli"), { pathEnv: `${join(odd, "bin")}:/usr/bin:/bin` });
  assert.deepEqual([unknown.installed, unknown.version, unknown.reason], [true, undefined, "unknown_version_format"]);
});

test("inventaire : toutes les signatures sondées sans exception, triées, résultats conformes au contrat", async (t) => {
  const dir = binDir(t, { claude: "fake-claude.mjs" });
  // PATH isolé : seulement la fausse CLI et node (les vraies CLI installées sur la machine ne doivent pas compter).
  symlinkSync(process.execPath, join(dir, "bin", "node"));
  const registry = new ConnectorRegistry();
  const results = await registry.inventory({ pathEnv: join(dir, "bin") });
  const claude = results.find((r) => r.connectorId === "claude-cli");
  assert.equal(claude?.installed, true);
  assert.equal(claude?.version, "2.1.296");
  assert.equal(results.find((r) => r.connectorId === "codex-cli")?.installed, false);
  assert.deepEqual(
    results.map((r) => r.connectorId),
    results.map((r) => r.connectorId).sort(),
  );
});

function claude(
  t: TestContext,
  scenario: string,
  mode: PermissionMode = "manual",
  authMode: "vendor-login" | "api-key" = "vendor-login",
) {
  const dir = binDir(t, { claude: "fake-claude.mjs" });
  const record = join(dir, "record.json");
  const connector = new ClaudeCliConnector({
    probeContext: { pathEnv: `${join(dir, "bin")}:${NODE_DIR}:/usr/bin:/bin` },
    authMode,
    baseEnv: { PATH: `${NODE_DIR}:/usr/bin:/bin`, HOME: dir, FAKE_SCENARIO: scenario, FAKE_RECORD: record },
    resolvePermissionMode: modes(mode),
  });
  return { dir, record, connector };
}

test("Claude : flux nominal normalisé, séquences croissantes, événements conformes au contrat", async (t) => {
  const { dir, record, connector } = claude(t, "ok");
  await connector.probe();
  const req = request(dir);
  const events = await collect(connector.start(req, new AbortController().signal));
  assert.deepEqual(
    events.map((e) => e.kind),
    ["started", "output", "quota", "usage", "completed"],
  );
  const quota = events.find((e) => e.kind === "quota");
  assert.ok(
    quota?.kind === "quota" && quota.status === "allowed" && quota.window === "fixture" && !quota.resetsAt,
    "quota normalisé (réinitialisation 0 ignorée)",
  );
  events.forEach((e, i) => {
    assert.equal(AgentEvent.safeParse(e).success, true);
    assert.equal(e.sequence, i + 1);
    assert.equal(e.taskId, req.taskId);
  });
  const usage = events.find((e) => e.kind === "usage");
  assert.ok(usage?.kind === "usage" && usage.caveat, "coût indicatif accompagné d'un avertissement");
  const rec = JSON.parse(readFileSync(record, "utf8"));
  assert.equal(rec.stdin, req.prompt, "prompt transmis sur stdin");
  assert.ok(!rec.args.join(" ").includes("ce prompt"), "prompt jamais dans argv");
  assert.deepEqual(rec.args.slice(0, 5), ["--print", "--output-format", "stream-json", "--verbose", "--session-id"]);
  // H7 : identifiant de session NEUF à chaque lancement (sinon « Session ID already in use » d'une tâche à l'autre).
  assert.match(rec.args[5], /^[0-9a-f-]{36}$/);
  assert.notEqual(
    rec.args[5],
    req.sessionId,
    "la session Nexus (projet, agent) n'est pas réutilisée comme session CLI",
  );
  await collect(connector.start(req, new AbortController().signal));
  const again = JSON.parse(readFileSync(record, "utf8"));
  assert.notEqual(again.args[5], rec.args[5], "deux lancements, deux sessions CLI distinctes");
});

test("Claude avec validation : --restricted, dontAsk, outils limités ; environnement réduit", async (t) => {
  const { dir, record, connector } = claude(t, "ok", "manual");
  await connector.probe();
  await collect(connector.start(request(dir), new AbortController().signal));
  const rec = JSON.parse(readFileSync(record, "utf8"));
  assert.ok(rec.args.includes("--restricted"));
  assert.equal(rec.args[rec.args.indexOf("--permission-mode") + 1], "dontAsk");
  assert.ok(!rec.args.includes("Bash"));
  assert.deepEqual(rec.envKeys.filter((k: string) => !["PWD", "SHLVL", "_"].includes(k)).sort(), [
    "FAKE_RECORD",
    "FAKE_SCENARIO",
    "HOME",
    "PATH",
  ]);
});

test("Claude autonome / en sandbox : aucune question de permission (bypassPermissions), pas de --restricted", async (t) => {
  for (const mode of ["autonomous", "sandbox-auto"] as const) {
    const { dir, record, connector } = claude(t, "ok", mode, "vendor-login");
    await connector.probe();
    const events = await collect(connector.start(request(dir), new AbortController().signal));
    assert.equal(events.at(-1)?.kind, "completed");
    const rec = JSON.parse(readFileSync(record, "utf8"));
    assert.equal(rec.args[rec.args.indexOf("--permission-mode") + 1], "bypassPermissions", mode);
    assert.ok(!rec.args.includes("--restricted"), mode);
  }
});

test("Claude non connecté : échec auth_required (piège subtype success + is_error)", async (t) => {
  const { dir, connector } = claude(t, "not-logged-in");
  await connector.probe();
  const events = await collect(connector.start(request(dir), new AbortController().signal));
  const last = events.at(-1);
  assert.ok(last?.kind === "failed" && last.code === "auth_required", JSON.stringify(last));
});

test("Claude reprise : --resume avec l'identifiant natif", async (t) => {
  const { dir, record, connector } = claude(t, "ok");
  await connector.probe();
  await collect(connector.resume!("native-123", request(dir), new AbortController().signal));
  const rec = JSON.parse(readFileSync(record, "utf8"));
  assert.equal(rec.args[rec.args.indexOf("--resume") + 1], "native-123");
  assert.ok(!rec.args.includes("--session-id"));
});

test("Claude annulation en cours de flux : terminal unique `cancelled` en moins de 3 s", async (t) => {
  const { dir, connector } = claude(t, "slow");
  await connector.probe();
  const ac = new AbortController();
  const events: AgentEvent[] = [];
  const t0 = Date.now();
  for await (const e of connector.start(request(dir), ac.signal)) {
    events.push(e);
    if (e.kind === "started") ac.abort();
  }
  assert.ok(Date.now() - t0 < 3000);
  assert.deepEqual(
    events.map((e) => e.kind),
    ["started", "failed"],
  );
  assert.ok(events[1]?.kind === "failed" && events[1].code === "cancelled");
});

test("binaire non détecté : échec explicite binary_not_found", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "nexus-conn-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const c = new ClaudeCliConnector({
    probeContext: { pathEnv: dir },
    authMode: "vendor-login",
    baseEnv: {},
    resolvePermissionMode: modes("manual"),
  });
  const events = await collect(c.start(request(dir), new AbortController().signal));
  assert.ok(events[0]?.kind === "failed" && events[0].code === "binary_not_found");
});

test("Codex (fixture-only, forme documentée NON vérifiée) : normalisation et raisonnement interne non exposé", () => {
  const out: AgentEvent[] = [];
  const seq = new EventSequencer(randomUUID(), (e) => out.push(e));
  const n = createCodexNormalizer();
  for (const line of readFileSync(join(FIX, "codex-exec-documented.jsonl"), "utf8").trim().split("\n"))
    n.onStdout(line, seq);
  assert.deepEqual(
    out.map((e) => e.kind),
    ["started", "tool-request", "output", "usage", "completed"],
  );
  assert.ok(!JSON.stringify(out).includes("interne"), "le raisonnement interne n'est pas exposé (§17)");
  assert.equal(n.stats().unknown, 1, "turn.started ignoré et compté");
});

test("Codex absent : maturité beta (vérifié en réel) déclarée et échec binary_not_found", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "nexus-conn-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const c = new CodexCliConnector({
    probeContext: { pathEnv: dir },
    baseEnv: {},
    resolvePermissionMode: modes("manual"),
  });
  assert.equal(c.manifest.maturity, "beta");
  assert.equal((await c.probe()).installed, false);
  const events = await collect(c.start(request(dir), new AbortController().signal));
  assert.ok(events[0]?.kind === "failed" && events[0].code === "binary_not_found");
});

test("CLI générique : lignes stdout/stderr en output, code 0 terminé, code non nul en échec", async (t) => {
  const dir = binDir(t, { fakecli: "fake-plain.mjs" });
  const make = (exit: string) =>
    new GenericCliConnector(
      { signature: sig("hermes-cli", "fakecli"), args: [], promptVia: "stdin" },
      {
        probeContext: { pathEnv: `${join(dir, "bin")}:${NODE_DIR}:/usr/bin:/bin` },
        baseEnv: { PATH: `${NODE_DIR}:/usr/bin:/bin`, FAKE_EXIT: exit },
      },
    );
  const ok = make("0");
  await ok.probe();
  const events = await collect(ok.start(request(dir), new AbortController().signal));
  assert.equal(events[0]?.kind, "started");
  assert.equal(events.at(-1)?.kind, "completed");
  assert.equal(events.filter((e) => e.kind === "output").length, 3);
  const ko = make("2");
  await ko.probe();
  const failed = await collect(ko.start(request(dir), new AbortController().signal));
  assert.ok(failed.at(-1)?.kind === "failed");
  assert.equal(ok.manifest.maturity, "beta");
});

test(
  "Claude RÉEL (opt-in NEXUS_REAL_CLAUDE=1) : mode manuel, prompt inoffensif, flux complet",
  { skip: process.env.NEXUS_REAL_CLAUDE !== "1" && "opt-in" },
  async (t) => {
    const ws = mkdtempSync(join(tmpdir(), "nexus-real-claude-"));
    t.after(() => rmSync(ws, { recursive: true, force: true }));
    const c = new ClaudeCliConnector({
      probeContext: { pathEnv: process.env.PATH ?? "" },
      authMode: "vendor-login",
      baseEnv: { HOME: process.env.HOME ?? "", PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
      resolvePermissionMode: modes("manual"),
    });
    const probe = await c.probe();
    assert.equal(probe.installed, true);
    const events = await collect(
      c.start(request(ws, { prompt: "Reply with exactly the word: pong" }), new AbortController().signal),
    );
    assert.equal(events[0]?.kind, "started");
    assert.equal(events.at(-1)?.kind, "completed", JSON.stringify(events.at(-1)));
    assert.ok(events.some((e) => e.kind === "output" && /pong/i.test(e.text)));
  },
);

test("CLI générique : invocation non interactive, auto-approbation dans les modes qui écrivent, lecture seule réelle ou refusée", async (t) => {
  const dir = binDir(t, { fakecli: "fake-plain.mjs" });
  const seen: string[][] = [];
  const make = (id: string) =>
    new GenericCliConnector(
      { signature: sig(id, "fakecli"), ...GENERIC_INVOCATIONS[id]! },
      {
        probeContext: { pathEnv: `${join(dir, "bin")}:${NODE_DIR}:/usr/bin:/bin` },
        baseEnv: { PATH: `${NODE_DIR}:/usr/bin:/bin` },
        runner: async (o) => {
          seen.push([...o.args]);
          assert.equal(o.stdin, undefined, "pas de consigne sur stdin (la CLI ouvrirait son mode interactif)");
          return {
            exitCode: 0,
            signal: null,
            timedOut: false,
            cancelled: false,
            outputLimitExceeded: false,
            durationMs: 1,
          };
        },
      },
    );
  const c = make("hermes-cli");
  await c.probe();
  await collect(
    c.start(request(dir, { prompt: "Fais X", permissionsPolicyId: "manual" }), new AbortController().signal),
  );
  await collect(
    c.start(request(dir, { prompt: "Fais Y", permissionsPolicyId: "autonomous" }), new AbortController().signal),
  );
  // Mode « validation » : worktree isolé + revue humaine, la CLI travaille sans question (personne pour répondre).
  assert.deepEqual(seen, [
    ["chat", "-Q", "--yolo", "-q", "Fais X"],
    ["chat", "-Q", "--yolo", "-q", "Fais Y"],
  ]);
  // Hermes n'a pas de mode lecture seule : refus explicite, jamais une exécution qui pourrait écrire.
  assert.equal(c.readOnlySupported, false);
  assert.equal(supportsReadOnly(c), false);
  const ro = await collect(
    c.start(request(dir, { prompt: "Relis", permissionsPolicyId: "read-only" }), new AbortController().signal),
  );
  const last = ro.at(-1);
  assert.ok(last?.kind === "failed" && last.code === "policy_denied");
  assert.equal(seen.length, 2, "aucun processus lancé en lecture seule non supportée");
  // Gemini : mode plan (lecture seule) au lieu de --yolo.
  const g = make("gemini-cli");
  await g.probe();
  assert.equal(supportsReadOnly(g), true);
  await collect(
    g.start(request(dir, { prompt: "Relis", permissionsPolicyId: "read-only" }), new AbortController().signal),
  );
  assert.deepEqual(seen.at(-1), ["--skip-trust", "--approval-mode", "plan", "--prompt", "Relis"]);
});

test("bus de l'équipe : Claude reçoit une configuration temporaire, sans jeton dans argv ; Codex est désactivé jusqu'à une intégration sûre", () => {
  const s = [{ name: "nexus", command: "/usr/bin/node", args: ["/x/mcp.cjs"], env: { NEXUS_BUS_TOKEN: "t0k" } }];
  const mcp = claudeMcpConfig(s, "manual")!;
  const cl = mcp.args;
  assert.equal(cl[0], "--mcp-config");
  assert.ok(!cl.join(" ").includes("t0k"), "le jeton ne figure jamais dans argv");
  assert.deepEqual(JSON.parse(readFileSync(cl[1]!, "utf8")).mcpServers.nexus, {
    command: "/usr/bin/node",
    args: ["/x/mcp.cjs"],
    env: { NEXUS_BUS_TOKEN: "t0k" },
  });
  assert.deepEqual(cl.slice(2), ["--allowedTools", "mcp__nexus"], "outils autorisés en mode avec validation");
  mcp.cleanup();
  assert.throws(() => readFileSync(cl[1]!), "configuration temporaire supprimée");
  assert.deepEqual(claudeMcpConfig(s, "autonomous")!.args.length, 2);
  assert.deepEqual(claudeMcpArgs(undefined, "manual"), []);
  assert.deepEqual(
    codexMcpArgs(s),
    [],
    "Codex ne reçoit pas le jeton tant qu'un transport sans argv n'est pas vérifié",
  );
  for (const [id, env] of [
    ["gemini-cli", "GEMINI_CLI_SYSTEM_SETTINGS_PATH"],
    ["qwen-cli", "QWEN_CODE_SYSTEM_SETTINGS_PATH"],
    ["opencode-cli", "OPENCODE_CONFIG"],
  ] as const) {
    const m = mcpConfigFor(id, s)!;
    const file = m.env[env]!;
    const cfg = JSON.parse(readFileSync(file, "utf8"));
    assert.ok(
      id === "opencode-cli" ? cfg.mcp.nexus.command[0] === "/usr/bin/node" : cfg.mcpServers.nexus.trust === true,
      id,
    );
    m.cleanup();
    assert.throws(() => readFileSync(file), "fichier temporaire supprimé");
  }
  assert.equal(mcpConfigFor("hermes-cli", s), undefined);
  assert.equal(stripAnsi("\x1b[0m> build\x1b[32m ok\x1b[0m"), "> build ok");
});

test("AsyncQueue : `return()` (consommateur qui abandonne) libère la file et prévient le producteur", async () => {
  let stopped = 0;
  const q = new AsyncQueue<number>({ onReturn: () => stopped++ });
  q.push(1);
  q.push(2);
  for await (const n of q) {
    assert.equal(n, 1);
    break; // appelle return()
  }
  assert.equal(stopped, 1, "le producteur est prévenu (ex. arrêt de la CLI)");
  q.push(3);
  const it = q[Symbol.asyncIterator]();
  assert.deepEqual(await it.next(), { value: undefined, done: true }, "rien ne s'accumule après abandon");
});

test("runCliTask : une exception du normaliseur sur une ligne ne devient jamais une uncaughtException", async (t) => {
  const dir = binDir(t, {});
  const events = await collect(
    runCliTask({
      taskId: randomUUID(),
      file: "/bin/sh",
      args: [],
      cwd: dir,
      env: {},
      timeoutMs: 5000,
      signal: new AbortController().signal,
      normalizer: {
        onStdout(line, seq) {
          if (line === "boom") throw new Error("parser cassé");
          seq.emit({ kind: "output", text: line, channel: "stdout" });
        },
        finish(_exit, seq) {
          seq.emit({ kind: "completed", resultRef: "x" });
        },
      },
      runner: async (o) => {
        o.onLine?.("boom", "stdout");
        o.onLine?.("ok", "stdout");
        return {
          exitCode: 0,
          signal: null,
          timedOut: false,
          cancelled: false,
          outputLimitExceeded: false,
          durationMs: 1,
        };
      },
    }),
  );
  assert.deepEqual(
    events.map((e) => e.kind),
    ["output", "completed"],
  );
});
