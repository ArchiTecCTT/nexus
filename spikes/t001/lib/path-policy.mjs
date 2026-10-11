// Politique de chemins côté broker (défense en profondeur, PAS une barrière d'isolation) :
// résolution canonique, refus des traversées et des symlinks sortants, refus des noms protégés.
import { realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep, dirname, basename, join } from 'node:path';

const PROTECTED_DIRS = new Set(['.ssh', '.aws', '.gnupg', '.vercel', '.docker', '.kube', '.azure', '.claude', '.codex']);
const PROTECTED_FILES = new Set(['.npmrc', '.pypirc', '.netrc', '.git-credentials', '.envrc', 'credentials', 'credentials.json']);
const PROTECTED_PATTERNS = [/^\.env$/, /^\.env\..+$/, /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/, /\.(pem|key|p12|pfx)$/];

export function isProtectedName(name) {
  return PROTECTED_DIRS.has(name) || PROTECTED_FILES.has(name) || PROTECTED_PATTERNS.some((re) => re.test(name));
}

// realpath de la plus longue partie existante, puis ré-ajout des segments inexistants
// (cas d'une écriture future sous un répertoire symlinké).
function canonical(p) {
  const missing = [];
  let cur = p;
  for (;;) {
    try {
      return join(realpathSync(cur), ...missing.reverse());
    } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e;
      const parent = dirname(cur);
      if (parent === cur) throw e;
      missing.push(basename(cur));
      cur = parent;
    }
  }
}

/**
 * @param {string} workspaceRoot chemin absolu du worktree de la tâche
 * @param {string} requested chemin demandé par l'agent (relatif au workspace ou absolu)
 * @returns {{ allowed: boolean, reason?: 'invalid_path'|'outside_workspace'|'protected_path', resolved?: string }}
 */
export function checkPath(workspaceRoot, requested) {
  if (typeof requested !== 'string' || requested.length === 0 || requested.includes('\0')) {
    return { allowed: false, reason: 'invalid_path' };
  }
  const root = realpathSync(workspaceRoot);
  const lexical = isAbsolute(requested) ? resolve(requested) : resolve(root, requested);
  const resolved = canonical(lexical);
  const rel = relative(root, resolved);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return { allowed: false, reason: 'outside_workspace', resolved };
  }
  // Les noms protégés sont vérifiés sur le chemin demandé ET sur la cible résolue.
  const segments = [...relative(root, lexical).split(sep), ...rel.split(sep)];
  if (segments.some(isProtectedName)) return { allowed: false, reason: 'protected_path', resolved };
  return { allowed: true, resolved };
}
