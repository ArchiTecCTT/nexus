// Adaptateur CLI générique (FR-005) pour les CLI sans flux structuré vérifié (Gemini, Hermes, OpenCode, Qwen…).
// Chaque ligne de sortie devient un événement `output` ; un code de sortie 0 termine la tâche. Maturité `beta` :
// aucune capacité n'est revendiquée au-delà de « chat » tant qu'elle n'a pas été testée contre la version réelle.
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
  // Non vérifiés en réel (CLI absentes de la machine de développement) : options documentées par les éditeurs.
  "gemini-cli": { args: [], promptVia: "last-arg", promptFlag: "--prompt", freeArgs: ["--yolo"] },
  "qwen-cli": { args: [], promptVia: "last-arg", promptFlag: "--", freeArgs: ["--yolo"] },
  "opencode-cli": { args: ["run"], promptVia: "last-arg" },
};

export const plainTextNormalizer: OutputNormalizer = {
  onStdout(line, seq) {
    if (!seq.terminal) {
      seq.emit({ kind: "output", text: line, channel: "stdout" });
    }
  },
  onStderr(line, seq) {
    seq.emit({ kind: "output", text: line, channel: "stderr" });
  },
  finish(exit, seq) {
    if (exit.exitCode === 0) seq.emit({ kind: "completed", resultRef: "stdout" });
    else seq.fail("cli_reported_error", `CLI exited with ${exit.exitCode ?? exit.signal}`);
  },
};

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
      capabilities: ["chat"],
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
    const normalizer: OutputNormalizer = {
      ...plainTextNormalizer,
      onStdout(line, seq) {
        if (!started) {
          started = true;
          seq.emit({ kind: "started" });
        }
        plainTextNormalizer.onStdout(line, seq);
      },
      finish(exit, seq) {
        if (!started) seq.emit({ kind: "started" });
        plainTextNormalizer.finish(exit, seq);
      },
    };
    return runCliTask({
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
      env: { ...this.#baseEnv },
      timeoutMs: req.timeoutMs,
      signal,
      normalizer,
      ...(this.#runner && { runner: this.#runner }),
    });
  }
}
