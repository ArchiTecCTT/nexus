// T-001 — parsing JSONL et normalisation du flux `claude --print --output-format stream-json`.
// Fixtures dérivées d'une sortie réelle observée de Claude Code 2.1.296 (identifiants remplacés).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createLineSplitter } from '../../../spikes/t001/lib/jsonl.mjs';
import { createClaudeStreamNormalizer } from '../../../spikes/t001/lib/claude-stream.mjs';

const fixture = (name) =>
  readFileSync(fileURLToPath(new URL(`../../../spikes/t001/fixtures/${name}`, import.meta.url)), 'utf8');

function normalizeAll(text, chunkSize = 7) {
  const events = [];
  const errors = [];
  const norm = createClaudeStreamNormalizer({ taskId: 'task-1' });
  const split = createLineSplitter({
    maxLineBytes: 64 * 1024,
    onLine: (line) => events.push(...norm.push(line)),
    onError: (e) => errors.push(e),
  });
  // Découpage volontairement arbitraire : les objets JSON arrivent à cheval sur plusieurs chunks.
  for (let i = 0; i < text.length; i += chunkSize) split.write(text.slice(i, i + chunkSize));
  split.end();
  events.push(...norm.end());
  return { events, errors, stats: norm.stats() };
}

test('flux nominal : started -> output -> usage -> completed, séquences strictement croissantes', () => {
  const { events, errors } = normalizeAll(fixture('claude-stream-ok.jsonl'));
  assert.deepEqual(errors, []);
  assert.deepEqual(events.map((e) => e.kind), ['started', 'output', 'usage', 'completed']);
  assert.equal(events[0].nativeSessionId, '00000000-0000-4000-8000-000000000001');
  assert.equal(events[1].text, 'pong');
  assert.equal(events[1].channel, 'message');
  assert.equal(events[2].source, 'reported');
  assert.equal(events[2].inputTokens, 2);
  assert.equal(events[2].outputTokens, 4);
  // total_cost_usd n'est pas une facture sous abonnement : non propagé comme montant « reported ».
  assert.equal(events[2].usd, undefined);
  events.forEach((e, i) => {
    assert.equal(e.taskId, 'task-1');
    assert.equal(e.sequence, i + 1);
  });
});

test('result avec subtype "success" mais is_error=true devient failed (cas réel « Not logged in »)', () => {
  const { events } = normalizeAll(fixture('claude-stream-not-logged-in.jsonl'));
  const last = events.at(-1);
  assert.equal(last.kind, 'failed');
  assert.equal(last.code, 'cli_reported_error');
  assert.match(last.message, /Not logged in/);
  assert.ok(!events.some((e) => e.kind === 'completed'));
});

test('les champs sensibles du message init ne sont jamais propagés', () => {
  const { events } = normalizeAll(fixture('claude-stream-ok.jsonl'));
  const serialized = JSON.stringify(events);
  for (const forbidden of ['memory_paths', 'apiKeySource', '/home/', 'messaging_socket_path']) {
    assert.ok(!serialized.includes(forbidden), `fuite de ${forbidden}`);
  }
});

test('ligne JSON invalide : erreur signalée, flux non interrompu', () => {
  const text = '{"type":"system","subtype":"init","session_id":"s"}\n{pas du json\n' +
    '{"type":"result","subtype":"success","is_error":false,"result":"ok","usage":{}}\n';
  const { events, stats } = normalizeAll(text);
  assert.deepEqual(events.map((e) => e.kind), ['started', 'completed']);
  assert.equal(stats.malformed, 1);
});

test('type inconnu ignoré et compté, jamais deviné', () => {
  const text = '{"type":"system","subtype":"init","session_id":"s"}\n{"type":"future_event","x":1}\n';
  const { events, stats } = normalizeAll(text);
  assert.deepEqual(events.map((e) => e.kind), ['started', 'failed']);
  assert.equal(events[1].code, 'stream_ended_without_result');
  assert.equal(stats.unknown, 1);
});

test('ligne surdimensionnée rejetée sans accumulation mémoire', () => {
  const errors = [];
  const lines = [];
  const split = createLineSplitter({ maxLineBytes: 16, onLine: (l) => lines.push(l), onError: (e) => errors.push(e) });
  split.write('x'.repeat(40));
  split.write('y'.repeat(40) + '\nok\n');
  split.end();
  assert.deepEqual(lines, ['ok']);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'line_too_long');
});

test('caractères UTF-8 multi-octets coupés entre deux chunks', () => {
  const lines = [];
  const split = createLineSplitter({ maxLineBytes: 1024, onLine: (l) => lines.push(l) });
  const buf = Buffer.from('é€\n', 'utf8');
  for (const b of buf) split.write(Buffer.from([b]));
  split.end();
  assert.deepEqual(lines, ['é€']);
});
