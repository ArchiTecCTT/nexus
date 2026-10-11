// Tests des connecteurs API contre un serveur HTTP local rejouant des flux SSE de fixtures.
// Les fixtures suivent les formats publiquement documentés ; elles ne sont PAS vérifiées contre les vraies API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { AgentEvent } from "@nexus/contracts";
import {
  AnthropicApiConnector,
  GoogleAiStudioConnector,
  OpenAiApiConnector,
  OpenRouterApiConnector,
  type ApiConnectorOptions,
  type FetchLike,
} from "../src/index.ts";
import {
  KEY,
  assertNoKey,
  collect,
  failedWith,
  fixture,
  jsonError,
  replay,
  replayByteByByte,
  request,
  serve,
  sseHead,
  terminal,
  type Recorded,
} from "./helpers.ts";

type Ctor = new (opts: ApiConnectorOptions) => OpenAiApiConnector;

type ProviderCase = {
  name: string;
  Ctor: Ctor;
  fixture: string;
  /** Préfixe ajouté à l'URL du serveur local pour former baseUrl. */
  basePath: string;
  model: string;
  expectedPath: string;
  checkAuth(rec: Recorded): void;
  responseId: string;
};

const PROVIDERS: ProviderCase[] = [
  {
    name: "OpenAI",
    Ctor: OpenAiApiConnector,
    fixture: "openai.sse",
    basePath: "/v1",
    model: "gpt-fixture",
    expectedPath: "/v1/chat/completions",
    checkAuth: (r) => assert.equal(r.headers.authorization, `Bearer ${KEY}`),
    responseId: "chatcmpl-fx1",
  },
  {
    name: "Anthropic",
    Ctor: AnthropicApiConnector,
    fixture: "anthropic.sse",
    basePath: "",
    model: "claude-fixture",
    expectedPath: "/v1/messages",
    checkAuth: (r) => {
      assert.equal(r.headers["x-api-key"], KEY);
      assert.equal(r.headers["anthropic-version"], "2023-06-01");
      assert.equal(r.headers.authorization, undefined);
    },
    responseId: "msg_fx3",
  },
  {
    name: "Google AI Studio",
    Ctor: GoogleAiStudioConnector,
    fixture: "google.sse",
    basePath: "/v1beta",
    model: "gemini-fixture",
    expectedPath: "/v1beta/models/gemini-fixture:streamGenerateContent?alt=sse",
    checkAuth: (r) => assert.equal(r.headers["x-goog-api-key"], KEY),
    responseId: "resp-fx4",
  },
  {
    name: "OpenRouter",
    Ctor: OpenRouterApiConnector,
    fixture: "openrouter.sse",
    basePath: "/api/v1",
    model: "vendor/model-fixture",
    expectedPath: "/api/v1/chat/completions",
    checkAuth: (r) => assert.equal(r.headers.authorization, `Bearer ${KEY}`),
    responseId: "gen-fx2",
  },
];

const OPENAI = PROVIDERS[0]!;
const ANTHROPIC = PROVIDERS[1]!;
const GOOGLE = PROVIDERS[2]!;

function connector(p: ProviderCase, baseUrl: string, extra: Partial<ApiConnectorOptions> = {}) {
  return new p.Ctor({ model: p.model, getApiKey: async () => KEY, baseUrl: baseUrl + p.basePath, ...extra });
}

function texts(events: AgentEvent[]): string {
  return events.map((e) => (e.kind === "output" ? e.text : "")).join("");
}

function kinds(events: AgentEvent[]): string[] {
  return events.map((e) => e.kind);
}

async function run(
  p: ProviderCase,
  baseUrl: string,
  extra: Partial<ApiConnectorOptions> = {},
  reqOver = {},
  signal = new AbortController().signal,
) {
  const req = request(reqOver);
  return collect(connector(p, baseUrl, extra).start(req, signal), req.taskId);
}

function assertNominal(p: ProviderCase, events: AgentEvent[]): void {
  assert.equal(events[0]!.kind, "started");
  const ks = kinds(events);
  assert.deepEqual(ks.slice(-2), ["usage", "completed"], ks.join(","));
  assert.ok(ks.slice(1, -2).every((k) => k === "output"));
  assert.ok(events.filter((e) => e.kind === "output").every((e) => e.channel === "message"));
  assert.equal(texts(events), "Bonjour, monde é✓");
  const usage = events.at(-2) as Extract<AgentEvent, { kind: "usage" }>;
  assert.deepEqual(
    { source: usage.source, in: usage.inputTokens, out: usage.outputTokens, usd: usage.usd },
    { source: "reported", in: 12, out: 5, usd: undefined },
    "jetons rapportés, aucun coût inventé",
  );
  const done = terminal(events) as Extract<AgentEvent, { kind: "completed" }>;
  assert.ok(done.resultRef.endsWith(p.responseId), done.resultRef);
}

