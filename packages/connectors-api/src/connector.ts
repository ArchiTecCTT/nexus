// Connecteur API générique : un fournisseur (ProviderSpec) + un profil de compte (ApiConnectorOptions).
// Plusieurs comptes d'un même fournisseur = plusieurs instances avec des `id` distincts (FR-007).
import {
  ConnectorManifest,
  type AgentConnector,
  type AgentEvent,
  type AgentTaskRequest,
  type ProbeResult,
} from "@nexus/contracts";
import {
  buildManifest,
  normalizeBaseUrl,
  probeApiKey,
  runApiTask,
  type ApiConnectorOptions,
  type ProviderSpec,
} from "./run-api.ts";

export class ApiConnector implements AgentConnector {
  readonly manifest: ConnectorManifest;
  readonly #spec: ProviderSpec;
  readonly #opts: ApiConnectorOptions;
  readonly #baseUrl: string;

  constructor(spec: ProviderSpec, opts: ApiConnectorOptions) {
    if (typeof opts.getApiKey !== "function")
      throw new Error("getApiKey est obligatoire (la clé n'est jamais passée en clair)");
    if (typeof opts.model !== "string" || opts.model.trim() === "") throw new Error("model est obligatoire");
    this.#spec = spec;
    this.#opts = { ...opts };
    this.#baseUrl = normalizeBaseUrl(opts.baseUrl ?? spec.defaultBaseUrl);
    this.manifest = ConnectorManifest.parse(buildManifest(spec, opts));
  }

  probe(): Promise<ProbeResult> {
    return probeApiKey(this.manifest.id, this.#opts);
  }

  start(req: AgentTaskRequest, signal: AbortSignal): AsyncIterable<AgentEvent> {
    return runApiTask({
      connectorId: this.manifest.id,
      spec: this.#spec,
      opts: this.#opts,
      baseUrl: this.#baseUrl,
      req,
      signal,
    });
  }
}
