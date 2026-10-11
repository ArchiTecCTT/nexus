// T-001 — confinement réel bubblewrap sur fixtures inoffensives (SEC-001..008, AC-06, AC-07).
// Si bwrap est indisponible, la suite échoue au lieu d'être ignorée : un sandbox absent ne doit
// jamais produire un résultat « vert ». Seul NEXUS_T001_ALLOW_NO_BWRAP=1 autorise le skip explicite.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeBwrap, buildBwrapArgs, findProtectedFiles } from '../../../spikes/t001/lib/bwrap-profile.mjs';
import { runProcess, isAlive } from '../../../spikes/t001/lib/run-process.mjs';

let bwrap;
before(async () => {
  bwrap = await probeBwrap();
  if (!bwrap.usable && process.env.NEXUS_T001_ALLOW_NO_BWRAP !== '1') {
    throw new Error(`bwrap inutilisable (${bwrap.reason}) : refus, pas de faux vert`);
  }
});
const maybe = (name, fn) => test(name, (t) => (bwrap.usable ? fn(t) : t.skip(`bwrap: ${bwrap.reason}`)));

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nexus-t001-sb-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const ws = join(root, 'ws');
  const outside = join(root, 'outside');
  const fakeHome = join(root, 'home');
  mkdirSync(join(ws, 'config'), { recursive: true });
  mkdirSync(outside);
  mkdirSync(join(fakeHome, '.ssh'), { recursive: true });
  writeFileSync(join(ws, 'README.md'), 'workspace file\n');
  writeFileSync(join(ws, '.env'), 'FIXTURE_ENV_VALUE=not-a-real-secret\n');
  writeFileSync(join(ws, 'config', '.env.local'), 'FIXTURE_ENV_LOCAL=not-a-real-secret\n');
  writeFileSync(join(outside, 'fake-secret.txt'), 'FIXTURE_OUTSIDE\n');
  writeFileSync(join(fakeHome, '.ssh', 'id_fixture'), 'FIXTURE_SSH_KEY_NOT_REAL\n');
  symlinkSync(join(outside, 'fake-secret.txt'), join(ws, 'escape-link'));
  symlinkSync(join(fakeHome, '.ssh'), join(ws, 'ssh-link'));
  return { root, ws, outside, fakeHome };
}

// Exécute un script Node dans le sandbox ; renvoie un objet JSON écrit sur stdout.
async function inSandbox(t, ws, script, { network = 'none', extraBinds = [], env = {}, signal } = {}) {
  const args = buildBwrapArgs({
    workspace: ws,
    nodeBinary: process.execPath,
    network,
    maskFiles: findProtectedFiles(ws),
    extraReadOnlyBinds: extraBinds,
    env,
  });
  const out = [];
  const err = [];
  const r = await runProcess({
    file: bwrap.path,
    args: [...args, '/opt/nexus/node', '-e', script],
    cwd: ws,
    env: {},
    timeoutMs: 15_000,
    signal,
    onLine: (l, ch) => (ch === 'stdout' ? out : err).push(l),
  });
  return { r, json: out.length ? JSON.parse(out.join('\n')) : undefined, stderr: err.join('\n') };
}

const TRY = `
const fs=require('fs');
const tryRead=p=>{try{return 'READ:'+fs.readFileSync(p,'utf8').trim()}catch(e){return e.code}};
const tryWrite=p=>{try{fs.writeFileSync(p,'x');return 'WROTE'}catch(e){return e.code}};
`;

maybe('lecture d\'un fichier du workspace autorisée', async (t) => {
  const { ws } = fixture(t);
  const { json } = await inSandbox(t, ws, `${TRY} console.log(JSON.stringify(tryRead('/workspace/README.md')))`);
  assert.equal(json, 'READ:workspace file');
});

maybe('écriture dans le workspace autorisée et visible côté hôte', async (t) => {
  const { ws } = fixture(t);
  const { json } = await inSandbox(t, ws, `${TRY} console.log(JSON.stringify(tryWrite('/workspace/out.txt')))`);
  assert.equal(json, 'WROTE');
  assert.equal(readFileSync(join(ws, 'out.txt'), 'utf8'), 'x');
});