for (const p of PROVIDERS) {
  test(`${p.name} : flux nominal started → output → usage → completed, requête conforme`, async (t) => {
    const srv = await serve(t, replay(fixture(p.fixture)));
    const events = await run(p, srv.baseUrl);
    assertNominal(p, events);
    const rec = srv.requests[0]!;
    assert.equal(rec.method, "POST");
    assert.equal(rec.url, p.expectedPath);
    assert.ok(!rec.url.includes(KEY), "la clé n'est jamais dans l'URL");
    p.checkAuth(rec);
    assert.ok(rec.body.includes("Dis bonjour"));
    assert.ok(!rec.body.includes(KEY), "la clé n'est jamais dans le corps");
  });

  test(`${p.name} : événements SSE découpés octet par octet`, async (t) => {
    const srv = await serve(t, replayByteByByte(fixture(p.fixture)));
    assertNominal(p, await run(p, srv.baseUrl));
  });

  test(`${p.name} : HTTP 401 → auth_required, 403 → auth_required`, async (t) => {
    const srv = await serve(t, (req, res, rec) =>
      jsonError(srv.requests.length === 1 ? 401 : 403, {
        error: { type: "authentication_error", message: "invalid x-api-key" },
      })(req, res, rec),
    );
    const e401 = await run(p, srv.baseUrl);
    assert.deepEqual(kinds(e401), ["failed"], "aucun started avant une erreur HTTP");
    assert.match(failedWith(e401, "auth_required").message, /HTTP 401/);
    assert.match(failedWith(await run(p, srv.baseUrl), "auth_required").message, /HTTP 403/);
  });

  test(`${p.name} : HTTP 429 → rate_limited avec retry-after`, async (t) => {
    const srv = await serve(t, jsonError(429, { error: { message: "Rate limit reached" } }, { "retry-after": "7" }));
    const f = failedWith(await run(p, srv.baseUrl), "rate_limited");
    assert.match(f.message, /retry-after: 7/);
    assert.match(f.message, /Rate limit reached/);
  });

  test(`${p.name} : HTTP 500 → provider_error`, async (t) => {
    const srv = await serve(t, (_req, res) => {
      res.writeHead(500, { "content-type": "text/html" });
      res.end("<html>Internal Server Error</html>");
    });
    assert.match(failedWith(await run(p, srv.baseUrl), "provider_error").message, /HTTP 500/);
  });
}

test("Google : HTTP 400 API_KEY_INVALID → auth_required ; autre 400 → provider_error", async (t) => {
  const srv = await serve(t, (req, res, rec) =>
    srv.requests.length === 1
      ? jsonError(400, {
          error: {
            code: 400,
            message: "API key not valid. Please pass a valid API key.",
            status: "INVALID_ARGUMENT",
            details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID" }],
          },
        })(req, res, rec)
      : jsonError(400, { error: { code: 400, message: "Invalid JSON payload", status: "INVALID_ARGUMENT" } })(
          req,
          res,
          rec,
        ),
  );
  failedWith(await run(GOOGLE, srv.baseUrl), "auth_required");
  failedWith(await run(GOOGLE, srv.baseUrl), "provider_error");
});

test("Coupure de connexion en plein flux → network_error, sans completed", async (t) => {
  const body = fixture(OPENAI.fixture);
  const srv = await serve(t, (_req, res) => {
    sseHead(res);
    res.write(body.slice(0, body.indexOf("monde")));
    setTimeout(() => res.socket?.destroy(), 30);
  });
  const events = await run(OPENAI, srv.baseUrl);
  assert.equal(events[0]!.kind, "started");
  assert.match(failedWith(events, "network_error").message, /interrompue/);
});

test("Fin de flux propre sans marqueur de fin → stream_ended_without_result (Anthropic et Gemini)", async (t) => {
  const a = fixture(ANTHROPIC.fixture);
  const g = fixture(GOOGLE.fixture);
  const srvA = await serve(t, replay(a.slice(0, a.indexOf("event: message_stop"))));
  failedWith(await run(ANTHROPIC, srvA.baseUrl), "stream_ended_without_result");
  const srvG = await serve(
    t,
    replay(g.slice(0, g.indexOf('data: {"candidates": [{"content": {"parts": [{"text": ", monde'))),
  );
  failedWith(await run(GOOGLE, srvG.baseUrl), "stream_ended_without_result");
});

