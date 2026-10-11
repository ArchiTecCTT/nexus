// Contrôleur de dictée (T-020) : une session à la fois, moteurs configurés explicitement, audio jamais conservé.
// Configuration : réglages de l'interface (`settings.voice`).
import { resolveExecutable } from "@nexus/process-supervisor";
import type { AppSettings } from "@nexus/contracts";
import type { SecretBroker } from "@nexus/secrets";
import {
  LocalWhisperEngine,
  OpenAiTranscriptionEngine,
  VoiceSession,
  type Language,
  type SttEngine,
  type VoiceState,
} from "@nexus/voice";

export class VoiceController {
  engines: SttEngine[] = [];
  #session: VoiceSession | undefined;
  readonly #pathEnv: string;
  readonly #broker: SecretBroker | undefined;

  constructor(_userDataDir: string, pathEnv: string, broker: SecretBroker | undefined, settings: AppSettings) {
    this.#pathEnv = pathEnv;
    this.#broker = broker;
    this.configure(settings);
  }

  /** (Re)construit les moteurs à partir des réglages de l'interface. Aucun moteur actif sans configuration. */
  configure(settings: AppSettings): void {
    const v = settings.voice;
    const ffmpeg = resolveExecutable("ffmpeg", this.#pathEnv)?.path;
    const whisper = v.localWhisperPath ?? resolveExecutable("whisper-cli", this.#pathEnv)?.path;
    this.engines = [
      new LocalWhisperEngine({
        ...(whisper && { whisperPath: whisper }),
        ...(v.localModelPath && { modelPath: v.localModelPath }),
        ...(ffmpeg && { ffmpegPath: ffmpeg }),
      }),
      new OpenAiTranscriptionEngine({
        optIn: v.cloudOptIn,
        ...(v.cloudModel && { model: v.cloudModel }),
        ...(v.cloudSecretRef &&
          this.#broker && { getApiKey: this.#broker.apiKeyProvider(v.cloudSecretRef, "voice:transcription") }),
      }),
    ];
  }

  get state(): VoiceState {
    return this.#session?.state ?? "idle";
  }

  /** Utilisé par le gestionnaire de permissions Electron : audio accordé seulement pendant la fenêtre armée. */
  mayGrantMicrophone(): boolean {
    return this.#session?.mayGrantMicrophone() ?? false;
  }

  arm(): number {
    // Une nouvelle session remplace toute session précédente (son audio n'est jamais conservé).
    this.#session = new VoiceSession();
    // Le renderer ne peut pas prouver le geste : l'appel n'arrive que d'un clic dans l'UI, et l'OS demande en plus
    // son autorisation. La fenêtre est courte et à usage unique (limite documentée).
    this.#session.arm({ userGesture: true, consent: true });
    return this.#session.limits.armWindowMs;
  }

  async transcribe(engineId: string, language: Language, mimeType: string, audio: Buffer): Promise<string> {
    const s = this.#session;
    if (!s) throw new Error("Aucune session de dictée");
    const engine = this.engines.find((e) => e.id === engineId);
    if (!engine?.status().available) throw new Error(engine?.status().reason ?? "Moteur inconnu");
    if (s.state === "armed") s.startRecording();
    s.acceptAudio(audio.length);
    try {
      const text = await engine.transcribe(audio, mimeType, language);
      s.transcribed(text);
      return text;
    } catch (e) {
      s.failed();
      throw e;
    }
  }

  commit(editedText: string): string {
    if (!this.#session) throw new Error("Aucune session de dictée");
    return this.#session.commit(editedText);
  }

  discard(): void {
    if (this.#session && ["recording", "review"].includes(this.#session.state)) this.#session.discard();
    this.#session = undefined;
  }
}
