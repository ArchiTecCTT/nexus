// Adaptateur CLI générique (FR-005) pour les CLI sans flux structuré vérifié (Gemini, Hermes, OpenCode, Qwen…).
// Chaque ligne de sortie devient un événement `output` ; un code de sortie 0 termine la tâche. Maturité `beta` :
// aucune capacité n'est revendiquée au-delà de « chat » tant qu'elle n'a pas été testée contre la version réelle.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentConnector, AgentEvent, AgentTaskRequest, ConnectorManifest, ProbeResult } from "@nexus/contracts";
import { probeCli, type ProbeContext, type Runner } from "../probe.ts";
import type { CliSignature } from "../signatures.ts";
import { refuse } from "./claude.ts";
import { runCliTask, type OutputNormalizer } from "./run-cli.ts";

export type GenericCliConfig = {
  signature: CliSignature;
  /** Arguments fixes. Le prompt passe sur stdin ou en argument distinct (jamais via un shell, donc jamais interprété). */
  args: readonly string[];
  promptVia: "stdin" | "last-arg";
  /** Option qui précède le prompt en argument (ex. `-q`, `-p`). */
  promptFlag?: string;
  /** Arguments ajoutés dans les modes sans validation (autonome, sandbox) : ex. `--yolo`. */
  freeArgs?: readonly string[];
};

/**
 * Invocation non interactive des CLI connues. Sans elle, une CLI lancée sans terminal ouvre son mode interactif,
 * lit la consigne sur stdin puis s'arrête à la fin de l'entrée sans rien faire (constaté avec Hermes).
 */
export const GENERIC_INVOCATIONS: Record<string, Omit<GenericCliConfig, "signature">> = {
  // Vérifié en réel (Hermes Agent 0.18) : fichier créé, code 0.
  "hermes-cli": { args: ["chat", "-Q"], promptVia: "last-arg", promptFlag: "-q", freeArgs: ["--yolo"] },
  // Vérifié en réel (OpenCode 1.19) : fichier créé, code 0.
  "opencode-cli": { args: ["run"], promptVia: "last-arg" },
  // Options vérifiées dans l'aide des versions installées (Gemini CLI 0.63, Qwen Code 0.25) ; exécution réelle
  // en attente de la connexion de l'utilisateur (sans connexion : code 41 pour Gemini, 1 pour Qwen).
  // `--skip-trust` : sans lui, Gemini ignore `--yolo` dans un dossier « non approuvé » et n'écrit rien (ouvrir le
  // projet dans Nexus et y lancer l'agent vaut approbation).
  "gemini-cli": { args: ["--skip-trust"], promptVia: "last-arg", promptFlag: "--prompt", freeArgs: ["--yolo"] },
  "qwen-cli": { args: [], promptVia: "last-arg", promptFlag: "--", freeArgs: ["--yolo"] },
};

/** Normaliseur texte : chaque ligne devient un événement `output` ; en cas d'échec, les dernières lignes d'erreur
 * de la CLI sont jointes au message (ex. « connexion requise »), au lieu d'un simple code de sortie. */
/** Codes de contrôle ANSI (couleurs, curseur) : inutiles dans une vue conversation. */
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
export const stripAnsi = (s: string): string => s.replace(ANSI, "");

export function createPlainTextNormalizer(): OutputNormalizer {
  const lastErr: string[] = [];
  return {
    onStdout(line, seq) {
      if (!seq.terminal) seq.emit({ kind: "output", text: stripAnsi(line), channel: "stdout" });
    },
    onStderr(line, seq) {
      const clean = stripAnsi(line);
      if (clean.trim()) lastErr.push(clean.trim());
      if (lastErr.length > 3) lastErr.shift();
      seq.emit({ kind: "output", text: clean, channel: "stderr" });
    },
    finish(exit, seq) {
      if (exit.exitCode === 0) seq.emit({ kind: "completed", resultRef: "stdout" });
      else {
        const why = lastErr.join(" | ").slice(0, 600);
        seq.fail("cli_reported_error", `CLI exited with ${exit.exitCode ?? exit.signal}${why ? ` : ${why}` : ""}`);
      }
    },
  };
}

export const plainTextNormalizer: OutputNormalizer = createPlainTextNormalizer();

export class GenericCliConnector implements AgentConnector {
  readonly manifest: ConnectorManifest;
  readonly #cfg: GenericCliConfig;
  readonly #probe: ProbeContext;
  readonly #runner: Runner | undefined;
  readonly #baseEnv: Record<string, string>;
  #binary: string | undefined;

