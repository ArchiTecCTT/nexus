// Utilitaires communs aux stores : états de chargement et préférences locales non sensibles.
import { toNexusError } from "../api.ts";
import type { Res } from "../types.ts";

export const pending = <T>(prev: Res<T> | undefined): Res<T> => ({ data: prev?.data, loading: true });
export const done = <T>(data: T): Res<T> => ({ data, loading: false });
export const failed = <T>(prev: Res<T> | undefined, e: unknown): Res<T> => ({
  data: prev?.data,
  error: toNexusError(e),
  loading: false,
});

/**
 * Préférences d'interface NON sensibles uniquement : langue, thème, disposition des panneaux, largeur de la barre
 * latérale. Jamais de secret, de jeton ni de contenu de fichier. localStorage peut être indisponible (ou plein) :
 * chaque accès est protégé et l'interface fonctionne sans.
 */
const PREF_PREFIXES = ["nexus.lang", "nexus.theme", "nexus.ui", "nexus.layout.", "nexus.sessionMode"] as const;

function allowed(key: string): boolean {
  return PREF_PREFIXES.some((p) => (p.endsWith(".") ? key.startsWith(p) : key === p));
}

export function readPref(key: string): string | undefined {
  if (!allowed(key)) return undefined;
  try {
    return globalThis.localStorage?.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writePref(key: string, value: string | undefined): void {
  if (!allowed(key)) return;
  try {
    if (value === undefined) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
  } catch {
    // Stockage indisponible : la préférence n'est simplement pas conservée.
  }
}

export function readJsonPref<T>(key: string): T | undefined {
  const raw = readPref(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export function writeJsonPref(key: string, value: unknown): void {
  try {
    writePref(key, JSON.stringify(value));
  } catch {
    // Valeur non sérialisable : ignorée.
  }
}
