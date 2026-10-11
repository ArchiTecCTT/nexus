// Google AI Studio (Gemini API) : `streamGenerateContent` en SSE.
// Format d'après la documentation publique (non vérifié contre l'API réelle) :
//   POST {base}/models/{model}:streamGenerateContent?alt=sse, clé dans l'en-tête `x-goog-api-key`
//   (jamais dans l'URL : elle finirait dans les journaux de proxys et les messages d'erreur).
//   Chaque `data:` est un GenerateContentResponse : candidates[].content.parts[].text, candidates[].finishReason,
//   usageMetadata { promptTokenCount, candidatesTokenCount, thoughtsTokenCount } cumulés, responseId.
//   Pas de marqueur `[DONE]` : la fin du flux HTTP après un `finishReason` est la fin normale.
//   Une clé invalide est signalée par HTTP 400 (raison API_KEY_INVALID).
import { ApiConnector } from "../connector.ts";
import {
  tokenCount,
  type ApiConnectorOptions,
  type DecodedEvent,
  type ProviderSpec,
  type StreamDecoder,
} from "../run-api.ts";

export function createGeminiDecoder(): StreamDecoder {
  let sawFinish = false;
  return {
    onEvent(ev): DecodedEvent | undefined {
      const msg = JSON.parse(ev.data) as Record<string, any>;
      if (!msg || typeof msg !== "object") return undefined;
      if (msg.error) {
        const e = msg.error;
        return {
          error: {
            message: [e.status, e.message].filter((x) => typeof x === "string").join(" : ") || "erreur fournisseur",
          },
        };
      }
      const out: DecodedEvent = {};
      if (typeof msg.responseId === "string") out.responseId = msg.responseId;
      if (typeof msg.promptFeedback?.blockReason === "string") {
        out.error = { message: `requête bloquée par le fournisseur (${msg.promptFeedback.blockReason})` };
        return out;
      }
      let text = "";
      for (const c of Array.isArray(msg.candidates) ? msg.candidates : []) {
        for (const p of Array.isArray(c?.content?.parts) ? c.content.parts : []) {
          // Les parties de raisonnement (`thought: true`) ne sont pas recopiées comme message.
          if (typeof p?.text === "string" && p.thought !== true) text += p.text;
        }
        if (typeof c?.finishReason === "string") sawFinish = true;
      }
      if (text) out.text = text;
      const u = msg.usageMetadata;
      if (u && typeof u === "object") {
        const inputTokens = tokenCount(u.promptTokenCount);
        const cand = tokenCount(u.candidatesTokenCount);
        const thoughts = tokenCount(u.thoughtsTokenCount);
        // Les jetons de raisonnement sont facturés en sortie : ils comptent dans outputTokens.
        const outputTokens = cand === undefined && thoughts === undefined ? undefined : (cand ?? 0) + (thoughts ?? 0);
        out.usage = {
          ...(inputTokens !== undefined && { inputTokens }),
          ...(outputTokens !== undefined && { outputTokens }),
        };
      }
      return out;
    },
    endIsTerminal: () => sawFinish,
  };
}

export const GOOGLE_SPEC: ProviderSpec = {
  defaultId: "google-ai-studio",
  displayName: "Google AI Studio",
  defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
  buildRequest: (i) => {
    const model = i.model.replace(/^models\//, "");
    return {
      url: `${i.baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      headers: { "x-goog-api-key": i.apiKey, "content-type": "application/json" },
      body: {
        contents: [{ role: "user", parts: [{ text: i.prompt }] }],
        ...(i.systemPrompt !== undefined && { systemInstruction: { parts: [{ text: i.systemPrompt }] } }),
        ...(i.maxOutputTokens !== undefined && { generationConfig: { maxOutputTokens: i.maxOutputTokens } }),
      },
    };
  },
  createDecoder: createGeminiDecoder,
  classifyHttpError(status, body) {
    if (status !== 400 || !body || typeof body !== "object") return undefined;
    const e = (body as Record<string, any>).error ?? {};
    const reasons = (Array.isArray(e.details) ? e.details : []).map((d: any) => d?.reason);
    if (reasons.includes("API_KEY_INVALID") || /api key/i.test(String(e.message ?? ""))) return "auth_required";
    return undefined;
  },
};

export class GoogleAiStudioConnector extends ApiConnector {
  constructor(opts: ApiConnectorOptions) {
    super(GOOGLE_SPEC, opts);
  }
}