maybe('fichier hors workspace : non monté, illisible par chemin hôte absolu', async (t) => {
  const { ws, outside } = fixture(t);
  const { json } = await inSandbox(t, ws, `${TRY} console.log(JSON.stringify(tryRead(${JSON.stringify(join(outside, 'fake-secret.txt'))})))`);
  assert.equal(json, 'ENOENT');
});

maybe('clé SSH fixture du faux HOME inaccessible ; HOME hôte non monté', async (t) => {
  const { ws, fakeHome } = fixture(t);
  const { json } = await inSandbox(t, ws, `${TRY} console.log(JSON.stringify({
    ssh: tryRead(${JSON.stringify(join(fakeHome, '.ssh', 'id_fixture'))}),
    hostHome: fs.existsSync(${JSON.stringify(process.env.HOME ?? '/home')}),
    home: process.env.HOME }))`);
  assert.equal(json.ssh, 'ENOENT');
  assert.equal(json.hostHome, false);
  assert.equal(json.home, '/home/agent');
});

maybe('.env du workspace masqué (UC-09) : contenu vide, non modifiable', async (t) => {
  const { ws } = fixture(t);
  const { json } = await inSandbox(t, ws, `${TRY} console.log(JSON.stringify({
    env: tryRead('/workspace/.env'), local: tryRead('/workspace/config/.env.local'),
    write: tryWrite('/workspace/.env') }))`);
  // Observé sur Ubuntu 24.04 / bwrap 0.9.0 : EACCES (le /dev/null lié hérite de nodev). Un contenu
  // vide serait aussi acceptable ; seule la fuite du contenu réel est un échec.
  for (const v of [json.env, json.local]) {
    assert.ok(v === 'READ:' || v === 'EACCES', `résultat inattendu: ${v}`);
    assert.ok(!v.includes('FIXTURE'), 'contenu .env exposé');
  }
  assert.notEqual(json.write, 'WROTE');
  assert.match(readFileSync(join(ws, '.env'), 'utf8'), /FIXTURE_ENV_VALUE/, 'fichier hôte intact');
});

maybe('symlinks du workspace vers l\'extérieur : cible non montée, lecture impossible', async (t) => {
  const { ws } = fixture(t);
  const { json } = await inSandbox(t, ws, `${TRY} console.log(JSON.stringify({
    file: tryRead('/workspace/escape-link'), dir: tryRead('/workspace/ssh-link/id_fixture') }))`);
  assert.equal(json.file, 'ENOENT');
  assert.equal(json.dir, 'ENOENT');
});

maybe('écriture hors workspace refusée (système en lecture seule, /tmp éphémère)', async (t) => {
  const { ws, outside } = fixture(t);
  const { json } = await inSandbox(t, ws, `${TRY} console.log(JSON.stringify({
    usr: tryWrite('/usr/nexus-t001'), etc: tryWrite('/etc/nexus-t001'), root: tryWrite('/nexus-t001'),
    opt: tryWrite('/opt/nexus/planted'),
    outside: tryWrite(${JSON.stringify(join(outside, 'planted'))}), tmp: tryWrite('/tmp/scratch') }))`);
  assert.equal(json.usr, 'EROFS');
  // Régression couverte : la racine tmpfs de bwrap doit être remontée en lecture seule.
  assert.equal(json.etc, 'EROFS');
  assert.equal(json.root, 'EROFS');
  assert.equal(json.opt, 'EROFS');
  assert.notEqual(json.outside, 'WROTE');
  assert.equal(json.tmp, 'WROTE', '/tmp privé autorisé');
  assert.equal(existsSync(join(outside, 'planted')), false);
});

maybe('environnement vidé : aucune variable hôte, seules les variables allowlistées', async (t) => {
  const { ws } = fixture(t);
  process.env.NEXUS_T001_FAKE_TOKEN = 'fixture-token-not-real';
  t.after(() => delete process.env.NEXUS_T001_FAKE_TOKEN);
  const { json } = await inSandbox(t, ws, `console.log(JSON.stringify(Object.keys(process.env).sort()))`, {
    env: { NEXUS_TASK_ID: 'task-1' },
  });
  // PWD est positionné par bwrap lors de --chdir (valeur non sensible : /workspace).
  assert.deepEqual(json, ['HOME', 'LANG', 'NEXUS_TASK_ID', 'PATH', 'PWD', 'TMPDIR']);
});

