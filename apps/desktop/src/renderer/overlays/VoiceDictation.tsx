// Dictée vocale (T-020, UC-08, AC-11). Parcours : état des moteurs -> consentement explicite -> `voice.arm` au clic
// -> micro (audio seul) pendant la fenêtre armée -> indicateur visible, 120 s max -> transcription ÉDITABLE ->
// `voice.commit` du texte relu (ou `voice.discard`). Jamais d'enregistrement sans clic ; pistes arrêtées dès la fin.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { call, toNexusError, type NexusError } from "../api.ts";
import { Mic, Square } from "lucide-react";
import { toast } from "sonner";
import { useAction } from "../hooks.ts";
import { useT, type Lang } from "../i18n/index.ts";
import { useAppStore } from "../stores/app.ts";
import { useVoiceStore, type VoiceEngine } from "../stores/voice.ts";
import { confirmAction } from "../ui/dialog.tsx";
import { Button, ErrorNotice, Skeleton } from "../ui/primitives.tsx";

const MAX_SECONDS = 120;
type Phase = "idle" | "consent" | "recording" | "transcribing" | "review";
type AudioMime = "audio/webm" | "audio/webm;codecs=opus";

function pickMime(): AudioMime {
  return typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
}

/** Encodage base64 par blocs (évite les dépassements de pile sur un gros tampon). */
async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function VoiceDictation({ onInsert }: { onInsert(text: string): void }) {
  const t = useT();
  const uiLang = useAppStore((s) => s.lang);
  const status = useVoiceStore((s) => s.status);
  const loadStatus = useVoiceStore((s) => s.loadStatus);
  const [phase, setPhase] = useState<Phase>("idle");
  const [engineId, setEngineId] = useState("");
  const [language, setLanguage] = useState<Lang>(uiLang);
  const [elapsed, setElapsed] = useState(0);
  const [text, setText] = useState("");
  const [error, setError] = useState<NexusError | undefined>(undefined);
  const commit = useAction();
  const base = useId();

  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelled = useRef(false);

  const engines: VoiceEngine[] = status.data?.engines ?? [];
  const available = engines.filter((e) => e.available);
  const engine = available.find((e) => e.id === engineId) ?? available[0];

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  /** Arrête le micro immédiatement (indicateur système éteint) et le minuteur. */
  const releaseMic = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }, []);

  // Démontage pendant un enregistrement : micro coupé, audio jeté, état du main remis à zéro.
  useEffect(
    () => () => {
      if (recorder.current && recorder.current.state !== "inactive") {
        cancelled.current = true;
        recorder.current.stop();
      }
      releaseMic();
    },
    [releaseMic],
  );

  const transcribe = async (blob: Blob, mimeType: AudioMime) => {
    if (!engine) return;
    setPhase("transcribing");
    try {
      const audioBase64 = await blobToBase64(blob);
      const result = await call("voice.transcribe", { engineId: engine.id, language, mimeType, audioBase64 });
      setText(result.text);
      setPhase("review");
    } catch (e) {
      setError(toNexusError(e, "voice.transcribe"));
      setPhase("idle");
      void call("voice.discard", {}).catch(() => {});
    }
  };

  const start = async () => {
    setError(undefined);
    setPhase("recording");
    try {
      // 1) Armement immédiat au clic de consentement : le main n'accorde le micro que dans cette fenêtre (10 s).
      await call("voice.arm", { consent: true });
      // 2) Demande du micro (audio seul) pendant la fenêtre armée.
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      const mimeType = pickMime();
      const rec = new MediaRecorder(media, { mimeType });
      recorder.current = rec;
      chunks.current = [];
      cancelled.current = false;
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunks.current.push(ev.data);
      };
      rec.onstop = () => {
        releaseMic();
        recorder.current = null;
        const blob = new Blob(chunks.current, { type: mimeType });
        chunks.current = [];
        if (cancelled.current) return;
        void transcribe(blob, mimeType);
      };
      rec.start(1000);
      setElapsed(0);
      const startedAt = Date.now();
      timer.current = setInterval(() => {
        const s = Math.floor((Date.now() - startedAt) / 1000);
        setElapsed(s);
        if (s >= MAX_SECONDS && rec.state === "recording") rec.stop();
      }, 250);
    } catch (e) {
      releaseMic();
      const err = toNexusError(e, "voice.arm");
      setError(err.code === "client_error" ? toNexusError(new Error(t("voice.micError", { msg: err.message }))) : err);
      setPhase("idle");
      void call("voice.discard", {}).catch(() => {});
    }
  };

  const stop = () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
    else releaseMic();
  };

  const discard = () => {
    setText("");
    setPhase("idle");
    void call("voice.discard", {}).catch(() => {});
  };

  const insert = () =>
    void commit.run(async () => {
      const result = await call("voice.commit", { editedText: text });
      onInsert(result.text);
      setText("");
      setPhase("idle");
      toast.success(t("voice.inserted"));
    });

  const kindLabel = (e: VoiceEngine) => t(e.kind === "cloud" ? "voice.kind.cloud" : "voice.kind.local");

  /** Consentement explicite avant toute capture audio (boîte de dialogue, annulation focalisée par défaut). */
  const askConsent = async () => {
    if (!engine) return;
    setPhase("consent");
    const ok = await confirmAction({
      title: t("voice.consentTitle"),
      body: (
        <>
          <p>{t("voice.consentBody", { engine: engine.id, kind: kindLabel(engine) })}</p>
          {engine.kind === "cloud" && <p className="text-warning mt-2">{t("voice.consentCloud")}</p>}
        </>
      ),
      confirmLabel: t("voice.consentConfirm"),
      cancelLabel: t("common.cancel"),
    });
    if (ok) void start();
    else setPhase("idle");
  };

  return (
    <div className="voice" role="group" aria-label={t("voice.panel")}>
      {status.loading && !status.data && <Skeleton lines={1} />}
      <ErrorNotice error={status.error} />
      {status.data && available.length === 0 && (
        <div className="notice notice-muted text-[12px]" role="note" data-testid="voice-unavailable">
          <div>
            <p>{t("voice.unavailable")}</p>
            {engines.length > 0 && (
              <ul>
                {engines.map((e) => (
                  <li key={e.id}>
                    <span className="font-mono">{e.id}</span> ({kindLabel(e)}) — {t("voice.engineUnavailable")}
                    {e.reason ? ` : ${e.reason}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {phase === "idle" && (
        <div className="voice-controls">
          {available.length > 1 && (
            <div className="field">
              <label htmlFor={`${base}-engine`}>{t("voice.engine")}</label>
              <select
                className="input input-sm"
                id={`${base}-engine`}
                value={engine?.id ?? ""}
                onChange={(e) => setEngineId(e.target.value)}
              >
                {available.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.id} ({kindLabel(e)})
                  </option>
                ))}
              </select>
            </div>
          )}
          {available.length > 0 && (
            <div className="field">
              <label htmlFor={`${base}-lang`}>{t("voice.language")}</label>
              <select
                className="input input-sm"
                id={`${base}-lang`}
                value={language}
                onChange={(e) => setLanguage(e.target.value as Lang)}
              >
                <option value="fr">Français</option>
                <option value="en">English</option>
              </select>
            </div>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!engine}
            aria-label={t("voice.buttonLabel")}
            title={engine ? undefined : t("voice.unavailable")}
            onClick={() => void askConsent()}
          >
            <Mic size={14} aria-hidden /> {t("voice.button")}
          </button>
        </div>
      )}

      {phase === "recording" && (
        <div className="recording" role="status" aria-live="assertive">
          <span className="rec-dot" aria-hidden="true" />
          <strong>{t("voice.recording")}</strong>
          <span className="font-mono">
            {fmtTime(elapsed)} / {fmtTime(MAX_SECONDS)}
          </span>
          <Button size="sm" variant="danger" icon={<Square size={12} />} onClick={stop}>
            {t("voice.stop")}
          </Button>
        </div>
      )}

      {phase === "transcribing" && <p className="text-[12px] text-fg-muted">{t("voice.transcribing")}</p>}

      {phase === "review" && (
        <div className="subcard flex flex-col gap-2">
          <label htmlFor={`${base}-text`}>{t("voice.review")}</label>
          <textarea
            className="input"
            id={`${base}-text`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            maxLength={20_000}
          />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={commit.busy || text.trim().length === 0} onClick={insert}>
              {t("voice.insert")}
            </Button>
            <Button size="sm" variant="ghost" disabled={commit.busy} onClick={discard}>
              {t("voice.discard")}
            </Button>
          </div>
          <ErrorNotice error={commit.error} />
        </div>
      )}

      <ErrorNotice error={error} />
    </div>
  );
}
