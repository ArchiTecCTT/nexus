// Proxy CONNECT côté hôte sur socket Unix monté dans le sandbox (seul canal sortant, AC-07).
// Allowlist exacte hôte:port ; résolution DNS faite ICI, et refus de toute adresse privée, de bouclage, link-local,
// multicast ou réservée (anti DNS-rebinding vers le réseau local). Chaque décision est journalisée.
import { lookup } from "node:dns/promises";
import { isIP, connect, createServer, type Socket } from "node:net";
import { rmSync } from "node:fs";

const CONNECT_RE = /^CONNECT ([a-z0-9.-]{1,253}):(\d{1,5}) HTTP\/1\.[01]$/i;
const MAX_HEADER_BYTES = 8192;

export type EgressDecision = {
  at: string;
  target: string | null;
  decision: "allow" | "deny";
  reason?: string;
  address?: string;
};

/** Adresses jamais joignables depuis un agent, même si le nom est autorisé. */
export function isForbiddenAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number, number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (v === 6) {
    const x = address.toLowerCase();
    if (x === "::" || x === "::1") return true;
    if (x.startsWith("::ffff:")) return isForbiddenAddress(x.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x);
  }
  return true;
}

export type Resolver = (host: string) => Promise<string[]>;
const systemResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((r) => r.address);

export type EgressProxyOptions = {
  socketPath: string;
  allow: readonly string[];
  resolve?: Resolver;
  /** Tests uniquement : autorise les adresses de bouclage (serveur de fixture local). */
  allowLoopbackForTests?: boolean;
  onDecision?: (d: EgressDecision) => void;
};

export type EgressProxy = { socketPath: string; audit: EgressDecision[]; close(): Promise<void> };

export async function startEgressProxy(opts: EgressProxyOptions): Promise<EgressProxy> {
  const allowSet = new Set(opts.allow.map((a) => a.toLowerCase()));
  const resolve = opts.resolve ?? systemResolver;
  const audit: EgressDecision[] = [];
  const record = (d: Omit<EgressDecision, "at">) => {
    const full = { at: new Date().toISOString(), ...d };
    audit.push(full);
    opts.onDecision?.(full);
  };

  // Toutes les connexions (clients et amonts) : détruites à la fermeture. Sans cela, server.close() attendrait
  // indéfiniment les tunnels keep-alive encore ouverts (constaté avec un CLI réel).
  const sockets = new Set<Socket>();
  const track = (s: Socket) => {
    sockets.add(s);
    s.once("close", () => sockets.delete(s));
  };
  const server = createServer((client: Socket) => {
    track(client);
    let head = "";
    const reject = (status: number, text: string, target: string | null, reason: string) => {
      record({ target, decision: "deny", reason });
      client.end(`HTTP/1.1 ${status} ${text}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
    };
    const onData = async (chunk: Buffer) => {
      head += chunk.toString("latin1");
      if (head.length > MAX_HEADER_BYTES) {
        client.off("data", listener);
        return reject(400, "Bad Request", null, "header_too_large");
      }
      const end = head.indexOf("\r\n\r\n");
      if (end === -1) return;
      client.off("data", listener);
      client.pause();
      const requestLine = head.slice(0, head.indexOf("\r\n"));
      const m = CONNECT_RE.exec(requestLine);
      if (!m) {
        const method = requestLine.split(" ")[0] ?? "";
        return /^[A-Z]+$/.test(method) && method !== "CONNECT"
          ? reject(405, "Method Not Allowed", null, "method_not_connect")
          : reject(400, "Bad Request", null, "malformed_request");
      }
      const host = m[1]!.toLowerCase();
      const port = Number(m[2]);
      const target = `${host}:${port}`;
      if (!allowSet.has(target)) return reject(403, "Forbidden", target, "not_in_allowlist");
      if (isIP(host)) return reject(403, "Forbidden", target, "ip_literal_not_allowed");
      let addresses: string[];
      try {
        addresses = await resolve(host);
      } catch {
        return reject(502, "Bad Gateway", target, "dns_failure");
      }
      const usable = addresses.filter(
        (a) => !isForbiddenAddress(a) || (opts.allowLoopbackForTests && /^127\.|^::1$/.test(a)),
      );
      if (usable.length === 0) return reject(403, "Forbidden", target, "forbidden_address");
      const address = usable[0]!;
      record({ target, decision: "allow", address });
      const upstream = connect(port, address, () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        const early = head.slice(end + 4);
        if (early) upstream.write(Buffer.from(early, "latin1"));
        client.resume();
        client.pipe(upstream).pipe(client);
      });
      track(upstream);
      upstream.on("error", () => client.destroy());
      upstream.on("close", () => client.destroy());
      client.on("close", () => upstream.destroy());
      client.on("error", () => upstream.destroy());
    };
    // Le même objet fonction doit servir à l'abonnement et au désabonnement : sinon les premiers octets TLS
    // seraient relus comme une nouvelle requête après l'ouverture du tunnel (défaut constaté et corrigé).
    const listener = (c: Buffer) => void onData(c);
    client.on("data", listener);
    client.on("error", () => {});
  });

  rmSync(opts.socketPath, { force: true });
  await new Promise<void>((res, rej) => server.once("error", rej).listen(opts.socketPath, () => res()));
  return {
    socketPath: opts.socketPath,
    audit,
    close: () =>
      new Promise((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
  };
}