maybe('privilèges : capacités effectives nulles et no_new_privs actif', async (t) => {
  const { ws } = fixture(t);
  const { json } = await inSandbox(t, ws, `const s=require('fs').readFileSync('/proc/self/status','utf8');
    const g=k=>s.match(new RegExp(k+':\\\\s*(\\\\S+)'))[1];
    console.log(JSON.stringify({eff:g('CapEff'),bnd:g('CapBnd'),nnp:g('NoNewPrivs')}))`);
  assert.deepEqual(json, { eff: '0000000000000000', bnd: '0000000000000000', nnp: '1' });
});

maybe('processus hôtes invisibles (PID namespace)', async (t) => {
  const { ws } = fixture(t);
  const { json } = await inSandbox(t, ws, `console.log(JSON.stringify({
    pids: require('fs').readdirSync('/proc').filter(x=>/^\\d+$/.test(x)).length,
    host: require('fs').existsSync('/proc/${process.pid}') }))`);
  assert.equal(json.host, false);
  assert.ok(json.pids < 10);
});

maybe('réseau par défaut refusé : TCP externe inatteignable (AC-07)', async (t) => {
  const { ws } = fixture(t);
  const { json } = await inSandbox(t, ws, `require('net').connect(443,'192.0.2.1')
    .on('connect',()=>console.log(JSON.stringify('CONNECTED')))
    .on('error',e=>console.log(JSON.stringify(e.code)))`);
  assert.equal(json, 'ENETUNREACH');
});

maybe('service local de l\'hôte (127.0.0.1) inatteignable depuis le sandbox', async (t) => {
  const { ws } = fixture(t);
  const server = createServer((s) => s.end('HOST_SERVICE')).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  const { port } = server.address();
  const { json } = await inSandbox(t, ws, `require('net').connect(${port},'127.0.0.1')
    .on('data',d=>console.log(JSON.stringify('LEAK:'+d)))
    .on('error',e=>console.log(JSON.stringify(e.code)))`);
  assert.equal(json, 'ECONNREFUSED');
});

maybe('annulation : l\'arbre de processus du sandbox est tué', async (t) => {
  const { ws } = fixture(t);
  const ac = new AbortController();
  const p = inSandbox(t, ws, `require('child_process').spawn('/opt/nexus/node',['-e','setInterval(()=>{},1e3)'],{stdio:'ignore'});
    require('fs').writeFileSync('/workspace/started','1'); setInterval(()=>{},1e3)`, { signal: ac.signal });
  const end = Date.now() + 5000;
  while (!existsSync(join(ws, 'started')) && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  assert.ok(existsSync(join(ws, 'started')));
  const t0 = Date.now();
  ac.abort();
  const { r } = await p;
  assert.equal(r.cancelled, true);
  assert.ok(Date.now() - t0 < 3000);
  assert.ok(r.pid && !isAlive(r.pid));
});

maybe('annulation : un descendant setsid lancé DANS le sandbox ne survit pas', async (t) => {
  const { ws } = fixture(t);
  const ac = new AbortController();
  const beat = `process.on('SIGTERM',()=>{});let n=0;setInterval(()=>require('fs').writeFileSync('/workspace/hb',String(++n)),50);setTimeout(()=>process.exit(0),8000)`;
  const p = inSandbox(t, ws, `require('child_process').spawn('/usr/bin/setsid',['/opt/nexus/node','-e',${JSON.stringify(beat)}],{stdio:'ignore'});
    setInterval(()=>{},1e3)`, { signal: ac.signal });
  const hb = join(ws, 'hb');
  const read = () => (existsSync(hb) ? readFileSync(hb, 'utf8') : null);
  const end = Date.now() + 5000;
  while (read() === null && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  assert.notEqual(read(), null, 'le descendant setsid doit démarrer');
  ac.abort();
  const { r } = await p;
  assert.equal(r.cancelled, true);
  const a = read();
  await new Promise((r2) => setTimeout(r2, 400));
  assert.equal(read(), a, 'le descendant setsid a survécu à l\'annulation du sandbox');
});

test('findProtectedFiles ne suit pas les symlinks et ne lit aucun contenu', (t) => {
  const { ws } = fixture(t);
  const found = findProtectedFiles(ws).map((p) => p.slice(ws.length)).sort();
  assert.deepEqual(found, ['/.env', '/config/.env.local']);
});