test("Erreur réseau (connexion refusée) → network_error", async () => {
  const tmp = createServer();
  await new Promise<void>((r) => tmp.listen(0, "127.0.0.1", r));
  const port = (tmp.address() as AddressInfo).port;
  await new Promise<void>((r) => tmp.close(() => r()));
  const f = failedWith(await run(OPENAI, `http://127.0.0.1:${port}`), "network_error");
  assert.match(f.message, /ECONNREFUSED|fetch failed/);
});

test("Erreurs dans le flux : Anthropic event:error et chunk d'erreur OpenRouter → provider_error", async (t) => {
  const a = fixture(ANTHROPIC.fixture);
  const cut = a.indexOf("event: content_block_stop");
  const srvA = await serve(
    t,
    replay(
      `${a.slice(0, cut)}event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n`,
    ),
  );
  const ea = await run(ANTHROPIC, srvA.baseUrl);
  assert.equal(texts(ea), "Bonjour, monde é✓", "la sortie déjà reçue est conservée");
  assert.match(failedWith(ea, "provider_error").message, /overloaded_error/);

  const srvO = await serve(
    t,
    replay(
      `: OPENROUTER PROCESSING\n\ndata: {"id":"gen-x","choices":[{"index":0,"delta":{"content":"Bon"},"finish_reason":null}]}\n\n` +
        `data: {"id":"gen-x","error":{"code":502,"message":"Upstream provider failed"},"choices":[{"index":0,"delta":{"content":""},"finish_reason":"error"}]}\n\n`,
    ),
  );
  assert.match(
    failedWith(await run(PROVIDERS[3]!, srvO.baseUrl), "provider_error").message,
    /Upstream provider failed/,
  );
});

test("Flux SSE illisible (JSON invalide) → provider_error", async (t) => {
  const srv = await serve(t, replay("data: {pas du json\n\n"));
  failedWith(await run(OPENAI, srv.baseUrl), "provider_error");
});

test("Annulation en cours de flux → cancelled en moins de 3 s, connexion fermée", async (t) => {
  const body = fixture(OPENAI.fixture);
  const srv = await serve(t, (_req, res) => {
    sseHead(res);
    res.write(body.slice(0, body.indexOf("data:", body.indexOf("Bonjour"))));
    // puis le serveur ne répond plus
  });
  const ac = new AbortController();
  const req = request();
  let abortedAt = 0;
  const events = await collect(connector(OPENAI, srv.baseUrl).start(req, ac.signal), req.taskId, (e) => {
    if (e.kind === "output" && !abortedAt) {
      abortedAt = Date.now();
      ac.abort();
    }
  });
  assert.ok(abortedAt > 0, "une sortie a été reçue avant l'annulation");
  assert.ok(Date.now() - abortedAt < 3000, "annulation effective en moins de 3 s");
  failedWith(events, "cancelled");
  await srv.clientClosed;
});

test("Annulation avant la requête → cancelled sans appel réseau", async () => {
  const ac = new AbortController();
  ac.abort();
  let called = false;
  const fetchSpy: FetchLike = async () => {
    called = true;
    throw new Error("ne doit pas être appelé");
  };
  const req = request();
  const events = await collect(
    connector(OPENAI, "http://127.0.0.1:9", { fetch: fetchSpy }).start(req, ac.signal),
    req.taskId,
  );
  failedWith(events, "cancelled");
  assert.equal(called, false);
});

test("Délai dépassé (req.timeoutMs) → timeout, en-têtes reçus puis serveur muet", async (t) => {
  const srv = await serve(t, (_req, res) => {
    sseHead(res);
    res.write(": en attente\n\n");
  });
  const t0 = Date.now();
  const events = await run(OPENAI, srv.baseUrl, {}, { timeoutMs: 1000 });
  failedWith(events, "timeout");
  assert.ok(Date.now() - t0 < 3000);
});

test("Délai dépassé avant toute réponse → timeout", async (t) => {
  const srv = await serve(t, () => {
    /* jamais de réponse */
  });
  failedWith(await run(ANTHROPIC, srv.baseUrl, {}, { timeoutMs: 1000 }), "timeout");
});

