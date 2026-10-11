// T-001 — réseau en liste blanche : sandbox sans interface réseau, seul canal = socket Unix monté
// vers un proxy CONNECT hôte qui applique l'allowlist et journalise (SEC « contrôle egress », AC-07).
// Aucun accès Internet : l'amont « autorisé » est un serveur local de fixture.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeBwrap, buildBwrapArgs } from '../../../spikes/t001/lib/bwrap-profile.mjs';
import { startEgressProxy } from '../../../spikes/t001/lib/egress-proxy.mjs';
import { runProcess } from '../../../spikes/t001/lib/run-process.mjs';

const BRIDGE = fileURLToPath(new URL('../../../spikes/t001/fixtures/proxy-bridge.mjs', import.meta.url));

let bwrap;
before(async () => {
  bwrap = await probeBwrap();
  if (!bwrap.usable && process.env.NEXUS_T001_ALLOW_NO_BWRAP !== '1') {
    throw new Error(`bwrap inutilisable (${bwrap.reason}) : refus, pas de faux vert`);
  }
});

async function setup(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nexus-t001-eg-')));
  const ws = join(root, 'ws');
  const sockDir = join(root, 'sock');
  mkdirSync(ws);
  mkdirSync(sockDir, { mode: 0o700 });
  const upstream = createServer((s) => s.end('UPSTREAM_FIXTURE_OK')).listen(0, '127.0.0.1');
  await new Promise((r) => upstream.once('listening', r));
  const proxy = await startEgressProxy({
    socketPath: join(sockDir, 'egress.sock'),
    allow: ['api.allowed.test:443'],
    // Résolution contrôlée : l'hôte autorisé pointe vers la fixture locale, jamais vers Internet.
    resolveUpstream: (host, port) => ({ host: '127.0.0.1', port: upstream.address().port, label: `${host}:${port}` }),
  });
  t.after(async () => {
    await proxy.close();
    upstream.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { ws, proxy };
}

async function clientInSandbox(ws, proxySocket, target) {
  const args = buildBwrapArgs({
    workspace: ws,
    nodeBinary: process.execPath,
    network: 'proxy',
    proxySocket,
    extraReadOnlyBinds: [[BRIDGE, '/opt/nexus/proxy-bridge.mjs']],
  });
  const script = `
    const { startBridge } = await import('/opt/nexus/proxy-bridge.mjs');
    const net = require('net');
    const port = await startBridge('/run/nexus/egress.sock');
    const direct = await new Promise(r => net.connect(443, '192.0.2.1').on('error', e => r(e.code)).on('connect', () => r('CONNECTED')));
    const viaProxy = await new Promise(r => {
      const s = net.connect(port, '127.0.0.1', () => s.write('CONNECT ${target} HTTP/1.1\\r\\nHost: ${target}\\r\\n\\r\\n'));
      let buf = ''; s.on('data', d => buf += d).on('end', () => r(buf)).on('error', e => r(e.code));
    });
    console.log(JSON.stringify({ direct, viaProxy }));
    process.exit(0);`;
  const out = [];
  const r = await runProcess({
    file: bwrap.path,
    args: [...args, '/opt/nexus/node', '--input-type=commonjs', '-e', `(async()=>{${script}})()`],
    cwd: ws,
    env: {},
    timeoutMs: 15_000,
    onLine: (l, ch) => ch === 'stdout' && out.push(l),
  });
  assert.equal(r.exitCode, 0, `sandbox exit ${r.exitCode}`);
  return JSON.parse(out.join(''));
}

test('destination allowlistée joignable uniquement via le proxy ; TCP direct toujours refusé', async (t) => {
  if (!bwrap.usable) return t.skip(bwrap.reason);
  const { ws, proxy } = await setup(t);
  const res = await clientInSandbox(ws, proxy.socketPath, 'api.allowed.test:443');
  assert.equal(res.direct, 'ENETUNREACH');
  assert.match(res.viaProxy, /^HTTP\/1\.1 200/);
  assert.match(res.viaProxy, /UPSTREAM_FIXTURE_OK/);
  assert.deepEqual(proxy.audit.map((a) => [a.target, a.decision]), [['api.allowed.test:443', 'allow']]);
});

test('destination non allowlistée refusée (403) et journalisée', async (t) => {
  if (!bwrap.usable) return t.skip(bwrap.reason);
  const { ws, proxy } = await setup(t);
  const res = await clientInSandbox(ws, proxy.socketPath, 'exfil.attacker.test:443');
  assert.match(res.viaProxy, /^HTTP\/1\.1 403/);
  assert.ok(!res.viaProxy.includes('UPSTREAM_FIXTURE_OK'));
  assert.deepEqual(proxy.audit.map((a) => [a.target, a.decision]), [['exfil.attacker.test:443', 'deny']]);
});

test('requête malformée ou méthode non-CONNECT refusée sans crash du proxy', async (t) => {
  const { proxy } = await setup(t);
  const net = await import('node:net');
  for (const payload of ['GET http://api.allowed.test/ HTTP/1.1\r\n\r\n', 'garbage\r\n\r\n', 'CONNECT api.allowed.test:443@evil HTTP/1.1\r\n\r\n']) {
    const reply = await new Promise((r) => {
      const s = net.connect(proxy.socketPath, () => s.write(payload));
      let b = '';
      s.on('data', (d) => (b += d)).on('end', () => r(b)).on('error', (e) => r(e.code));
    });
    assert.match(reply, /^HTTP\/1\.1 (400|403|405)/, JSON.stringify(payload));
  }
  assert.ok(proxy.audit.every((a) => a.decision === 'deny'));
});