  constructor(
    cfg: GenericCliConfig,
    opts: { probeContext: ProbeContext; runner?: Runner; baseEnv: Record<string, string>; binaryPath?: string },
  ) {
    this.#cfg = cfg;
    this.#probe = opts.probeContext;
    this.#runner = opts.runner;
    this.#baseEnv = opts.baseEnv;
    this.#binary = opts.binaryPath;
    this.manifest = {
      id: cfg.signature.connectorId,
      version: "0.1.0",
      kind: "cli",
      displayName: cfg.signature.displayName,
      // Agents de code (Hermes, OpenCode, Gemini, Qwen) : ils modifient les fichiers (vérifié en réel pour Hermes et OpenCode).
      capabilities: cfg.signature.agent ? ["chat", "edit"] : ["chat"],
      supportedPlatforms: ["linux"],
      authModes: ["vendor-login"],
      maturity: "beta",
    };
  }

  async probe(): Promise<ProbeResult> {
    const r = await probeCli(this.#cfg.signature, this.#probe);
    if (r.path) this.#binary = r.path;
    return r;
  }

  start(req: AgentTaskRequest, signal: AbortSignal): AsyncIterable<AgentEvent> {
    if (!this.#binary)
      return refuse(req.taskId, "binary_not_found", `${this.manifest.displayName} n'a pas été détecté`);
    let started = false;
    const text = createPlainTextNormalizer();
    const normalizer: OutputNormalizer = {
      ...text,
      onStdout(line, seq) {
        if (!started) {
          started = true;
          seq.emit({ kind: "started" });
        }
        text.onStdout(line, seq);
      },
      // « started » toujours en premier, même si la CLI écrit d'abord sur stderr.
      onStderr(line, seq) {
        if (!started) {
          started = true;
          seq.emit({ kind: "started" });
        }
        text.onStderr?.(line, seq);
      },
      finish(exit, seq) {
        if (!started) seq.emit({ kind: "started" });
        text.finish(exit, seq);
      },
    };
    const mcp = mcpConfigFor(this.manifest.id, req.mcpServers);
    const task = runCliTask({
      taskId: req.taskId,
      file: this.#binary,
      args: [
        ...this.#cfg.args,
        ...(["autonomous", "sandbox-auto"].includes(req.permissionsPolicyId) ? (this.#cfg.freeArgs ?? []) : []),
        ...(this.#cfg.promptVia === "last-arg"
          ? [...(this.#cfg.promptFlag ? [this.#cfg.promptFlag] : []), req.prompt]
          : []),
      ],
      ...(this.#cfg.promptVia === "stdin" && { stdin: req.prompt }),
      cwd: req.workspacePath,
      env: { ...this.#baseEnv, ...mcp?.env },
      timeoutMs: req.timeoutMs,
      signal,
      normalizer,
      ...(this.#runner && { runner: this.#runner }),
    });
    if (!mcp) return task;
    // Le fichier de configuration MCP temporaire est supprimé à la fin de l'exécution.
    return (async function* () {
      try {
        yield* task;
      } finally {
        mcp.cleanup();
      }
    })();
  }
}

/**
 * Serveurs MCP de Nexus pour les CLI génériques, par un fichier de réglages temporaire désigné par variable
 * d'environnement (les réglages de l'utilisateur restent chargés) :
 * Gemini (`GEMINI_CLI_SYSTEM_SETTINGS_PATH`), Qwen (`QWEN_CODE_SYSTEM_SETTINGS_PATH`), OpenCode (`OPENCODE_CONFIG`).
 * `trust` : les outils de l'équipe ne demandent pas d'approbation (personne ne peut répondre en exécution non interactive).
 */
export function mcpConfigFor(
  connectorId: string,
  servers: AgentTaskRequest["mcpServers"],
): { env: Record<string, string>; cleanup: () => void } | undefined {
  if (!servers?.length) return undefined;
  let content: unknown;
  let envName: string;
  if (connectorId === "gemini-cli" || connectorId === "qwen-cli") {
    envName = connectorId === "gemini-cli" ? "GEMINI_CLI_SYSTEM_SETTINGS_PATH" : "QWEN_CODE_SYSTEM_SETTINGS_PATH";
    content = {
      mcpServers: Object.fromEntries(
        servers.map((s) => [s.name, { command: s.command, args: s.args, env: s.env, trust: true, timeout: 300_000 }]),
      ),
    };
  } else if (connectorId === "opencode-cli") {
    envName = "OPENCODE_CONFIG";
    content = {
      $schema: "https://opencode.ai/config.json",
      mcp: Object.fromEntries(
        servers.map((s) => [
          s.name,
          { type: "local", command: [s.command, ...s.args], environment: s.env, enabled: true },
        ]),
      ),
    };
  } else return undefined;
  const dir = mkdtempSync(join(tmpdir(), "nexus-mcp-"));
  const file = join(dir, "settings.json");
  writeFileSync(file, JSON.stringify(content), { mode: 0o600 });
  return { env: { [envName]: file }, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
