// Terminaux interactifs réels (PTY) pour l'utilisateur, comme dans VS Code : le shell de l'utilisateur, dans le
// dossier du projet. Ce n'est pas un agent : il s'exécute avec l'environnement normal de l'utilisateur.
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";

type IPty = {
  pid: number;
  onData(cb: (d: string) => void): { dispose(): void };
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): { dispose(): void };
  write(d: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  pause?(): void;
  resume?(): void;
};
type PtyModule = { spawn(file: string, args: string[], opts: Record<string, unknown>): IPty };

const MAX_TERMINALS = 32;
/** Sortie regroupée toutes les 16 ms, au plus 256 Ko par envoi : un programme bavard ne sature ni l'IPC ni l'interface. */
const FLUSH_MS = 16;
const MAX_FLUSH_CHARS = 256 * 1024;
/** Au-delà, le PTY est mis en pause (contrôle de flux) jusqu'à ce que le retard soit résorbé. */
const PAUSE_ABOVE_CHARS = 4 * 1024 * 1024;

// Bundle CommonJS d'Electron : `require` existe. Tests ESM sous Node : on le reconstruit.
declare const require: ((id: string) => unknown) | undefined;
const loadNative = (id: string): unknown =>
  typeof require === "function" ? require(id) : createRequire(import.meta.url)(id);

export class TerminalManager {
  readonly #terminals = new Map<string, IPty>();
  readonly #onData: (terminalId: string, data: string) => void;
  readonly #onExit: (terminalId: string, exitCode: number | null) => void;
  readonly #env: Record<string, string>;
  #pty: PtyModule | undefined;

  constructor(opts: {
    env: Record<string, string>;
    onData: (terminalId: string, data: string) => void;
    onExit: (terminalId: string, exitCode: number | null) => void;
  }) {
    this.#env = opts.env;
    this.#onData = opts.onData;
    this.#onExit = opts.onExit;
  }

  /** Chargé à la demande : module natif (N-API), absent du bundle Vite et chargé depuis node_modules. */
  #module(): PtyModule {
    if (!this.#pty) this.#pty = loadNative("node-pty") as PtyModule;
    return this.#pty;
  }

  available(): boolean {
    try {
      this.#module();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * `command` : lance un programme précis (ex. la TUI d'un agent, éventuellement via le lanceur sandbox) au lieu du shell.
   * `onExit` : rappel spécifique à ce terminal (fin de session d'agent).
   */
  create(
    cwd: string,
    cols: number,
    rows: number,
    command?: {
      file: string;
      args: string[];
      env: Record<string, string>;
      /** Fin du programme ; `signal` renseigné s'il a été tué (fermeture de l'onglet, arrêt…). */
      onExit?: (code: number | null, signal?: number) => void;
      /** Activité du terminal (sortie reçue), pour l'état des agents sans hooks. */
      onActivity?: () => void;
      /** Sortie brute (enregistrement de la conversation d'un agent). */
      onOutput?: (data: string) => void;
    },
  ): { terminalId: string; shell: string; cwd: string } {
    if (this.#terminals.size >= MAX_TERMINALS) throw new Error(`Trop de terminaux ouverts (maximum ${MAX_TERMINALS})`);
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error("Dossier du terminal introuvable");
    const shell =
      command?.file ??
      (this.#env.SHELL && existsSync(this.#env.SHELL)
        ? this.#env.SHELL
        : existsSync("/bin/bash")
          ? "/bin/bash"
          : "/bin/sh");
    const terminalId = randomUUID();
    const pty = this.#module().spawn(shell, command?.args ?? ["-l"], {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: {
        ...(command ? command.env : this.#env),
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        TERM_PROGRAM: "NexusAI",
      },
    });
    let pending = "";
    let paused = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      timer = undefined;
      const chunk = pending.slice(0, MAX_FLUSH_CHARS);
      pending = pending.slice(chunk.length);
      if (chunk) this.#onData(terminalId, chunk);
      if (pending) timer = setTimeout(flush, FLUSH_MS);
      else if (paused) {
        paused = false;
        pty.resume?.();
      }
    };
    pty.onData((d) => {
      command?.onActivity?.();
      command?.onOutput?.(d);
      pending += d;
      if (!paused && pending.length > PAUSE_ABOVE_CHARS && pty.pause) {
        paused = true;
        pty.pause();
      }
      timer ??= setTimeout(flush, FLUSH_MS);
    });
    pty.onExit((e) => {
      if (timer) clearTimeout(timer);
      if (pending) this.#onData(terminalId, pending.slice(-MAX_FLUSH_CHARS));
      this.#terminals.delete(terminalId);
      const code = Number.isInteger(e.exitCode) ? e.exitCode : null;
      this.#onExit(terminalId, code);
      command?.onExit?.(code, e.signal || undefined);
    });
    this.#terminals.set(terminalId, pty);
    return { terminalId, shell, cwd };
  }

  #get(terminalId: string): IPty {
    const t = this.#terminals.get(terminalId);
    if (!t) throw new Error("Terminal introuvable (déjà fermé ?)");
    return t;
  }

  write(terminalId: string, data: string): void {
    this.#get(terminalId).write(data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    this.#get(terminalId).resize(cols, rows);
  }

  kill(terminalId: string): void {
    const t = this.#terminals.get(terminalId);
    if (!t) return;
    this.#terminals.delete(terminalId);
    try {
      t.kill();
    } catch {
      /* déjà terminé */
    }
  }

  killAll(): void {
    for (const id of this.#terminals.keys()) this.kill(id);
  }

  get count(): number {
    return this.#terminals.size;
  }
}
