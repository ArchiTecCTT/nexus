// T-001 — essai RÉEL (non simulé) du CLI Claude. Opt-in uniquement : consomme le quota de l'abonnement
// de l'utilisateur. Activer avec NEXUS_T001_REAL_CLAUDE=1 et NEXUS_T001_CLAUDE_BIN=<chemin absolu>.
// Prompt inoffensif, répertoire temporaire vide, aucun outil, aucune persistance de session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { runProcess } from '../../../spikes/t001/lib/run-process.mjs';
import { createLineSplitter } from '../../../spikes/t001/lib/jsonl.mjs';
import { createClaudeStreamNormalizer } from '../../../spikes/t001/lib/claude-stream.mjs';

const enabled = process.env.NEXUS_T001_REAL_CLAUDE === '1';
const bin = process.env.NEXUS_T001_CLAUDE_BIN;
const BASE_ARGS = ['--print', '--output-format', 'stream-json', '--verbose', '--tools', '', '--no-session-persistence',
  '--strict-mcp-config', '--disable-slash-commands'];

// Environnement minimal : HOME est requis pour que le CLI retrouve sa propre session de connexion.
// Le spike ne lit ni ne copie ce magasin ; il laisse le CLI officiel s'authentifier seul.
const env = () => ({ HOME: process.env.HOME, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' });

function runClaude(t, prompt, signal) {
  const cwd = mkdtempSync(join(tmpdir(), 'nexus-t001-claude-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const events = [];
  const norm = createClaudeStreamNormalizer({ taskId: 'real-1' });
  const split = createLineSplitter({ maxLineBytes: 1 << 20, onLine: (l) => events.push(...norm.push(l)) });
  const firstEvent = new Promise((resolve) => {
    const check = setInterval(() => events.length && (clearInterval(check), resolve()), 10);
    signal?.addEventListener('abort', () => clearInterval(check));
  });
  const done = runProcess({
    file: bin, args: [...BASE_ARGS, prompt], cwd, env: env(), timeoutMs: 120_000, killGraceMs: 1000, signal,
    onChunk: (c, ch) => ch === 'stdout' && split.write(c),
  }).then((r) => { split.end(); events.push(...norm.end()); return r; });
  return { events, done, firstEvent };
}

test('flux réel Claude : started -> output -> completed', { skip: !enabled && 'opt-in NEXUS_T001_REAL_CLAUDE=1' }, async (t) => {
  assert.ok(bin && isAbsolute(bin), 'NEXUS_T001_CLAUDE_BIN doit être un chemin absolu');
  const { events, done } = runClaude(t, 'Reply with exactly the word: pong');
  const r = await done;
  assert.equal(r.exitCode, 0);
  const kinds = events.map((e) => e.kind);
  assert.equal(kinds[0], 'started');
  assert.ok(kinds.includes('output'));
  assert.equal(kinds.at(-1), 'completed');
  assert.match(events.find((e) => e.kind === 'output').text, /pong/i);
});

test('annulation réelle après le premier événement : arrêt < 3 s', { skip: !enabled && 'opt-in NEXUS_T001_REAL_CLAUDE=1' }, async (t) => {
  const ac = new AbortController();
  const { done, firstEvent } = runClaude(t, 'Count slowly from 1 to 200, one number per line.', ac.signal);
  await firstEvent;
  const t0 = Date.now();
  ac.abort();
  const r = await done;
  assert.equal(r.cancelled, true);
  assert.ok(Date.now() - t0 < 3000, `arrêt en ${Date.now() - t0} ms`);
});
