// Exécution contrôlée d'un processus (ADR-001 §5.4) : binaire absolu, tableau d'arguments, shell:false,
// environnement construit (jamais hérité), timeout, annulation SIGTERM -> SIGKILL, plafond de sortie, redaction.
//
// Frontière d'arrêt : PID namespace dédié (`unshare --user --map-current-user --pid --fork --kill-child=SIGKILL`).
// Aucun processus ne peut en sortir (setsid, double fork) ; quand son PID 1 meurt, le noyau tue tout le namespace ;
// si `unshare` est tué, --kill-child tue le PID 1. Le groupe de processus seul est insuffisant (constat 7 de l'ADR-001).
import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { isAbsolute } from "node:path";
import { createLineSplitter } from "./lines.ts";
import { createRedactor, redactKnownTokenPatterns } from "./redact.ts";

const UNSHARE = "/usr/bin/unshare";
const PIDNS_PREFIX = ["--user", "--map-current-user", "--pid", "--fork", "--kill-child=SIGKILL", "--"];

/**
 * - `pid-namespace` (défaut) : la commande est placée dans un PID namespace dédié via unshare ;
 * - `wrapper-pid-namespace` : l'enveloppe fournie (bwrap --unshare-pid --die-with-parent) établit elle-même le PID
 *   namespace ; utile quand une autre enveloppe (systemd-run --scope) ne fonctionne pas dans un user namespace ;
 * - `process-group` : insuffisant contre setsid, réservé aux tests qui démontrent la faille.
 */
export type KillBoundary = "pid-namespace" | "wrapper-pid-namespace" | "process-group";
export type Channel = "stdout" | "stderr";

export type RunOptions = {
  file: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  timeoutMs: number;
  killGraceMs?: number;
  signal?: AbortSignal;
  /** Valeurs secrètes connues à expurger de toute sortie transmise. */
  redact?: readonly string[];
  maxLineBytes?: number;
  /** Au-delà, le processus est arrêté (`outputLimitExceeded`). Protège la mémoire et le journal. */
  maxOutputBytes?: number;
  onLine?: (line: string, channel: Channel) => void;
  onChunk?: (chunk: string, channel: Channel) => void;
  /**
   * `process-group` est INSUFFISANT contre setsid ; il n'est accepté qu'avec `allowWeakBoundary: true`
   * (tests démontrant la faille, ou environnement sans user namespaces explicitement déclaré).
   */
  killBoundary?: KillBoundary;
  allowWeakBoundary?: boolean;
  /** Données écrites sur l'entrée standard puis fermée (ex. prompt volumineux, au-delà de la limite d'un argv). */
  stdin?: string;
  /**
   * Descripteurs hérités par l'enfant à partir du fd 3 (ex. programme seccomp lu par `bwrap --seccomp 3`).
   * Ils traversent unshare/systemd-run, qui font un exec sans fermer les descripteurs hérités.
   */
  inheritFds?: readonly number[];
  /** Préfixe d'enveloppe (ex. bwrap) : la commande réelle devient `wrapper.file ...wrapper.args file ...args`. */
  wrapper?: { file: string; args: readonly string[] };
};

export type RunResult = {
  pid?: number;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  cancelled: boolean;
  outputLimitExceeded: boolean;
  spawnError?: string;
  durationMs: number;
};

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

const executable = (file: string): string | null => {
  try {
    accessSync(file, constants.X_OK);
    return null;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code ?? "EACCES";
  }
};

/** Sonde la frontière PID namespace sur cet hôte (user namespaces non privilégiés, AppArmor). */
export async function probeKillBoundary(): Promise<{ usable: boolean; reason?: string }> {
  if (executable(UNSHARE)) return { usable: false, reason: "unshare_not_found" };
  const r = await runProcess({ file: "/usr/bin/true", args: [], cwd: "/", env: {}, timeoutMs: 5000 });
  return r.exitCode === 0
    ? { usable: true }
    : { usable: false, reason: `pid_namespace_failed:${r.exitCode ?? r.spawnError}` };
}

