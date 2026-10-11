// Outils de test : serveur HTTP local (port 0) qui rejoue des flux SSE, collecte d'événements avec vérification
// des invariants du contrat (validation Zod, séquences, terminal unique, absence de la clé).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { TestContext } from "node:test";
import { AgentEvent, type AgentTaskRequest } from "@nexus/contracts";

/** Fausse clé reconnaissable : sert à vérifier qu'elle n'apparaît nulle part (AC-09). */
export const KEY = "sk-fx-0123456789abcdefSECRETKEYzyxwvu";

export function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

export type Recorded = { method: string; url: string; headers: IncomingMessage["headers"]; body: string };
export type Handler = (req: IncomingMessage, res: ServerResponse, rec: Recorded) => void | Promise<void>;

export type TestServer = {
  baseUrl: string;
  requests: Recorded[];
  /** Résolue quand le client a fermé la connexion d'une réponse (flux interrompu côté connecteur). */
  clientClosed: Promise<void>;
  port: number;
};

export async function serve(t: TestContext, handler: Handler): Promise<TestServer> {
  const requests: Recorded[] = [];
  let onClosed!: () => void;
  const clientClosed = new Promise<void>((r) => (onClosed = r));
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const rec: Recorded = {
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      requests.push(rec);
      res.on("close", () => {
        if (!res.writableFinished) onClosed();
      });
      void Promise.resolve(handler(req, res, rec)).catch(() => res.destroy());
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  t.after(
    () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  );
  return { baseUrl: `http://127.0.0.1:${port}`, requests, clientClosed, port };
}

export function sseHead(res: ServerResponse, status = 200, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "text/event-stream", "cache-control": "no-cache", ...headers });
  res.flushHeaders();
}

/** Rejoue un flux SSE complet. */
export function replay(body: string): Handler {
  return (_req, res) => {
    sseHead(res);
    res.end(body);
  };
}

/** Rejoue un flux octet par octet (un `write` par octet, cédant la main entre chaque). */
export function replayByteByByte(body: string): Handler {
  return async (_req, res) => {
    sseHead(res);
    for (const byte of Buffer.from(body, "utf8")) {
      res.write(Buffer.from([byte]));
      await new Promise((r) => setImmediate(r));
    }
    res.end();
  };
}

export function jsonError(status: number, body: unknown, headers: Record<string, string> = {}): Handler {
  return (_req, res) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };
}

export function request(overrides: Partial<AgentTaskRequest> = {}): AgentTaskRequest {
  return {
    taskId: randomUUID(),
    projectId: randomUUID(),
    sessionId: randomUUID(),
    agentProfileId: randomUUID(),
    workspacePath: "/tmp/nexus-fixture",
    prompt: "Dis bonjour",
    contextRefs: [],
    permissionsPolicyId: "manual",
    timeoutMs: 10_000,
    ...overrides,
  };
}

/** Collecte les événements et vérifie les invariants du contrat sur chacun. */
export async function collect(
  iter: AsyncIterable<AgentEvent>,
  taskId: string,
  onEvent?: (e: AgentEvent) => void,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const e of iter) {
    events.push(e);
    onEvent?.(e);
  }
  assertInvariants(events, taskId);
  return events;
}

export function assertInvariants(events: AgentEvent[], taskId: string): void {
  assert.ok(events.length > 0, "au moins un événement");
  events.forEach((e, i) => {
    assert.doesNotThrow(() => AgentEvent.parse(e), `événement ${i} conforme au contrat`);
    assert.equal(e.sequence, i + 1, "séquences croissantes sans trou");
    assert.equal(e.taskId, taskId);
  });
  const terminals = events.filter((e) => e.kind === "completed" || e.kind === "failed");
  assert.equal(terminals.length, 1, "exactement un terminal");
  assert.equal(terminals[0], events.at(-1), "le terminal est le dernier événement");
  assertNoKey(JSON.stringify(events));
}

export function assertNoKey(text: string): void {
  assert.ok(!text.includes(KEY), "la clé complète n'apparaît pas");
  for (let i = 0; i + 10 <= KEY.length; i += 3) {
    assert.ok(!text.includes(KEY.slice(i, i + 10)), `aucun fragment de la clé (${i})`);
  }
}

export function terminal(events: AgentEvent[]): AgentEvent {
  return events.at(-1)!;
}

export function failedWith(events: AgentEvent[], code: string): Extract<AgentEvent, { kind: "failed" }> {
  const t = terminal(events);
  assert.equal(t.kind, "failed", `terminal attendu failed(${code}), reçu ${JSON.stringify(t)}`);
  const f = t as Extract<AgentEvent, { kind: "failed" }>;
  assert.equal(f.code, code, f.message);
  return f;
}
