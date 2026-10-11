// Réglages utilisateur gérés depuis l'interface (remplacent l'édition manuelle de fichiers JSON) et projets récents.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AppSettings } from "@nexus/contracts";

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  language: "fr",
  // Choix du propriétaire (11/10/2026) : copie isolée et relecture par défaut ; Autonome reste à un clic.
  defaultMode: "supervised",
  apiConnectors: [],
  voice: { cloudOptIn: false },
  sandboxExtraAllow: [],
};

function writeJsonAtomic(file: string, data: unknown): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
}

export class SettingsStore {
  readonly #file: string;
  readonly #recentFile: string;
  #listeners = new Set<(s: AppSettings) => void>();

  constructor(userDataDir: string) {
    this.#file = join(userDataDir, "settings.json");
    this.#recentFile = join(userDataDir, "recent-projects.json");
  }

  get(): AppSettings {
    if (!existsSync(this.#file)) return structuredClone(DEFAULT_SETTINGS);
    try {
      const parsed = AppSettings.safeParse({ ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(this.#file, "utf8")) });
      return parsed.success ? parsed.data : structuredClone(DEFAULT_SETTINGS);
    } catch {
      return structuredClone(DEFAULT_SETTINGS);
    }
  }

  set(next: AppSettings): AppSettings {
    const valid = AppSettings.parse(next);
    writeJsonAtomic(this.#file, valid);
    for (const l of this.#listeners) l(valid);
    return valid;
  }

  onChange(listener: (s: AppSettings) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Projets récemment ouverts (identifiant -> date), du plus récent au plus ancien. */
  recent(): Array<{ projectId: string; lastOpenedAt: string }> {
    try {
      const data = JSON.parse(readFileSync(this.#recentFile, "utf8")) as Array<{
        projectId: string;
        lastOpenedAt: string;
      }>;
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  touchRecent(projectId: string, at: string): void {
    const list = [{ projectId, lastOpenedAt: at }, ...this.recent().filter((r) => r.projectId !== projectId)].slice(
      0,
      30,
    );
    writeJsonAtomic(this.#recentFile, list);
  }
}
