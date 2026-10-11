// OpenAI Chat Completions en flux SSE, et OpenRouter (API compatible OpenAI).
// Formats d'après la documentation publique (non vérifiés contre l'API réelle) :
//   POST {base}/chat/completions, `Authorization: Bearer <clé>`, `stream: true`,
//   `stream_options.include_usage: true` → dernier chunk avec `choices: []` et `usage`.
//   Chunks `chat.completion.chunk` : choices[].delta.content, choices[].finish_reason ; fin par `data: [DONE]`.
//   OpenRouter : commentaires SSE `: OPENROUTER PROCESSING`, erreur en cours de flux via un champ `error`
//   (avec `finish_reason: "error"`).
import { ApiConnector } from "../connector.ts";
import {
  tokenCount,
  type ApiConnectorOptions,
  type DecodedEvent,
  type ProviderSpec,
  type StreamDecoder,
} from "../run-api.ts";

export function createOpenAiChatDecoder(): StreamDecoder {
  let sawFinish = false;
  return {
    onEvent(ev): DecodedEvent | undefined {
      if (ev.data.trim() === "[DONE]") return { done: true };
      const msg = JSON.parse(ev.data) as Record<string, any>;
      if (!msg || typeof msg !== "object") return undefined;
      const out: DecodedEvent = {};
      if (typeof msg.id === "string") out.responseId = msg.id;
      if (msg.error) {
        const e = msg.error;
        const message = typeof e === "string" ? e : [e.code, e.message].filter((x) => x !== undefined).join(" : ");
        out.error = { message: message || "erreur fournisseur" };
        return out;
      }
      let text = "";
      for (const c of Array.isArray(msg.choices) ? msg.choices : []) {
        if (typeof c?.delta?.content === "string") text += c.delta.content;
        if (c?.finish_reason) sawFinish = true;
        if (c?.finish_reason === "error") out.error = { message: "le fournisseur a interrompu la génération" };
      }
      if (text) out.text = text;
      const u = msg.usage;
      if (u && typeof u === "object") {
        const inputTokens = tokenCount(u.prompt_tokens);
        const outputTokens = tokenCount(u.completion_tokens);
        out.usage = {
          ...(inputTokens !== undefined && { inputTokens }),
          ...(outputTokens !== undefined && { outputTokens }),
        };
      }
      return out;
    },
    // Tolérance : un flux qui s'arrête après `finish_reason` sans `[DONE]` est considéré complet.
    endIsTerminal: () => sawFinish,
  };
}

function chatBody(
  input: { model: string; prompt: string; systemPrompt?: string },
  maxField: string,
  maxOutputTokens?: number,
) {
  return {
    model: input.model,
    messages: [
      ...(input.systemPrompt !== undefined ? [{ role: "system", content: input.systemPrompt }] : []),
      { role: "user", content: input.prompt },
    ],
    stream: true,
    stream_options: { include_usage: true },
    ...(maxOutputTokens !== undefined && { [maxField]: maxOutputTokens }),
  };
}

export const OPENAI_SPEC: ProviderSpec = {
  defaultId: "openai-api",
  displayName: "OpenAI API",
  defaultBaseUrl: "https://api.openai.com/v1",
  buildRequest: (i) => ({
    url: `${i.baseUrl}/chat/completions`,
    headers: { authorization: `Bearer ${i.apiKey}`, "content-type": "application/json" },
    body: chatBody(i, "max_completion_tokens", i.maxOutputTokens),
  }),
  createDecoder: createOpenAiChatDecoder,
};

export const OPENROUTER_SPEC: ProviderSpec = {
  defaultId: "openrouter-api",
  displayName: "OpenRouter",
  defaultBaseUrl: "https://openrouter.ai/api/v1",
  buildRequest: (i) => ({
    url: `${i.baseUrl}/chat/completions`,
    headers: { authorization: `Bearer ${i.apiKey}`, "content-type": "application/json" },
    body: chatBody(i, "max_tokens", i.maxOutputTokens),
  }),
  createDecoder: createOpenAiChatDecoder,
  // OpenRouter : 402 = crédits insuffisants (reste provider_error, message fournisseur conservé).
};

export class OpenAiApiConnector extends ApiConnector {
  constructor(opts: ApiConnectorOptions) {
    super(OPENAI_SPEC, opts);
  }
}

export class OpenRouterApiConnector extends ApiConnector {
  constructor(opts: ApiConnectorOptions) {
    super(OPENROUTER_SPEC, opts);
  }
}
