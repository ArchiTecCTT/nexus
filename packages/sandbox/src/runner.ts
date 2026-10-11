// Sonde des capacités d'isolation et fabrique de runner sandboxé (T-014).
// Si une capacité obligatoire manque, le runner REFUSE (spawnError `sandbox_unavailable`) au lieu de simuler.
import { closeSync, existsSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SandboxProfile } from "@nexus/contracts";
import { probeKillBoundary, runProcess, type RunOptions, type RunResult } from "@nexus/process-supervisor";
import { buildBwrapArgs } from "./profile.ts";
import { buildSeccompProgram, seccompSupported } from "./seccomp.ts";

const BWRAP = "/usr/bin/bwrap";
const SYSTEMD_RUN = "/usr/bin/systemd-run";

export type SandboxCapabilities = {
  platform: NodeJS.Platform;
  bwrap: boolean;
  pidNamespace: boolean;
  seccomp: boolean;
  /** Limites cgroup v2 via une scope systemd utilisateur. */
  cgroups: boolean;
  reasons: string[];
};

/** Capacité suffisante pour `sandbox-auto` : bwrap + PID namespace + seccomp (cgroups recommandés). */
export function sandboxUsable(c: SandboxCapabilities): boolean {
  return c.platform === "linux" && c.bwrap && c.pidNamespace && c.seccomp;
}

export async function probeSandbox(
  env: { XDG_RUNTIME_DIR?: string; DBUS_SESSION_BUS_ADDRESS?: string } = process.env,
): Promise<SandboxCapabilities> {
  const reasons: string[] = [];
  if (process.platform !== "linux") {
    return {
      platform: process.platform,
      bwrap: false,
      pidNamespace: false,
      seccomp: false,
      cgroups: false,
      reasons: ["non-linux: aucun backend vérifié (T-024)"],
    };
  }
  const kill = await probeKillBoundary();
  if (!kill.usable) reasons.push(`pid namespace: ${kill.reason}`);
  let bwrap = false;
  if (existsSync(BWRAP)) {
    const r = await runProcess({
      file: BWRAP,
      args: [
        "--unshare-all",
        "--die-with-parent",
        "--ro-bind",
        "/usr",
        "/usr",
        "--symlink",
        "usr/lib64",
        "/lib64",
        "--symlink",
        "usr/lib",
        "/lib",
        "/usr/bin/true",
      ],
      cwd: "/",
      env: {},
      timeoutMs: 5000,
    });
    bwrap = r.exitCode === 0;
    if (!bwrap) reasons.push(`bwrap: namespace creation failed (${r.exitCode ?? r.spawnError})`);
  } else reasons.push("bwrap: not installed");
  const seccomp = seccompSupported();
  if (!seccomp) reasons.push(`seccomp: architecture ${process.arch} non prise en charge`);
  let cgroups = false;
  if (existsSync(SYSTEMD_RUN) && env.XDG_RUNTIME_DIR) {
    const r = await runProcess({
      file: SYSTEMD_RUN,
      args: ["--user", "--scope", "--quiet", "-p", "TasksMax=8", "--", "/usr/bin/true"],
      cwd: "/",
      env: cgroupEnv(env),
      timeoutMs: 8000,
      // systemd-run ne joint pas le bus D-Bus depuis un user namespace : pas d'unshare pour cette sonde éphémère.
      killBoundary: "process-group",
      allowWeakBoundary: true,
    });
    cgroups = r.exitCode === 0;
    if (!cgroups) reasons.push(`cgroups: systemd-run --user --scope failed (${r.exitCode ?? r.spawnError})`);
  } else reasons.push("cgroups: systemd user session unavailable");
  return { platform: "linux", bwrap, pidNamespace: kill.usable, seccomp, cgroups, reasons };
}

function cgroupEnv(env: { XDG_RUNTIME_DIR?: string; DBUS_SESSION_BUS_ADDRESS?: string }): Record<string, string> {
  return {
    ...(env.XDG_RUNTIME_DIR && { XDG_RUNTIME_DIR: env.XDG_RUNTIME_DIR }),
    ...(env.DBUS_SESSION_BUS_ADDRESS && { DBUS_SESSION_BUS_ADDRESS: env.DBUS_SESSION_BUS_ADDRESS }),
  };
}

export type Runner = (opts: RunOptions) => Promise<RunResult>;

/**
 * Runner qui exécute chaque commande dans le profil donné. Les binaires lancés doivent être visibles dans le
 * sandbox (sous /usr ou montés via `readOnlyBinds`). La commande reçoit l'environnement du PROFIL, jamais celui
 * de l'appelant : `opts.env` est ignoré (une seule source de vérité pour ce qui entre dans le sandbox).
 */
