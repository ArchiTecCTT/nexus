// Surveillance de l'arborescence d'un projet (explorateur en direct), regroupée et bornée.
import { existsSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";

const IGNORED_SEGMENTS = new Set([".git", "node_modules", ".vite", "dist", "out", ".next", "coverage", ".turbo"]);

export type FsChange = { path: string; kind: "added" | "changed" | "removed" };

export class ProjectWatcher {
  readonly #watchers = new Map<string, { watcher: FSWatcher; root: string }>();
  readonly #emit: (projectId: string, changes: FsChange[]) => void;

  constructor(emit: (projectId: string, changes: FsChange[]) => void) {
    this.#emit = emit;
  }

  watch(projectId: string, root: string): void {
    if (this.#watchers.has(projectId)) return;
    let pending = new Map<string, FsChange>();
    let timer: NodeJS.Timeout | undefined;
    const flush = () => {
      timer = undefined;
      const changes = [...pending.values()].slice(0, 500);
      pending = new Map();
      if (changes.length) this.#emit(projectId, changes);
    };
    const watcher = watch(root, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const rel = filename.toString().split("\\").join("/");
      if (rel.split("/").some((s) => IGNORED_SEGMENTS.has(s))) return;
      const kind: FsChange["kind"] =
        eventType === "rename" ? (existsSync(join(root, rel)) ? "added" : "removed") : "changed";
      pending.set(rel, { path: rel, kind });
      timer ??= setTimeout(flush, 120);
    });
    watcher.on("error", () => this.unwatch(projectId));
    this.#watchers.set(projectId, { watcher, root });
  }

  unwatch(projectId: string): void {
    this.#watchers.get(projectId)?.watcher.close();
    this.#watchers.delete(projectId);
  }

  closeAll(): void {
    for (const id of this.#watchers.keys()) this.unwatch(id);
  }
}
