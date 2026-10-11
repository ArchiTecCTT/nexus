// Session de dictée (cahier maître §15, UC-08, AC-11) : aucune capture sans geste explicite de l'utilisateur et
// consentement ; indicateur d'enregistrement ; durée et taille bornées ; transcription TOUJOURS relue avant envoi.

export type VoiceState = "idle" | "armed" | "recording" | "transcribing" | "review" | "sent" | "discarded" | "error";

const TRANSITIONS: Readonly<Record<VoiceState, readonly VoiceState[]>> = {
  idle: ["armed"],
  armed: ["recording", "idle", "error"],
  recording: ["transcribing", "discarded", "error"],
  transcribing: ["review", "error"],
  review: ["sent", "discarded"],
  sent: [],
  discarded: [],
  error: ["idle"],
};

export class VoiceSessionError extends Error {}

export type VoiceLimits = { armWindowMs: number; maxDurationMs: number; maxBytes: number };
export const DEFAULT_VOICE_LIMITS: VoiceLimits = {
  armWindowMs: 10_000,
  maxDurationMs: 120_000,
  maxBytes: 10 * 1024 * 1024,
};

export class VoiceSession {
  #state: VoiceState = "idle";
  #armedAt = 0;
  #startedAt = 0;
  readonly limits: VoiceLimits;
  readonly #now: () => number;
  rawText: string | undefined;

  constructor(limits: VoiceLimits = DEFAULT_VOICE_LIMITS, now: () => number = Date.now) {
    this.limits = limits;
    this.#now = now;
  }

  get state(): VoiceState {
    return this.#state;
  }

  #go(to: VoiceState): void {
    if (!TRANSITIONS[this.#state].includes(to))
      throw new VoiceSessionError(`Transition interdite ${this.#state} -> ${to}`);
    this.#state = to;
  }

  /** Geste explicite de l'utilisateur (clic micro) avec consentement : ouvre une courte fenêtre d'autorisation. */
  arm(input: { userGesture: boolean; consent: boolean }): void {
    if (!input.userGesture || !input.consent)
      throw new VoiceSessionError("Enregistrement refusé : geste explicite et consentement requis");
    this.#go("armed");
    this.#armedAt = this.#now();
  }

  /** L'OS ne doit accorder le micro que pendant la fenêtre armée (utilisé par le gestionnaire de permissions). */
  mayGrantMicrophone(): boolean {
    return this.#state === "armed" && this.#now() - this.#armedAt <= this.limits.armWindowMs;
  }

  startRecording(): void {
    if (!this.mayGrantMicrophone())
      throw new VoiceSessionError("Fenêtre d'autorisation expirée : recliquer sur le micro");
    this.#go("recording");
    this.#startedAt = this.#now();
  }

  /** Contrôle de l'audio reçu : durée et taille bornées. */
  acceptAudio(bytes: number): void {
    if (this.#state !== "recording") throw new VoiceSessionError("Aucun enregistrement en cours");
    if (this.#now() - this.#startedAt > this.limits.maxDurationMs + 2000) {
      this.#go("discarded");
      throw new VoiceSessionError("Durée maximale dépassée");
    }
    if (bytes <= 0 || bytes > this.limits.maxBytes) {
      this.#go("discarded");
      throw new VoiceSessionError("Taille audio invalide ou trop grande");
    }
    this.#go("transcribing");
  }

  transcribed(text: string): void {
    this.rawText = text;
    this.#go("review");
  }

  failed(): void {
    this.#go("error");
  }

  /** Envoi de la transcription RELUE par l'utilisateur (jamais d'envoi automatique de la transcription brute). */
  commit(editedText: string): string {
    if (this.#state !== "review") throw new VoiceSessionError("La transcription doit être relue avant envoi");
    const text = editedText.trim();
    if (!text) throw new VoiceSessionError("Transcription vide");
    this.#go("sent");
    return text;
  }

  discard(): void {
    this.#go("discarded");
  }
}