export async function runProcess(opts: RunOptions): Promise<RunResult> {
  const { file, args, cwd, env, timeoutMs, killGraceMs = 1500, signal } = opts;
  const { maxLineBytes = 1 << 20, maxOutputBytes = 64 << 20, killBoundary = "pid-namespace" } = opts;
  if (!isAbsolute(file)) throw new Error("runProcess: file must be an absolute path (no PATH lookup)");
  if (!Array.isArray(args) || args.some((a) => typeof a !== "string"))
    throw new Error("runProcess: args must be string[]");
  if (!isAbsolute(cwd)) throw new Error("runProcess: cwd must be an absolute path");
  if (
    killBoundary !== "pid-namespace" &&
    killBoundary !== "process-group" &&
    killBoundary !== "wrapper-pid-namespace"
  ) {
    throw new Error(`runProcess: unknown killBoundary ${String(killBoundary)} (no silent fallback)`);
  }
  if (killBoundary === "wrapper-pid-namespace" && !opts.wrapper) {
    throw new Error("runProcess: wrapper-pid-namespace requires a wrapper that establishes the PID namespace");
  }
  if (killBoundary === "process-group" && !opts.allowWeakBoundary) {
    throw new Error(
      "runProcess: process-group boundary is insufficient against setsid; set allowWeakBoundary explicitly",
    );
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
  if (signal?.aborted) return { ...fail("aborted"), spawnError: undefined, cancelled: true };

  // Vérifiés avant le spawn : sinon un binaire absent apparaîtrait comme un code de sortie d'unshare.
  // Avec une enveloppe (bwrap…), la cible est un chemin VU DANS l'enveloppe : seule l'enveloppe est vérifiée sur l'hôte.
  const targetError = executable(opts.wrapper?.file ?? file);
  if (targetError) return fail(targetError);

  let command = opts.wrapper ? [opts.wrapper.file, ...opts.wrapper.args, file, ...args] : [file, ...args];
  if (killBoundary === "pid-namespace") {
    if (executable(UNSHARE)) return fail("kill_boundary_unavailable");
    command = [UNSHARE, ...PIDNS_PREFIX, ...command];
  }

  const scrub = (s: string) => redactKnownTokenPatterns(createRedactor(opts.redact ?? [])(s));
  const started = Date.now();
  let timedOut = false;
  let cancelled = false;
  let outputLimitExceeded = false;
  let outputBytes = 0;

  const child = spawn(command[0]!, command.slice(1), {
    cwd,
    env: { ...env }, // jamais fusionné avec process.env
    shell: false,
    detached: true, // groupe dédié : le SIGTERM initial atteint aussi le PID 1 du namespace
    stdio: [opts.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe", ...(opts.inheritFds ?? [])],
  });
  if (opts.stdin !== undefined && child.stdin) {
    child.stdin.on("error", () => {}); // processus terminé avant d'avoir tout lu : sans incidence
    child.stdin.end(opts.stdin);
  }

  const killTree = (sig: NodeJS.Signals) => {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, sig);
    } catch {
      /* groupe déjà terminé */
    }
  };
  let graceTimer: NodeJS.Timeout | undefined;
  const stop = () => {
    killTree("SIGTERM");
    graceTimer ??= setTimeout(() => killTree("SIGKILL"), killGraceMs);
  };
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, timeoutMs);
  const onAbort = () => {
    cancelled = true;
    stop();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  for (const channel of ["stdout", "stderr"] as const) {
    const splitter = opts.onLine
      ? createLineSplitter({ maxLineBytes, onLine: (l) => opts.onLine!(scrub(l), channel) })
      : null;
    // stdout/stderr sont toujours des pipes (stdio ci-dessus) : jamais null.
    const stream = child[channel]!;
    stream.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        if (!outputLimitExceeded) {
          outputLimitExceeded = true;
          stop();
        }
        return;
      }
      opts.onChunk?.(scrub(chunk.toString("utf8")), channel);
      splitter?.write(chunk);
    });
    stream.on("end", () => splitter?.end());
  }

  const result = await new Promise<{ exitCode: number | null; signal: string | null; spawnError?: string }>(
    (resolve) => {
      child.once("error", (e: NodeJS.ErrnoException) =>
        resolve({ exitCode: null, signal: null, spawnError: e.code ?? "spawn_failed" }),
      );
      child.once("close", (exitCode, sig) => resolve({ exitCode, signal: sig }));
    },
  );

  clearTimeout(timer);
  signal?.removeEventListener("abort", onAbort);
  // En mode pid-namespace le noyau a déjà tué tout le namespace ; ce SIGKILL reste une défense en profondeur.
  if (cancelled || timedOut || outputLimitExceeded) killTree("SIGKILL");
  clearTimeout(graceTimer);

  return { pid: child.pid, ...result, timedOut, cancelled, outputLimitExceeded, durationMs: Date.now() - started };
}
