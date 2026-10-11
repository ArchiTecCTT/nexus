// Moteur commun des connecteurs API : requête HTTPS en `fetch` natif, lecture plafonnée du flux SSE, traduction
// par un décodeur propre au fournisseur, normalisation en AgentEvent validés.
//
// Garanties (mêmes que runCliTask) : séquences strictement croissantes, exactement un terminal, chaque événement
// validé par le contrat (EventSequencer). En plus : la clé API n'est lue qu'au moment de la requête, n'est jamais
// conservée par le connecteur et est expurgée de tout texte émis (AC-09).
//
// Séquence nominale : started → output* (channel "message") → usage? (source "reported", jetons seulement,
// jamais de coût inventé) → completed. Échecs normalisés :
//   401/403 → auth_required · 429 → rate_limited (retry-after recopié) · 5xx, autres 4xx, erreur dans le flux,
//   flux illisible → provider_error · DNS/connexion refusée/coupure de connexion → network_error ·
//   fin de flux propre sans marqueur de fin → stream_ended_without_result · réponse trop volumineuse →
//   invalid_output · signal de l'appelant → cancelled · req.timeoutMs → timeout · req.budget.tokens → budget_exceeded.
import type { AgentEvent, AgentTaskRequest, ConnectorManifest, FailureCode, ProbeResult } from "@nexus/contracts";
import { AsyncQueue, EventSequencer, type EventBody } from "@nexus/connectors";
import { makeRedactor, type Redactor } from "./redact.ts";
import { SseParser, type SseEvent } from "./sse.ts";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type TokenUsage = { inputTokens?: number; outputTokens?: number };

/** Ce qu'un événement SSE du fournisseur apporte. */
export type DecodedEvent = {
  text?: string;
  /** Valeurs cumulées : un champ présent remplace le précédent. */
  usage?: TokenUsage;
  responseId?: string;
  /** Marqueur de fin explicite (`[DONE]`, `message_stop`…). */
  done?: boolean;
  /** Erreur signalée dans le flux par le fournisseur. */
  error?: { message: string; code?: FailureCode };
};

export type StreamDecoder = {
  onEvent(ev: SseEvent): DecodedEvent | undefined;
  /** Appelé à la fin propre du flux sans marqueur `done` : `true` si cette fin est légitime (Gemini). */
  endIsTerminal(): boolean;
};

export type BuiltRequest = { url: string; headers: Record<string, string>; body: unknown };

export type RequestInput = {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  systemPrompt?: string;
  /** Plafond de jetons de sortie (option du profil, abaissé au budget de la tâche). */
  maxOutputTokens?: number;
};

/** Description d'un fournisseur. */
export type ProviderSpec = {
  defaultId: string;
  displayName: string;
  defaultBaseUrl: string;
  /** Plafond de sortie par défaut quand le fournisseur l'exige (Anthropic). */
  requiredMaxOutputTokens?: number;
  buildRequest(input: RequestInput): BuiltRequest;
  createDecoder(): StreamDecoder;
  /** Classification spécifique d'une erreur HTTP (ex. Gemini renvoie 400 pour une clé invalide). */
  classifyHttpError?(status: number, body: unknown): FailureCode | undefined;
};

export type ApiConnectorOptions = {
  /** Identifiant du profil (FR-007 : un connecteur par compte), ex. `openai-api-perso`. */
  id?: string;
  /** Libellé du compte affiché à côté du nom du fournisseur. */
  accountLabel?: string;
  model: string;
  /** Fournie par le coffre (T-015). Appelée à chaque requête ; la valeur n'est jamais conservée. */
  getApiKey: () => Promise<string>;
  /** Permet à `probe()` de savoir si une clé existe sans la lire. À défaut, `getApiKey` est appelée. */
  hasApiKey?: () => Promise<boolean>;
  /** HTTPS obligatoire, sauf hôte de bouclage (tests, serveurs compatibles locaux). */
  baseUrl?: string;
  fetch?: FetchLike;
  systemPrompt?: string;
  maxOutputTokens?: number;
  /** Plafond d'octets lus sur une réponse en flux (défaut 8 Mio). */
  maxResponseBytes?: number;
  /** En-têtes supplémentaires non secrets (ex. HTTP-Referer / X-Title pour OpenRouter). */
  extraHeaders?: Record<string, string>;
};

