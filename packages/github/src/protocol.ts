// Fonctions PURES : classification du protocole d'une URL distante et garde contre toute option destructrice.
// La garde est une défense en profondeur : le broker ne construit jamais ces options, mais toute ligne de commande
// `git push` passe par `assertSafePushArgs` juste avant l'exécution.
import { GitHubError } from "./errors.ts";

const PROTOCOL_NAME = /^[a-z][a-z0-9+.-]{0,31}$/;

/**
 * Protocole git correspondant à une URL de remote, au sens de `protocol.<name>.allow` :
 * - `scheme://…` -> scheme (`git+ssh`/`ssh+git` -> `ssh`) ;
 * - `transport::adresse` (remote helper, ex. `ext::`) -> nom du helper (refusé sauf autorisation explicite) ;
 * - `[user@]hôte:chemin` (syntaxe scp) -> `ssh` ;
 * - chemin local -> `file`.
 */
export function remoteProtocol(url: string): string {
  if (typeof url !== "string" || url.length === 0) return "unknown";
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(url);
  if (scheme) {
    const s = scheme[1]!.toLowerCase();
    return s === "git+ssh" || s === "ssh+git" ? "ssh" : s;
  }
  const helper = /^([A-Za-z][A-Za-z0-9+.-]*)::/.exec(url);
  if (helper) return helper[1]!.toLowerCase();
  // Syntaxe scp : un « : » avant tout « / » (git traite `C:` ou `./a:b` comme des chemins ; ici, prudence = ssh).
  const colon = url.indexOf(":");
  const slash = url.indexOf("/");
  if (colon > 0 && (slash === -1 || colon < slash)) return "ssh";
  return "file";
}

export function normalizeAllowedProtocols(list: readonly string[] | undefined): string[] {
  const src = list ?? ["https", "ssh"];
  if (!Array.isArray(src) || src.length === 0) {
    throw new GitHubError("invalid_argument", "au moins un protocole distant doit être autorisé");
  }
  const out = new Set<string>();
  for (const p of src) {
    if (typeof p !== "string" || !PROTOCOL_NAME.test(p))
      throw new GitHubError("invalid_argument", "protocole invalide");
    // `ext` exécute une commande arbitraire : jamais autorisable par configuration.
    if (p === "ext") throw new GitHubError("invalid_argument", "le protocole ext n'est pas autorisable");
    out.add(p);
  }
  return [...out].sort();
}

export function assertProtocolAllowed(url: string, allowed: readonly string[]): string {
  const p = remoteProtocol(url);
  if (!allowed.includes(p)) {
    throw new GitHubError("protocol_not_allowed", `protocole distant non autorisé : ${p}`, { protocol: p, allowed });
  }
  return p;
}

/** Arguments `-c` : tout protocole interdit, puis autorisation explicite des seuls protocoles configurés. */
export function protocolConfigArgs(allowed: readonly string[]): string[] {
  return ["-c", "protocol.allow=never", ...allowed.flatMap((p) => ["-c", `protocol.${p}.allow=always`])];
}

const FORBIDDEN_FLAG = /^(?:-f|-d|--force.*|--delete|--mirror|--prune|--all|--branches|--tags|--follow-tags)$/;

/**
 * Lève si les arguments (après `push`) contiennent une option de force/suppression/miroir ou un refspec forcé (`+…`)
 * ou de suppression (`:dst`). Les options combinées courtes (`-fu`) sont refusées aussi.
 */
export function assertSafePushArgs(args: readonly string[]): void {
  for (const a of args) {
    if (FORBIDDEN_FLAG.test(a) || /^-[A-Za-z]*[fd][A-Za-z]*$/.test(a) || a.startsWith("+") || a.startsWith(":")) {
      throw new GitHubError("invalid_argument", `option de push interdite : ${a.slice(0, 40)}`);
    }
  }
}