test("Budget : jetons d'entrée rapportés au-delà du budget → budget_exceeded, flux interrompu", async (t) => {
  const srv = await serve(t, (_req, res) => {
    sseHead(res);
    res.write(
      `event: message_start\ndata: {"type":"message_start","message":{"id":"msg_b","usage":{"input_tokens":100,"output_tokens":1}}}\n\n`,
    );
    // le serveur continuerait indéfiniment : c'est au connecteur de couper
  });
  const events = await run(ANTHROPIC, srv.baseUrl, {}, { budget: { tokens: 50 } });
  const f = failedWith(events, "budget_exceeded");
  assert.match(f.message, /50 jetons/);
  assert.ok(!kinds(events).includes("completed"));
  const body = JSON.parse(srv.requests[0]!.body);
  assert.equal(body.max_tokens, 50, "max_tokens abaissé au budget");
  await srv.clientClosed;
});

test("Budget : sortie estimée en cours de flux au-delà du budget → budget_exceeded, usage estimé", async (t) => {
  const srv = await serve(t, (_req, res) => {
    sseHead(res);
    const timer = setInterval(() => {
      res.write(
        `data: {"id":"c","choices":[{"index":0,"delta":{"content":"0123456789abcdef"},"finish_reason":null}]}\n\n`,
      );
    }, 10);
    res.on("close", () => clearInterval(timer));
  });
  const events = await run(OPENAI, srv.baseUrl, {}, { budget: { tokens: 20 } });
  failedWith(events, "budget_exceeded");
  const usage = events.at(-2) as Extract<AgentEvent, { kind: "usage" }>;
  assert.equal(usage.kind, "usage");
  assert.equal(usage.source, "estimated");
  assert.ok(usage.caveat && usage.caveat.length > 0);
  assert.equal(JSON.parse(srv.requests[0]!.body).max_completion_tokens, 20);
  await srv.clientClosed;
});

test("Budget : total rapporté en fin de flux au-delà du budget → budget_exceeded", async (t) => {
  const srv = await serve(t, replay(fixture(OPENAI.fixture)));
  const events = await run(OPENAI, srv.baseUrl, {}, { budget: { tokens: 15 } });
  failedWith(events, "budget_exceeded");
  assert.ok(!kinds(events).includes("completed"));
});

test("Budget suffisant : complété normalement", async (t) => {
  const srv = await serve(t, replay(fixture(ANTHROPIC.fixture)));
  assertNominal(ANTHROPIC, await run(ANTHROPIC, srv.baseUrl, {}, { budget: { tokens: 1000 } }));
});

test("Taille de réponse plafonnée → invalid_output", async (t) => {
  const srv = await serve(t, replay(fixture(OPENAI.fixture)));
  failedWith(await run(OPENAI, srv.baseUrl, { maxResponseBytes: 200 }), "invalid_output");
});

test("AC-09 : la clé renvoyée par le fournisseur n'apparaît dans aucun événement", async (t) => {
  // 401 avec la clé en clair et tronquée dans le corps (comportement connu de certains fournisseurs).
  const srv401 = await serve(
    t,
    jsonError(401, {
      error: {
        message: `Incorrect API key provided: ${KEY}. Also seen as ${KEY.slice(0, 14)}****${KEY.slice(-4)}`,
        type: "invalid_request_error",
      },
    }),
  );
  const f401 = failedWith(await run(OPENAI, srv401.baseUrl), "auth_required");
  assert.match(f401.message, /\[REDACTED\]/);

  // 429 avec la clé dans le corps, en-tête retry-after piégé.
  const srv429 = await serve(t, jsonError(429, { error: { message: `quota for key ${KEY}` } }, { "retry-after": KEY }));
  const f429 = failedWith(await run(ANTHROPIC, srv429.baseUrl), "rate_limited");
  assertNoKey(f429.message);

  // Erreur dans le flux contenant la clé, et texte de sortie qui la contiendrait.
  const srvStream = await serve(
    t,
    replay(
      `data: {"candidates":[{"content":{"parts":[{"text":"écho ${KEY}"}]}}]}\n\n` +
        `data: {"error":{"code":500,"status":"INTERNAL","message":"internal error for x-goog-api-key=${KEY}"}}\n\n`,
    ),
  );
  failedWith(await run(GOOGLE, srvStream.baseUrl), "provider_error");

  // Corps non JSON renvoyant la clé.
  const srvRaw = await serve(t, (_req, res) => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(`bad gateway, header was Authorization: Bearer ${KEY}`);
  });
  failedWith(await run(PROVIDERS[3]!, srvRaw.baseUrl), "provider_error");
  // assertInvariants (appelé par collect) vérifie l'absence de la clé et de ses fragments dans chaque cas.
});

