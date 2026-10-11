// Anthropic Messages API en flux SSE.
// Format d'après la documentation publique (non vérifié contre l'API réelle) :
//   POST {base}/v1/messages, en-têtes `x-api-key`, `anthropic-version: 2023-06-01` ; `max_tokens` obligatoire.
//   Événements : message_start (message.id, message.usage.input_tokens), content_block_start,
//   content_block_delta (delta.type "text_delta", delta.text), content_block_stop,
//   message_delta (usage.output_tokens cumulés), message_stop (fin), ping (ignoré), error (erreur en cours de flux).
import type { FailureCode } from "@nexus/contracts";
import { ApiConnector } from "../connector.ts";
import {
  tokenCount,
  type ApiConnectorOptions,
  type DecodedEvent,
  type ProviderSpec,
  type StreamDecoder,
  type TokenUsage,
} from "../run-api.ts";

function anthropicUsage(u: Record<string, any> | undefined): TokenUsage | undefined {
  if (!u || typeof u !== "object") return undefined;
  // Les jetons lus/écrits en cache sont comptés en entrée : ils comptent pour le budget (tarifs différents, non calculés ici).
  const parts = [u.input_tokens, u.cache_creation_input_tokens, u.cache_read_input_tokens].map(tokenCount);
  const hasInput = parts.some((p) => p !== undefined);
  const inputTokens = parts.reduce<number>((a, p) => a + (p ?? 0), 0);
  const outputTokens = tokenCount(u.output_tokens);
  return { ...(hasInput && { inputTokens }), ...(outputTokens !== undefined && { outputTokens }) };
}

const ERROR_CODES: Record<string, FailureCode> = {
  authentication_error: "auth_required",
  permission_error: "auth_required",
  rate_limit_error: "rate_limited",
};

export function createAnthropicDecoder(): StreamDecoder {
  return {
    onEvent(ev): DecodedEvent | undefined {
      const msg = JSON.parse(ev.data) as Record<string, any>;
      const type = typeof msg?.type === "string" ? msg.type : ev.event;
      switch (type) {
        case "message_start": {
          const usage = anthropicUsage(msg.message?.usage);
          return {
            ...(typeof msg.message?.id === "string" && { responseId: msg.message.id }),
            ...(usage && { usage }),
          };
        }
        case "content_block_delta":
          return msg.delta?.type === "text_delta" && typeof msg.delta.text === "string"
            ? { text: msg.delta.text }
            : undefined;
        case "message_delta": {
          const usage = anthropicUsage(msg.usage);
          return usage ? { usage } : undefined;
        }
        case "message_stop":
          return { done: true };
        case "error": {
          const e = msg.error ?? {};
          const errType = typeof e.type === "string" ? e.type : "error";
          const code = ERROR_CODES[errType];
          return {
            error: { message: `${errType} : ${typeof e.message === "string" ? e.message : ""}`, ...(code && { code }) },
          };
        }
        default:
          return undefined; // ping, content_block_start/stop, types futurs
      }
    },
    endIsTerminal: () => false,
  };
}

export const ANTHROPIC_SPEC: ProviderSpec = {
  defaultId: "anthropic-api",
  displayName: "Anthropic API",
  defaultBaseUrl: "https://api.anthropic.com",
  requiredMaxOutputTokens: 4096,
  buildRequest: (i) => ({
    url: `${i.baseUrl}/v1/messages`,
    headers: { "x-api-key": i.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: {
      model: i.model,
      max_tokens: i.maxOutputTokens ?? 4096,
      ...(i.systemPrompt !== undefined && { system: i.systemPrompt }),
      messages: [{ role: "user", content: i.prompt }],
      stream: true,
    },
  }),
  createDecoder: createAnthropicDecoder,
};

export class AnthropicApiConnector extends ApiConnector {
  constructor(opts: ApiConnectorOptions) {
    super(ANTHROPIC_SPEC, opts);
  }
}