export function createSandboxedRunner(
  profile: SandboxProfile,
  caps: SandboxCapabilities,
  opts: { egressSocketPath?: string; hostEnv?: { XDG_RUNTIME_DIR?: string; DBUS_SESSION_BUS_ADDRESS?: string } } = {},
): Runner {
  return async (run) => {
    if (!sandboxUsable(caps)) {
      return {
        exitCode: null,
        signal: null,
        timedOut: false,
        cancelled: false,
        outputLimitExceeded: false,
        spawnError: "sandbox_unavailable",
        durationMs: 0,
      };
    }
    const dir = mkdtempSync(join(tmpdir(), "nexus-seccomp-"));
    const file = join(dir, "filter.bpf");
    writeFileSync(file, buildSeccompProgram(), { mode: 0o600 });
    const fd = openSync(file, "r");
    try {
      const { args } = buildBwrapArgs(profile, {
        seccompFd: 3,
        ...(opts.egressSocketPath && { egressSocketPath: opts.egressSocketPath }),
      });
      const limits: string[] = [];
      // MemorySwapMax=0 : sinon le noyau déplace la mémoire vers le swap au lieu d'appliquer la limite (constaté en T-014).
      if (profile.limits.memoryMaxBytes)
        limits.push("-p", `MemoryMax=${profile.limits.memoryMaxBytes}`, "-p", "MemorySwapMax=0");
      if (profile.limits.tasksMax) limits.push("-p", `TasksMax=${profile.limits.tasksMax}`);
      if (profile.limits.cpuQuotaPercent) limits.push("-p", `CPUQuota=${profile.limits.cpuQuotaPercent}%`);
      const useCgroups = caps.cgroups && limits.length > 0;
      if (limits.length > 0 && !caps.cgroups) {
        // Limites demandées mais non applicables : refus plutôt qu'une exécution non bornée.
        return {
          exitCode: null,
          signal: null,
          timedOut: false,
          cancelled: false,
          outputLimitExceeded: false,
          spawnError: "sandbox_unavailable",
          durationMs: 0,
        };
      }
      const wrapper = useCgroups
        ? { file: SYSTEMD_RUN, args: ["--user", "--scope", "--quiet", ...limits, "--", BWRAP, ...args] }
        : { file: BWRAP, args };
      return await runProcess({
        ...run,
        env: useCgroups ? cgroupEnv(opts.hostEnv ?? process.env) : {},
        cwd: profile.workspace,
        wrapper,
        // bwrap (--unshare-all --die-with-parent) établit le PID namespace : un descendant setsid ne peut pas en sortir,
        // et tuer bwrap tue tout le namespace. unshare n'est pas imbriqué ici car systemd-run --scope ne peut pas
        // joindre le bus D-Bus depuis un user namespace (constaté en T-014).
        killBoundary: "wrapper-pid-namespace",
        inheritFds: [fd],
      });
    } finally {
      closeSync(fd);
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

/**
 * Ligne de commande complète d'une exécution sandboxée (systemd-run éventuel + bwrap), pour les cas où le processus
 * n'est pas lancé par `runProcess` (ex. terminal PTY interactif). Le filtre seccomp est attendu sur le descripteur 3 :
 * l'appelant l'ouvre (ex. `exec 3<filtre` dans un script lanceur) avant d'exécuter cette commande.
 */
export function sandboxInvocation(
  profile: SandboxProfile,
  caps: SandboxCapabilities,
  opts: { egressSocketPath?: string; hostEnv?: { XDG_RUNTIME_DIR?: string; DBUS_SESSION_BUS_ADDRESS?: string } } = {},
): { argv: string[]; env: Record<string, string> } {
  if (!sandboxUsable(caps)) throw new Error("sandbox_unavailable");
  const { args } = buildBwrapArgs(profile, {
    seccompFd: 3,
    ...(opts.egressSocketPath && { egressSocketPath: opts.egressSocketPath }),
  });
  const limits: string[] = [];
  if (profile.limits.memoryMaxBytes)
    limits.push("-p", `MemoryMax=${profile.limits.memoryMaxBytes}`, "-p", "MemorySwapMax=0");
  if (profile.limits.tasksMax) limits.push("-p", `TasksMax=${profile.limits.tasksMax}`);
  if (profile.limits.cpuQuotaPercent) limits.push("-p", `CPUQuota=${profile.limits.cpuQuotaPercent}%`);
  if (limits.length > 0 && !caps.cgroups)
    throw new Error("sandbox_unavailable: cgroups requis pour les limites demandées");
  const useCgroups = caps.cgroups && limits.length > 0;
  return {
    argv: useCgroups
      ? [SYSTEMD_RUN, "--user", "--scope", "--quiet", ...limits, "--", BWRAP, ...args]
      : [BWRAP, ...args],
    env: useCgroups ? cgroupEnv(opts.hostEnv ?? process.env) : {},
  };
}

/** Écrit le programme seccomp dans un fichier privé (à ouvrir sur le descripteur 3 par le lanceur). */
export function writeSeccompFile(dir: string): string {
  const file = join(dir, "filter.bpf");
  writeFileSync(file, buildSeccompProgram(), { mode: 0o600 });
  return file;
}