export const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_ERROR_BODY_BYTES = 64 * 1024;
const MAX_OUTPUT_EVENT_CHARS = 500_000;
/** Estimation locale grossière pour couper un flux avant le décompte fournisseur (§16 « estimated »). */
const CHARS_PER_TOKEN = 4;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function normalizeBaseUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("baseUrl invalide");
  }
  if (u.username || u.password) throw new Error("baseUrl ne doit pas contenir d'identifiants");
  if (u.protocol !== "https:" && !(u.protocol === "http:" && LOOPBACK.has(u.hostname))) {
    throw new Error("baseUrl doit être en HTTPS (HTTP accepté seulement sur l'hôte de bouclage)");
  }
  if (u.search || u.hash) throw new Error("baseUrl ne doit contenir ni requête ni fragment");
  return u.toString().replace(/\/+$/, "");
}

export function buildManifest(spec: ProviderSpec, opts: ApiConnectorOptions): ConnectorManifest {
  const label = opts.accountLabel?.trim();
  return {
    id: opts.id ?? spec.defaultId,
    version: "0.1.0",
    kind: "api",
    displayName: (label ? `${spec.displayName} (${label})` : spec.displayName).slice(0, 200),
    capabilities: ["chat", "stream", "usage"],
    supportedPlatforms: ["linux", "darwin", "win32"],
    authModes: ["api-key"],
    // Aucun essai réel avec une clé n'a été possible : formats suivis d'après la documentation publique (§26).
    maturity: "beta",
  };
}

/** Sonde sans réseau : seule la présence d'une clé est vérifiée ; l'authentification n'est pas testée. */
export async function probeApiKey(connectorId: string, opts: ApiConnectorOptions): Promise<ProbeResult> {
  let configured = false;
  try {
    if (opts.hasApiKey) configured = (await opts.hasApiKey()) === true;
    else {
      const k = await opts.getApiKey();
      configured = typeof k === "string" && k.trim().length > 0;
    }
  } catch {
    configured = false;
  }
  return {
    connectorId,
    installed: configured,
    reason: configured
      ? "Clé API configurée ; authentification non vérifiée (aucun appel réseau pendant la sonde)"
      : "Aucune clé API configurée pour ce profil",
    probedAt: new Date().toISOString(),
  };
}

class StreamReadError extends Error {}

function isFiniteInt(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

/** Utilitaire pour les décodeurs : entier ≥ 0 ou undefined. */
export function tokenCount(n: unknown): number | undefined {
  return isFiniteInt(n) ? Math.trunc(n) : undefined;
}

function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("aborted"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e instanceof Error ? e : new Error("rejected"));
      },
    );
  });
}

async function readCappedText(res: Response, max: number, signal: AbortSignal): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < max) {
      const { value, done } = await raceAbort(reader.read(), signal);
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } catch {
    /* corps d'erreur partiel : on garde ce qui a été lu */
  } finally {
    reader.cancel().catch(() => {});
  }
  const buf = Buffer.concat(chunks).subarray(0, max);
  return new TextDecoder().decode(buf);
}

function providerErrorMessage(body: unknown, raw: string): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, any>;
    const e = b.error;
    if (e && typeof e === "object") {
      const parts = [e.type ?? e.status ?? e.code, e.message].filter(
        (x) => typeof x === "string" || typeof x === "number",
      );
      if (parts.length > 0) return parts.join(" : ");
    }
    if (typeof e === "string") return e;
    if (typeof b.message === "string") return b.message;
  }
  return raw.replace(/\s+/g, " ").trim().slice(0, 300);
}

function describeNetworkError(e: unknown): string {
  const err = e as { message?: unknown; cause?: { code?: unknown; message?: unknown } };
  const code = typeof err?.cause?.code === "string" ? err.cause.code : undefined;
  const msg =
    typeof err?.cause?.message === "string"
      ? err.cause.message
      : typeof err?.message === "string"
        ? err.message
        : "erreur inconnue";
  return code ? `${code} (${msg})` : msg;
}

function sanitizeRetryAfter(v: string | null): string | undefined {
  if (!v) return undefined;
  const s = v.trim().slice(0, 64);
  return /^[\w ,:+-]+$/.test(s) ? s : undefined;
}

export type ApiTask = {
  connectorId: string;
  spec: ProviderSpec;
  opts: ApiConnectorOptions;
  baseUrl: string;
  req: AgentTaskRequest;
  signal: AbortSignal;
};

