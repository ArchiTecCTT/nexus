// Proxy CONNECT côté hôte, écoutant sur un socket Unix monté dans le sandbox.
// Applique une allowlist exacte host:port, journalise chaque décision, refuse tout le reste.
import { createServer, connect } from 'node:net';
import { rmSync } from 'node:fs';

const CONNECT_RE = /^CONNECT ([a-z0-9.-]{1,253}):(\d{1,5}) HTTP\/1\.[01]$/i;
const MAX_HEADER_BYTES = 8192;

/**
 * @param {{ socketPath: string, allow: string[],
 *   resolveUpstream?: (host: string, port: number) => { host: string, port: number } }} opts
 */
export async function startEgressProxy({ socketPath, allow, resolveUpstream = (host, port) => ({ host, port }) }) {
  const allowSet = new Set(allow.map((a) => a.toLowerCase()));
  const audit = [];
  const record = (target, decision, reason) => audit.push({ at: new Date().toISOString(), target, decision, reason });

  const server = createServer((client) => {
    let head = '';
    const reject = (status, text, target, reason) => {
      record(target, 'deny', reason);
      client.end(`HTTP/1.1 ${status} ${text}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
    };
    const onData = (chunk) => {
      head += chunk.toString('latin1');
      if (head.length > MAX_HEADER_BYTES) return client.off('data', onData), reject(400, 'Bad Request', null, 'header_too_large');
      const end = head.indexOf('\r\n\r\n');
      if (end === -1) return;
      client.off('data', onData);
      const requestLine = head.slice(0, head.indexOf('\r\n'));
      const m = CONNECT_RE.exec(requestLine);
      if (!m) {
        const method = requestLine.split(' ')[0];
        return /^[A-Z]+$/.test(method) && method !== 'CONNECT'
          ? reject(405, 'Method Not Allowed', null, 'method_not_connect')
          : reject(400, 'Bad Request', null, 'malformed_request');
      }
      const port = Number(m[2]);
      const target = `${m[1].toLowerCase()}:${port}`;
      if (!allowSet.has(target)) return reject(403, 'Forbidden', target, 'not_in_allowlist');
      record(target, 'allow');
      const up = resolveUpstream(m[1].toLowerCase(), port);
      const upstream = connect(up.port, up.host, () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        const early = head.slice(end + 4);
        if (early) upstream.write(Buffer.from(early, 'latin1'));
        client.pipe(upstream).pipe(client);
      });
      upstream.on('error', () => client.destroy());
      client.on('error', () => upstream.destroy());
    };
    client.on('data', onData);
    client.on('error', () => {});
  });

  rmSync(socketPath, { force: true });
  await new Promise((resolve, reject) => server.once('error', reject).listen(socketPath, resolve));
  return {
    socketPath,
    audit,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