test("AC-09 : coffre en erreur → auth_required sans recopier le message de l'exception", async () => {
  const req = request();
  const c = new OpenAiApiConnector({
    model: "m",
    baseUrl: "http://127.0.0.1:9",
    getApiKey: async () => {
      throw new Error(`échec de déchiffrement de ${KEY}`);
    },
  });
  const f = failedWith(await collect(c.start(req, new AbortController().signal), req.taskId), "auth_required");
  assertNoKey(f.message);
  const empty = new OpenAiApiConnector({ model: "m", baseUrl: "http://127.0.0.1:9", getApiKey: async () => "  " });
  const req2 = request();
  failedWith(await collect(empty.start(req2, new AbortController().signal), req2.taskId), "auth_required");
});

test("AC-09 : la clé n'est ni dans le manifeste, ni dans le résultat de sonde, ni dans l'objet connecteur", async () => {
  const c = connector(OPENAI, "http://127.0.0.1:9");
  assertNoKey(JSON.stringify(c.manifest));
  assertNoKey(JSON.stringify(await c.probe()));
  assertNoKey(JSON.stringify(c));
});

test("fetch injectable : utilisé à la place du fetch global, sans redirection suivie", async (t) => {
  const srv = await serve(t, replay(fixture(OPENAI.fixture)));
  const seen: RequestInit[] = [];
  const spy: FetchLike = (url, init) => {
    seen.push(init);
    return fetch(url, init);
  };
  assertNominal(OPENAI, await run(OPENAI, srv.baseUrl, { fetch: spy }));
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.redirect, "error");
});

test("probe() : aucun appel réseau, installed selon la présence d'une clé, authenticated non testé", async () => {
  const noFetch: FetchLike = async () => {
    throw new Error("probe ne doit faire aucun appel réseau");
  };
  const base = { model: "m", baseUrl: "http://127.0.0.1:9", fetch: noFetch };
  const withKey = await new AnthropicApiConnector({ ...base, getApiKey: async () => KEY }).probe();
  assert.equal(withKey.installed, true);
  assert.equal(withKey.authenticated, undefined);
  assert.equal(withKey.connectorId, "anthropic-api");

  let read = false;
  const viaHas = await new OpenAiApiConnector({
    ...base,
    hasApiKey: async () => true,
    getApiKey: async () => {
      read = true;
      return KEY;
    },
  }).probe();
  assert.equal(viaHas.installed, true);
  assert.equal(read, false, "hasApiKey évite de lire la clé");

  const none = await new GoogleAiStudioConnector({ ...base, getApiKey: async () => "" }).probe();
  assert.equal(none.installed, false);
  const failing = await new OpenRouterApiConnector({
    ...base,
    getApiKey: async () => {
      throw new Error("coffre verrouillé");
    },
  }).probe();
  assert.equal(failing.installed, false);
});

test("Manifestes : kind api, api-key, beta ; plusieurs comptes par fournisseur (FR-007)", () => {
  const getApiKey = async () => KEY;
  const perso = new OpenAiApiConnector({ model: "m", getApiKey });
  const pro = new OpenAiApiConnector({ id: "openai-api-pro", accountLabel: "Pro", model: "m", getApiKey });
  assert.equal(perso.manifest.id, "openai-api");
  assert.equal(pro.manifest.id, "openai-api-pro");
  assert.equal(pro.manifest.displayName, "OpenAI API (Pro)");
  const ids = [
    perso,
    new AnthropicApiConnector({ model: "m", getApiKey }),
    new GoogleAiStudioConnector({ model: "m", getApiKey }),
    new OpenRouterApiConnector({ model: "m", getApiKey }),
  ].map((c) => {
    assert.equal(c.manifest.kind, "api");
    assert.deepEqual(c.manifest.authModes, ["api-key"]);
    assert.equal(c.manifest.maturity, "beta");
    return c.manifest.id;
  });
  assert.equal(new Set(ids).size, 4);
  assert.throws(() => new OpenAiApiConnector({ id: "ID invalide", model: "m", getApiKey }));
});

test("baseUrl : HTTPS exigé hors bouclage, pas d'identifiants dans l'URL", () => {
  const getApiKey = async () => KEY;
  assert.throws(() => new OpenAiApiConnector({ model: "m", getApiKey, baseUrl: "http://example.com/v1" }), /HTTPS/);
  assert.throws(() => new OpenAiApiConnector({ model: "m", getApiKey, baseUrl: "https://u:p@example.com/v1" }));
  assert.doesNotThrow(() => new OpenAiApiConnector({ model: "m", getApiKey, baseUrl: "https://example.com/v1/" }));
  assert.doesNotThrow(() => new OpenAiApiConnector({ model: "m", getApiKey, baseUrl: "http://localhost:8080/v1" }));
});