export function runApiTask(task: ApiTask): AsyncIterable<AgentEvent> {
  const { spec, opts, req, signal } = task;
  const queue = new AsyncQueue<AgentEvent>();
  const seq = new EventSequencer(req.taskId, (e) => queue.push(e));
  let redact: Redactor = makeRedactor([]);
  const name = spec.displayName;

  const emit = (body: EventBody): void => {
    if (body.kind === "output") seq.emit({ ...body, text: redact(body.text) });
    else if (body.kind === "failed") seq.emit({ ...body, message: redact(body.message).slice(0, 2000) });
    else seq.emit(body);
  };
  const fail = (code: FailureCode, message: string): void => emit({ kind: "failed", code, message });

  void (async () => {
    const timeoutSignal = AbortSignal.timeout(req.timeoutMs);
    const internal = new AbortController();
    const combined = AbortSignal.any([signal, timeoutSignal, internal.signal]);
    let budgetHit = false;
    const failAborted = (): void => {
      if (signal.aborted) fail("cancelled", "Tâche annulée");
      else if (budgetHit) fail("budget_exceeded", "Budget de jetons dépassé");
      else if (timeoutSignal.aborted) fail("timeout", `Tâche au-delà de ${req.timeoutMs} ms`);
      else fail("cancelled", "Requête interrompue");
    };

    try {
      if (combined.aborted) return failAborted();

      // 1. Clé : lue au dernier moment, jamais conservée ; le message d'une éventuelle exception n'est pas recopié.
      let apiKey: string;
      try {
        apiKey = await raceAbort(opts.getApiKey(), combined);
      } catch {
        if (combined.aborted) return failAborted();
        return fail("auth_required", `${name} : clé API indisponible dans le coffre`);
      }
      if (typeof apiKey !== "string" || apiKey.trim() === "") {
        return fail("auth_required", `${name} : aucune clé API configurée`);
      }
      redact = makeRedactor([apiKey, apiKey.trim()]);

      const budgetTokens = req.budget?.tokens;
      const maxOut = [opts.maxOutputTokens ?? spec.requiredMaxOutputTokens, budgetTokens].filter(isFiniteInt);
      let built: BuiltRequest;
      try {
        built = spec.buildRequest({
          baseUrl: task.baseUrl,
          apiKey,
          model: opts.model,
          prompt: req.prompt,
          ...(opts.systemPrompt !== undefined && { systemPrompt: opts.systemPrompt }),
          ...(maxOut.length > 0 && { maxOutputTokens: Math.min(...maxOut) }),
        });
      } catch (e) {
        return fail("provider_error", `${name} : requête impossible à construire (${(e as Error).message})`);
      }
      apiKey = "";

      // 2. Requête. `redirect: "error"` : les en-têtes porteurs de la clé ne suivent jamais une redirection.
      let res: Response;
      try {
        res = await (opts.fetch ?? fetch)(built.url, {
          method: "POST",
          headers: { ...opts.extraHeaders, ...built.headers, accept: "text/event-stream" },
          body: JSON.stringify(built.body),
          signal: combined,
          redirect: "error",
        });
      } catch (e) {
        if (combined.aborted) return failAborted();
        return fail("network_error", `${name} : erreur réseau — ${describeNetworkError(e)}`);
      } finally {
        built.headers = {};
      }

      // 3. Erreur HTTP : corps lu de façon plafonnée, message fournisseur expurgé.
      if (!res.ok) {
        const raw = await readCappedText(res, MAX_ERROR_BODY_BYTES, combined);
        if (combined.aborted) return failAborted();
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          body = undefined;
        }
        const s = res.status;
        const code: FailureCode =
          spec.classifyHttpError?.(s, body) ??
          (s === 401 || s === 403 ? "auth_required" : s === 429 ? "rate_limited" : "provider_error");
        const retry = code === "rate_limited" ? sanitizeRetryAfter(res.headers.get("retry-after")) : undefined;
        const detail = providerErrorMessage(body, raw);
        return fail(
          code,
          `${name} : HTTP ${s}${retry ? ` (retry-after: ${retry})` : ""}${detail ? ` — ${detail}` : ""}`,
        );
      }
      if (!res.body) return fail("provider_error", `${name} : réponse sans corps`);

      emit({ kind: "started" });

      // 4. Flux.
      const decoder = spec.createDecoder();
      const parser = new SseParser();
      const text = new TextDecoder("utf-8");
      const maxBytes = opts.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
      const usage: TokenUsage = {};
      let responseId: string | undefined;
      let outChars = 0;
      let bytes = 0;
      let finished = false;
      let streamError: DecodedEvent["error"];

      const flush = (s: string): void => {
        for (let i = 0; i < s.length; i += MAX_OUTPUT_EVENT_CHARS) {
          emit({ kind: "output", channel: "message", text: s.slice(i, i + MAX_OUTPUT_EVENT_CHARS) });
        }
        outChars += s.length;
      };
      const handle = (events: SseEvent[]): void => {
        let pending = "";
        for (const ev of events) {
          let d: DecodedEvent | undefined;
          try {
            d = decoder.onEvent(ev);
          } catch {
            d = { error: { message: "événement de flux illisible" } };
          }
          if (!d) continue;
          if (d.text) pending += d.text;
          if (d.usage) {
            if (d.usage.inputTokens !== undefined) usage.inputTokens = d.usage.inputTokens;
            if (d.usage.outputTokens !== undefined) usage.outputTokens = d.usage.outputTokens;
          }
          if (d.responseId) responseId = d.responseId.slice(0, 200);
          if (d.error) {
            streamError = d.error;
            break;
          }
          if (d.done) {
            finished = true;
            break;
          }
        }
        if (pending) flush(pending);
      };
      const reportedUsage = (): void => {
        if (usage.inputTokens === undefined && usage.outputTokens === undefined) return;
        emit({ kind: "usage", source: "reported", ...usage });
      };

      const reader = res.body.getReader();
      try {
        while (!finished && !streamError) {
          let chunk: Awaited<ReturnType<typeof reader.read>>;
          try {
            chunk = await reader.read();
          } catch (e) {
            throw new StreamReadError(describeNetworkError(e));
          }
          if (chunk.done) {
            handle(parser.push(text.decode()));
            if (!finished && !streamError) handle(parser.end());
            break;
          }
          bytes += chunk.value.byteLength;
          if (bytes > maxBytes) {
            internal.abort();
            return fail("invalid_output", `${name} : réponse au-delà de ${maxBytes} octets, lecture interrompue`);
          }
          handle(parser.push(text.decode(chunk.value, { stream: true })));

          if (budgetTokens !== undefined && !finished && !streamError) {
            const estOut = Math.ceil(outChars / CHARS_PER_TOKEN);
            const used = (usage.inputTokens ?? 0) + Math.max(usage.outputTokens ?? 0, estOut);
            if (used > budgetTokens) {
              budgetHit = true;
              internal.abort();
              emit({
                kind: "usage",
                source: "estimated",
                ...(usage.inputTokens !== undefined && { inputTokens: usage.inputTokens }),
                outputTokens: Math.max(usage.outputTokens ?? 0, estOut),
                caveat: `Flux interrompu avant le décompte du fournisseur ; sortie estimée localement (~${CHARS_PER_TOKEN} caractères par jeton)`,
              });
              return fail(
                "budget_exceeded",
                `${name} : budget de ${budgetTokens} jetons dépassé (~${used} estimés), flux interrompu`,
              );
            }
          }
        }
      } catch (e) {
        if (combined.aborted) return failAborted();
        if (e instanceof StreamReadError)
          return fail("network_error", `${name} : connexion interrompue pendant le flux — ${e.message}`);
        throw e;
      } finally {
        reader.cancel().catch(() => {});
      }

      if (streamError)
        return fail(streamError.code ?? "provider_error", `${name} : erreur dans le flux — ${streamError.message}`);
      if (!finished && !decoder.endIsTerminal()) {
        return fail("stream_ended_without_result", `${name} : flux terminé sans marqueur de fin`);
      }
      reportedUsage();
      if (budgetTokens !== undefined) {
        const total = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
        if (total > budgetTokens)
          return fail(
            "budget_exceeded",
            `${name} : budget de ${budgetTokens} jetons dépassé (${total} décomptés par le fournisseur)`,
          );
      }
      emit({ kind: "completed", resultRef: `${task.connectorId}:${responseId ?? req.taskId}` });
    } catch (e) {
      if (combined.aborted) failAborted();
      else fail("provider_error", `${name} : erreur interne du connecteur — ${(e as Error)?.message ?? "inconnue"}`);
    } finally {
      queue.end();
    }
  })();

  return queue;
}
