// T-001 — cycle de vie des processus : spawn sans shell, timeout, annulation de l'arbre, redaction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../../../spikes/t001/lib/run-process.mjs';

function tmp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'nexus-t001-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function waitFor(pred, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return pred();
}

test('argument hostile transmis littéralement, jamais interprété par un shell', async (t) => {
  const dir = tmp(t);
  const marker = join(dir, 'pwned');
  const lines = [];
  const r = await runProcess({
    file: process.execPath,
    args: ['-e', 'console.log(process.argv[1])', `x; touch ${marker}`],
    cwd: dir,
    env: {},
    timeoutMs: 5000,
    onLine: (l) => lines.push(l),
  });
  assert.equal(r.exitCode, 0);
  assert.deepEqual(lines, [`x; touch ${marker}`]);
  assert.equal(existsSync(marker), false);
});

test('environnement explicite : aucune variable du parent ne fuit vers l\'enfant', async (t) => {
  process.env.NEXUS_T001_FAKE_TOKEN = 'fixture-token-not-real';
  t.after(() => delete process.env.NEXUS_T001_FAKE_TOKEN);
  const lines = [];
  await runProcess({
    file: process.execPath,
    args: ['-e', 'console.log(JSON.stringify(Object.keys(process.env)))'],
    cwd: tmp(t),
    env: { NEXUS_ALLOWED: '1' },
    timeoutMs: 5000,
    onLine: (l) => lines.push(l),
  });
  const keys = JSON.parse(lines[0]);
  assert.ok(!keys.includes('NEXUS_T001_FAKE_TOKEN'));
  assert.ok(keys.includes('NEXUS_ALLOWED'));
});

// --- Évasion par setsid (bloqueur relevé par Hermes à la relecture) -------------------------------

const ESCAPER = fileURLToPath(new URL('../../../spikes/t001/fixtures/escaper.mjs', import.meta.url));

function readBeat(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// Vivant = le battement change en 400 ms (le descendant écrit toutes les 50 ms).
async function beating(file) {
  const a = readBeat(file);
  await new Promise((r) => setTimeout(r, 400));
  const b = readBeat(file);
  return a !== null && a !== b;
}

async function startEscaper(t, opts = {}) {
  const dir = tmp(t);
  const hb = join(dir, 'heartbeat');
  const ac = new AbortController();
  const done = runProcess({
    file: process.execPath,
    args: [ESCAPER, hb, ...(opts.flags ?? [])],
    cwd: dir,
    env: {},
    timeoutMs: opts.timeoutMs ?? 60_000,
    killGraceMs: 300,
    signal: ac.signal,
    ...(opts.killBoundary && { killBoundary: opts.killBoundary }),
  });
  assert.ok(await waitFor(() => readBeat(hb) !== null, 5000), 'le descendant setsid doit démarrer');
  assert.ok(await beating(hb), 'le descendant setsid doit être vivant avant l\'arrêt');
  return { hb, ac, done };
}

test('PREUVE DE LA FAILLE : avec la seule frontière process-group, un descendant setsid survit à l\'annulation', async (t) => {
  const { hb, ac, done } = await startEscaper(t, { killBoundary: 'process-group' });
  ac.abort();
  const r = await done;
  assert.equal(r.cancelled, true);
  const survived = await beating(hb);
  // Nettoyage immédiat de la démonstration (PID hôte valide dans ce mode) ; sinon garde-fou 8 s.
  const pid = Number(readBeat(hb)?.split(':')[0]);
  if (pid > 1) try { process.kill(pid, 'SIGKILL'); } catch { /* déjà mort */ }
  assert.equal(survived, true, 'process-group seul doit être documenté comme insuffisant');
});

test('frontière PID namespace (défaut) : descendant setsid tué après AbortSignal', async (t) => {
  const { hb, ac, done } = await startEscaper(t);
  const t0 = Date.now();
  ac.abort();
  const r = await done;
  assert.equal(r.cancelled, true);
  assert.equal(await beating(hb), false, 'le descendant setsid a survécu');
  assert.ok(Date.now() - t0 < 3000, 'arrêt sous le budget NFR-005');
});

test('frontière PID namespace : descendant setsid tué après timeout', async (t) => {
  const { hb, done } = await startEscaper(t, { timeoutMs: 1500 });
  const r = await done;
  assert.equal(r.timedOut, true);
  assert.equal(await beating(hb), false, 'le descendant setsid a survécu au timeout');
});

test('frontière PID namespace : parent ignorant SIGTERM, escalade SIGKILL et descendant setsid tué', async (t) => {
  const { hb, ac, done } = await startEscaper(t, { flags: ['--ignore-sigterm'] });
  ac.abort();
  const r = await done;
  assert.equal(r.cancelled, true);
  assert.equal(r.signal, 'SIGKILL', 'escalade attendue');
  assert.equal(await beating(hb), false);
});

test('frontière PID namespace : sortie normale du parent, le « démon » setsid laissé derrière est tué', async (t) => {
  const dir = tmp(t);
  const hb = join(dir, 'heartbeat');
  const r = await runProcess({
    file: process.execPath, args: [ESCAPER, hb, '--exit-soon'], cwd: dir, env: {}, timeoutMs: 10_000,
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.timedOut, false);
  assert.equal(await beating(hb), false, 'un démon a survécu à la fin normale de la tâche');
});

test('frontière inconnue refusée (pas de repli silencieux)', async (t) => {
  await assert.rejects(
    runProcess({ file: process.execPath, args: ['-v'], cwd: tmp(t), env: {}, timeoutMs: 1000, killBoundary: 'none' }),
    /killBoundary/,
  );
});

test('binaire absent : erreur normalisée, pas d\'exception non gérée (AC-14)', async (t) => {
  const r = await runProcess({ file: '/nonexistent/nexus-cli', args: [], cwd: tmp(t), env: {}, timeoutMs: 1000 });
  assert.equal(r.spawnError, 'ENOENT');
});

test('chemin relatif refusé : pas de résolution via PATH (substitution de binaire)', async (t) => {
  await assert.rejects(
    runProcess({ file: 'node', args: ['-v'], cwd: tmp(t), env: {}, timeoutMs: 1000 }),
    /absolute/,
  );
});

test('redaction des valeurs secrètes connues dans stdout et stderr', async (t) => {
  const secret = 'sk-fixture-0123456789abcdef';
  const lines = [];
  await runProcess({
    file: process.execPath,
    args: ['-e', `console.log('token=${secret}'); console.error('${secret}')`],
    cwd: tmp(t),
    env: {},
    timeoutMs: 5000,
    redact: [secret],
    onLine: (l, channel) => lines.push(`${channel}:${l}`),
  });
  assert.ok(lines.length === 2);
  assert.ok(lines.every((l) => !l.includes(secret)));
  assert.ok(lines.includes('stdout:token=[REDACTED]'));
});
