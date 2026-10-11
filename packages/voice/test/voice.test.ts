// T-020 — consentement, bornes, relecture obligatoire, moteurs (fausse CLI whisper, faux service HTTP).
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LocalWhisperEngine,
  OpenAiTranscriptionEngine,
  TranscriptionError,
  VoiceSession,
  VoiceSessionError,
} from "../src/index.ts";

test("AC-11 : aucun enregistrement sans geste ET consentement ; micro accordé seulement pendant la fenêtre armée", () => {
  let now = 0;
  const s = new VoiceSession({ armWindowMs: 10_000, maxDurationMs: 60_000, maxBytes: 1000 }, () => now);
  assert.equal(s.mayGrantMicrophone(), false);
  assert.throws(() => s.arm({ userGesture: false, consent: true }), VoiceSessionError);
  assert.throws(() => s.arm({ userGesture: true, consent: false }), VoiceSessionError);
  assert.throws(() => s.startRecording(), VoiceSessionError, "pas de démarrage silencieux");
  s.arm({ userGesture: true, consent: true });
  assert.equal(s.mayGrantMicrophone(), true);
  now = 11_000;
  assert.equal(s.mayGrantMicrophone(), false, "fenêtre expirée");
  assert.throws(() => s.startRecording(), VoiceSessionError);
});

test("transcription relue avant envoi ; taille et durée bornées ; brouillon jetable", () => {
  let now = 0;
  const s = new VoiceSession({ armWindowMs: 10_000, maxDurationMs: 60_000, maxBytes: 1000 }, () => now);
  s.arm({ userGesture: true, consent: true });
  s.startRecording();
  s.acceptAudio(500);
  assert.throws(() => s.commit("texte"), VoiceSessionError, "pas d'envoi avant la transcription");
  s.transcribed("bonjour le monde");
  assert.equal(s.state, "review");
  assert.equal(s.commit("  Bonjour, le monde !  "), "Bonjour, le monde !", "texte corrigé par l'utilisateur");
  assert.equal(s.state, "sent");

  const big = new VoiceSession({ armWindowMs: 10_000, maxDurationMs: 60_000, maxBytes: 1000 }, () => now);
  big.arm({ userGesture: true, consent: true });
  big.startRecording();
  assert.throws(() => big.acceptAudio(5000), VoiceSessionError);
  assert.equal(big.state, "discarded");

  const long = new VoiceSession({ armWindowMs: 10_000, maxDurationMs: 1000, maxBytes: 1000 }, () => now);
  long.arm({ userGesture: true, consent: true });
  long.startRecording();
  now += 10_000;
  assert.throws(() => long.acceptAudio(10), VoiceSessionError);
});

function tmp(t: TestContext): string {
  const d = mkdtempSync(join(tmpdir(), "nexus-voice-test-"));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

test("moteur local : indisponible sans whisper.cpp ni modèle (état honnête) ; transcription via fausses CLI ; audio supprimé", async (t) => {
  assert.equal(new LocalWhisperEngine({}).status().available, false);
  assert.match(String(new LocalWhisperEngine({ ffmpegPath: "/usr/bin/ffmpeg" }).status().reason), /whisper/);
  const d = tmp(t);
  const ffmpeg = join(d, "ffmpeg");
  const whisper = join(d, "whisper-cli");
  const model = join(d, "model.bin");
  writeFileSync(model, "fake");
  // Fausse conversion : copie l'entrée vers la sortie (dernier argument).
  writeFileSync(ffmpeg, `#!/bin/sh\nfor a; do last="$a"; done\nprintf 'RIFFwav' > "$last"\n`);
  writeFileSync(whisper, `#!/bin/sh\necho "bonjour depuis whisper ($6)"\n`);
  chmodSync(ffmpeg, 0o755);
  chmodSync(whisper, 0o755);
  const engine = new LocalWhisperEngine({ whisperPath: whisper, modelPath: model, ffmpegPath: ffmpeg });
  assert.equal(engine.status().available, true);
  const before = readdirSync(tmpdir()).filter((n) => n.startsWith("nexus-voice-") && !n.includes("test")).length;
  assert.equal(await engine.transcribe(Buffer.from("audio"), "audio/webm", "fr"), "bonjour depuis whisper (fr)");
  const after = readdirSync(tmpdir()).filter((n) => n.startsWith("nexus-voice-") && !n.includes("test")).length;
  assert.equal(after, before, "aucun fichier audio temporaire conservé");
});

test("moteur cloud : opt-in, modèle et clé exigés ; multipart envoyé ; erreurs normalisées sans fuite de clé", async (t) => {
  assert.match(String(new OpenAiTranscriptionEngine({ optIn: false }).status().reason), /consentement/);
  let received = "";
  const server = createServer((req, res) => {
    let body = "";
    req
      .on("data", (c) => (body += c))
      .on("end", () => {
        received = `${req.headers.authorization}|${body.includes('name="model"')}|${body.includes("whisper-test")}`;
        if (req.headers.authorization !== "Bearer fixture-key-123456789") {
          res.writeHead(401).end('{"error":"bad key fixture-key-123456789"}');
          return;
        }
        res.writeHead(200, { "content-type": "application/json" }).end('{"text":" bonjour "}');
      });
  }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  const ok = new OpenAiTranscriptionEngine({
    optIn: true,
    model: "whisper-test",
    getApiKey: async () => "fixture-key-123456789",
    baseUrl,
  });
  assert.equal(await ok.transcribe(Buffer.from("x"), "audio/webm", "fr"), "bonjour");
  assert.equal(received, "Bearer fixture-key-123456789|true|true");
  const bad = new OpenAiTranscriptionEngine({
    optIn: true,
    model: "whisper-test",
    getApiKey: async () => "wrong-key-000000000",
    baseUrl,
  });
  await assert.rejects(
    bad.transcribe(Buffer.from("x"), "audio/webm", "en"),
    (e: unknown) => e instanceof TranscriptionError && !e.message.includes("fixture-key"),
  );
  const http = new OpenAiTranscriptionEngine({
    optIn: true,
    model: "m",
    getApiKey: async () => "k",
    baseUrl: "http://example.com/v1",
  });
  await assert.rejects(http.transcribe(Buffer.from("x"), "audio/webm", "fr"), /HTTPS/);
});
