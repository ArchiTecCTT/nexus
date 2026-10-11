// Moteurs de transcription. Aucun n'est actif sans configuration explicite : pas de promesse de dictée hors ligne
// sans moteur installé (§15), et l'audio n'est jamais envoyé à un fournisseur non choisi (opt-in cloud).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { runProcess } from "@nexus/process-supervisor";

export type Language = "fr" | "en";
export type EngineStatus = { id: string; kind: "local" | "cloud"; available: boolean; reason?: string };

export interface SttEngine {
  readonly id: string;
  readonly kind: "local" | "cloud";
  status(): EngineStatus;
  transcribe(audio: Buffer, mimeType: string, language: Language, signal?: AbortSignal): Promise<string>;
}

export class TranscriptionError extends Error {}

/** whisper.cpp (`whisper-cli`) + ffmpeg pour convertir l'audio du navigateur (webm/opus) en WAV 16 kHz mono. */
export class LocalWhisperEngine implements SttEngine {
  readonly id = "local-whisper-cpp";
  readonly kind = "local" as const;
  readonly #cfg: { whisperPath?: string; modelPath?: string; ffmpegPath?: string };
  constructor(cfg: { whisperPath?: string; modelPath?: string; ffmpegPath?: string }) {
    this.#cfg = cfg;
  }

  status(): EngineStatus {
    const missing = [
      !this.#cfg.whisperPath || !existsSync(this.#cfg.whisperPath) ? "whisper.cpp (whisper-cli) non installé" : null,
      !this.#cfg.modelPath || !existsSync(this.#cfg.modelPath) ? "modèle whisper non configuré" : null,
      !this.#cfg.ffmpegPath || !existsSync(this.#cfg.ffmpegPath) ? "ffmpeg absent" : null,
    ].filter(Boolean);
    return {
      id: this.id,
      kind: this.kind,
      available: missing.length === 0,
      ...(missing.length && { reason: missing.join(", ") }),
    };
  }

  async transcribe(audio: Buffer, _mimeType: string, language: Language, signal?: AbortSignal): Promise<string> {
    if (!this.status().available) throw new TranscriptionError(this.status().reason ?? "moteur indisponible");
    const dir = mkdtempSync(join(tmpdir(), "nexus-voice-"));
    try {
      const input = join(dir, "input.audio");
      const wav = join(dir, "audio.wav");
      writeFileSync(input, audio, { mode: 0o600 });
      const conv = await runProcess({
        file: this.#cfg.ffmpegPath!,
        args: ["-nostdin", "-loglevel", "error", "-i", input, "-ar", "16000", "-ac", "1", "-f", "wav", wav],
        cwd: dir,
        env: {},
        timeoutMs: 60_000,
        ...(signal && { signal }),
      });
      if (conv.exitCode !== 0) throw new TranscriptionError("Conversion audio impossible");
      const out: string[] = [];
      const r = await runProcess({
        file: this.#cfg.whisperPath!,
        args: ["-m", this.#cfg.modelPath!, "-f", wav, "-l", language, "-nt"],
        cwd: dir,
        env: {},
        timeoutMs: 300_000,
        ...(signal && { signal }),
        onLine: (l, ch) => ch === "stdout" && out.push(l),
      });
      if (r.exitCode !== 0) throw new TranscriptionError("Transcription locale échouée");
      return out.join("\n").trim();
    } finally {
      // L'audio temporaire est toujours supprimé (aucune conservation par défaut).
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

/** Transcription cloud OpenAI (opt-in). Le modèle est configuré par l'utilisateur, jamais deviné. */
export class OpenAiTranscriptionEngine implements SttEngine {
  readonly id = "cloud-openai-transcription";
  readonly kind = "cloud" as const;
  readonly #cfg: {
    model?: string;
    getApiKey?: () => Promise<string>;
    baseUrl?: string;
    fetch?: typeof fetch;
    optIn: boolean;
  };
  constructor(cfg: {
    model?: string;
    getApiKey?: () => Promise<string>;
    baseUrl?: string;
    fetch?: typeof fetch;
    optIn: boolean;
  }) {
    this.#cfg = cfg;
  }

  status(): EngineStatus {
    const missing = [
      !this.#cfg.optIn ? "consentement cloud non donné" : null,
      !this.#cfg.model ? "modèle non configuré" : null,
      !this.#cfg.getApiKey ? "clé API absente du coffre" : null,
    ].filter(Boolean);
    return {
      id: this.id,
      kind: this.kind,
      available: missing.length === 0,
      ...(missing.length && { reason: missing.join(", ") }),
    };
  }

  async transcribe(audio: Buffer, mimeType: string, language: Language, signal?: AbortSignal): Promise<string> {
    if (!this.status().available) throw new TranscriptionError(this.status().reason ?? "moteur indisponible");
    const base = (this.#cfg.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    const url = new URL(`${base}/audio/transcriptions`);
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    ) {
      throw new TranscriptionError("HTTPS requis");
    }
    const key = await this.#cfg.getApiKey!();
    const form = new FormData();
    form.append("model", this.#cfg.model!);
    form.append("language", language);
    form.append(
      "file",
      new Blob([new Uint8Array(audio)], { type: mimeType }),
      mimeType.includes("webm") ? "audio.webm" : "audio.wav",
    );
    let res: Response;
    try {
      res = await (this.#cfg.fetch ?? fetch)(url, {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: form,
        redirect: "error",
        ...(signal && { signal }),
      });
    } catch {
      throw new TranscriptionError("Erreur réseau vers le service de transcription");
    }
    if (res.status === 401 || res.status === 403) throw new TranscriptionError("Clé refusée par le fournisseur");
    if (!res.ok) throw new TranscriptionError(`Service de transcription en erreur (HTTP ${res.status})`);
    const body = (await res.json()) as { text?: unknown };
    if (typeof body.text !== "string") throw new TranscriptionError("Réponse de transcription invalide");
    return body.text.trim();
  }
}
