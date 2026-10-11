// Construction d'un profil bubblewrap minimal pour le runner Linux (spike T-001).
// Principe : rien n'est visible sauf ce qui est explicitement monté. Les secrets ne sont pas filtrés,
// ils sont ABSENTS du namespace de montage ; ceux qui vivent dans le workspace sont masqués.
import { lstatSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { runProcess } from './run-process.mjs';
import { isProtectedName } from './path-policy.mjs';

const BWRAP_CANDIDATES = ['/usr/bin/bwrap'];
const WORKSPACE = '/workspace';

/** Vérifie que bwrap existe ET peut réellement créer les namespaces requis sur cet hôte. */
export async function probeBwrap() {
  const path = BWRAP_CANDIDATES.find((p) => existsSync(p));
  if (!path) return { usable: false, reason: 'bwrap_not_found' };
  const lines = [];
  const r = await runProcess({
    file: path,
    args: ['--unshare-all', '--die-with-parent', '--ro-bind', '/usr', '/usr', '--symlink', 'usr/lib64', '/lib64',
      '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/bin', '/bin', '/usr/bin/true'],
    cwd: '/',
    env: {},
    timeoutMs: 5000,
    onLine: (l) => lines.push(l),
  });
  if (r.exitCode !== 0) return { usable: false, path, reason: `namespace_creation_failed: ${lines.join(' ').slice(0, 200)}` };
  return { usable: true, path };
}

/**
 * Liste les fichiers/dossiers protégés du workspace sans suivre les symlinks ni lire leur contenu.
 * Limite connue : un fichier protégé créé APRÈS le démarrage du sandbox n'est pas masqué.
 */
export function findProtectedFiles(root, { maxEntries = 50_000 } = {}) {
  const found = [];
  let seen = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (++seen > maxEntries) throw new Error('findProtectedFiles: workspace too large for spike scan');
      const p = join(dir, entry.name);
      if (entry.name === '.git' && entry.isDirectory()) continue;
      if (isProtectedName(entry.name) && !entry.isSymbolicLink()) found.push(p);
      else if (entry.isDirectory()) walk(p);
    }
  };
  walk(root);
  return found;
}

/**
 * @param {{
 *   workspace: string, nodeBinary?: string, network: 'none'|'proxy', proxySocket?: string,
 *   maskFiles?: string[], extraReadOnlyBinds?: Array<[string, string]>, env?: Record<string,string>,
 * }} opts
 * @returns {string[]} arguments bwrap (à faire suivre de la commande)
 */
export function buildBwrapArgs({ workspace, nodeBinary, network, proxySocket, maskFiles = [], extraReadOnlyBinds = [], env = {} }) {
  const ws = realpathSync(workspace);
  if (network !== 'none' && network !== 'proxy') throw new Error(`unsupported network mode: ${network}`);
  if (network === 'proxy' && !proxySocket) throw new Error('proxy mode requires proxySocket');

  const a = [
    // Namespaces user, pid, net, ipc, uts, cgroup : --unshare-all ne partage jamais le réseau ici.
    '--unshare-all',
    '--die-with-parent',
    '--new-session', // pas d'injection TIOCSTI dans le terminal parent
    '--clearenv',
    '--setenv', 'PATH', '/opt/nexus:/usr/bin:/bin',
    '--setenv', 'HOME', '/home/agent',
    '--setenv', 'TMPDIR', '/tmp',
    '--setenv', 'LANG', 'C.UTF-8',
    // Système en lecture seule, sous-ensemble minimal de /etc (pas de /etc complet).
    '--ro-bind', '/usr', '/usr',
    '--symlink', 'usr/bin', '/bin',
    '--symlink', 'usr/lib', '/lib',
    '--symlink', 'usr/lib64', '/lib64',
    '--symlink', 'usr/sbin', '/sbin',
  ];
  for (const etc of ['/etc/alternatives', '/etc/ld.so.cache', '/etc/ssl', '/etc/ca-certificates', '/etc/localtime']) {
    if (existsSync(etc)) a.push('--ro-bind', etc, etc);
  }
  a.push(
    '--proc', '/proc',
    '--dev', '/dev',
    '--tmpfs', '/tmp',
    '--tmpfs', '/home',
    '--dir', '/home/agent',
    '--bind', ws, WORKSPACE,
  );
  for (const f of maskFiles) {
    const real = realpathSync(f);
    if (!real.startsWith(ws + '/')) throw new Error(`mask target outside workspace: ${f}`);
    const target = WORKSPACE + real.slice(ws.length);
    // Fichier -> /dev/null en lecture seule ; dossier -> tmpfs vide en lecture seule.
    if (lstatSync(real).isDirectory()) a.push('--tmpfs', target, '--remount-ro', target);
    else a.push('--ro-bind', '/dev/null', target);
  }
  if (nodeBinary) a.push('--ro-bind', realpathSync(nodeBinary), '/opt/nexus/node');
  for (const [src, dest] of extraReadOnlyBinds) a.push('--ro-bind', realpathSync(src), dest);
  if (network === 'proxy') {
    // Seul canal sortant : le socket Unix du proxy hôte, qui applique l'allowlist.
    a.push('--dir', '/run/nexus', '--bind', realpathSync(proxySocket), '/run/nexus/egress.sock');
    a.push('--setenv', 'NEXUS_EGRESS_SOCKET', '/run/nexus/egress.sock');
  }
  for (const [k, v] of Object.entries(env)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(k)) throw new Error(`invalid env name: ${k}`);
    a.push('--setenv', k, v);
  }
  // La racine créée par bwrap est un tmpfs inscriptible : sans ce remontage, /etc, /opt, /run…
  // acceptent des écritures (éphémères, mais hors politique). Constat du spike T-001.
  // /workspace, /tmp et /home restent des montages distincts et donc inscriptibles.
  a.push('--remount-ro', '/');
  a.push('--chdir', WORKSPACE);
  return a;
}
