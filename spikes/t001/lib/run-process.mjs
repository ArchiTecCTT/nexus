// Exécution contrôlée d'un processus : binaire absolu, tableau d'arguments, shell:false, env explicite,
// timeout, annulation (SIGTERM puis SIGKILL), redaction.
//
// Frontière d'arrêt : le groupe de processus seul est INSUFFISANT (un descendant peut le quitter via
// setsid — relevé par Hermes à la relecture de T-001). Par défaut, la commande est donc lancée dans un
// PID namespace dédié (`unshare --user --map-current-user --pid --fork --kill-child=SIGKILL`) :
//  - aucun processus ne peut quitter un PID namespace (setsid, double fork, réparentage inclus) ;
//  - quand son PID 1 meurt, le noyau tue tous les processus du namespace ;
//  - si `unshare` est tué (même par SIGKILL), --kill-child tue le PID 1 (PR_SET_PDEATHSIG).
// Le SIGTERM initial est envoyé au groupe, donc aussi au PID 1 : arrêt gracieux possible avant SIGKILL.
import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { isAbsolute } from 'node:path';
import { createLineSplitter } from './jsonl.mjs';

const UNSHARE = '/usr/bin/unshare';
const PIDNS_PREFIX = ['--user', '--map-current-user', '--pid', '--fork', '--kill-child=SIGKILL', '--'];
const BOUNDARIES = new Set(['pid-namespace', 'process-group']);

/** Vérifie que la frontière PID namespace est réellement disponible sur cet hôte. */
export async function probeKillBoundary() {
  try {
    accessSync(UNSHARE, constants.X_OK);
  } catch {
    return { usable: false, reason: 'unshare_not_found' };
  }
  const r = await runProcess({ file: '/usr/bin/true', args: [], cwd: '/', env: {}, timeoutMs: 5000 });
  return r.exitCode === 0 ? { usable: true } : { usable: false, reason: `pid_namespace_failed:${r.exitCode}` };
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function makeRedactor(secrets) {
  const list = secrets.filter((s) => typeof s === 'string' && s.length >= 8).sort((a, b) => b.length - a.length);
  if (!list.length) return (s) => s;
  return (s) => list.reduce((acc, secret) => acc.split(secret).join('[REDACTED]'), s);
}

/**
 * @param {{
 *   file: string, args: string[], cwd: string, env: Record<string,string>, timeoutMs: number,
 *   killGraceMs?: number, signal?: AbortSignal, redact?: string[], maxLineBytes?: number,
 *   onLine?: (line: string, channel: 'stdout'|'stderr') => void,
 *   onChunk?: (chunk: Buffer, channel: 'stdout'|'stderr') => void,
 *   killBoundary?: 'pid-namespace'|'process-group',
 * }} opts
 * `killBoundary: 'process-group'` n'existe que pour démontrer la faille dans les tests ; ne pas l'utiliser
 * pour une exécution d'agent.
 * @returns {Promise<{ pid?: number, exitCode: number|null, signal: string|null, timedOut: boolean,
 *   cancelled: boolean, spawnError?: string, durationMs: number }>}
 */
export async function runProcess(opts) {
  const { file, args, cwd, env, timeoutMs, killGraceMs = 1500, signal, redact = [], maxLineBytes = 1 << 20 } = opts;
  if (!isAbsolute(file)) throw new Error('runProcess: file must be an absolute path (no PATH lookup)');
  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) throw new Error('runProcess: args must be string[]');
  if (!isAbsolute(cwd)) throw new Error('runProcess: cwd must be an absolute path');
  const { killBoundary = 'pid-namespace' } = opts;
  if (!BOUNDARIES.has(killBoundary)) throw new Error(`runProcess: unknown killBoundary ${killBoundary} (no silent fallback)`);

  const started = Date.now();
  let spawnFile = file;
  let spawnArgs = args;
  if (killBoundary === 'pid-namespace') {
    // Vérifié avant le spawn : sinon un binaire absent apparaîtrait comme un code de sortie d'unshare.
    try {
      accessSync(file, constants.X_OK);
    } catch (e) {
      return { exitCode: null, signal: null, timedOut: false, cancelled: false, spawnError: e.code ?? 'EACCES', durationMs: 0 };
    }
    spawnFile = UNSHARE;
    spawnArgs = [...PIDNS_PREFIX, file, ...args];
  }
  const scrub = makeRedactor(redact);
  let timedOut = false;
  let cancelled = false;

  if (signal?.aborted) return { exitCode: null, signal: null, timedOut, cancelled: true, durationMs: 0 };

  const child = spawn(spawnFile, spawnArgs, {
    cwd,
    env, // jamais fusionné avec process.env
    shell: false,
    detached: true, // nouveau groupe : permet de tuer tout l'arbre via -pgid
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const killTree = (sig) => {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, sig);
    } catch {
      /* groupe déjà terminé */
    }
  };

  let graceTimer;
  const stop = () => {
    killTree('SIGTERM');
    graceTimer ??= setTimeout(() => killTree('SIGKILL'), killGraceMs);
  };

  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, timeoutMs);
  const onAbort = () => {
    cancelled = true;
    stop();
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  for (const channel of ['stdout', 'stderr']) {
    const splitter = opts.onLine
      ? createLineSplitter({ maxLineBytes, onLine: (l) => opts.onLine(scrub(l), channel) })
      : null;
    child[channel].on('data', (chunk) => {
      opts.onChunk?.(redact.length ? Buffer.from(scrub(chunk.toString('utf8'))) : chunk, channel);
      splitter?.write(chunk);
    });
    child[channel].on('end', () => splitter?.end());
  }

  const result = await new Promise((resolve) => {
    child.once('error', (e) => resolve({ exitCode: null, signal: null, spawnError: e.code ?? 'spawn_failed' }));
    child.once('close', (exitCode, sig) => resolve({ exitCode, signal: sig }));
  });

  clearTimeout(timer);
  signal?.removeEventListener('abort', onAbort);
  // En mode pid-namespace, le noyau a déjà tué tout le namespace. Ce SIGKILL de groupe reste une
  // défense en profondeur (et la seule action du mode process-group, insuffisant contre setsid).
  if (cancelled || timedOut) {
    killTree('SIGKILL');
  }
  clearTimeout(graceTimer);

  return { pid: child.pid, ...result, timedOut, cancelled, durationMs: Date.now() - started };
}
