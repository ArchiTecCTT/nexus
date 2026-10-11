// T-001 — politique de chemins côté broker : traversée, symlinks, chemins protégés.
// Défense en profondeur seulement : la barrière réelle est l'absence de montage (voir bwrap-sandbox.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPath, isProtectedName } from '../../../spikes/t001/lib/path-policy.mjs';

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'nexus-t001-pp-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const ws = join(root, 'ws');
  const outside = join(root, 'outside');
  mkdirSync(join(ws, 'src'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(ws, 'src', 'a.ts'), 'export {}');
  writeFileSync(join(outside, 'fake-secret.txt'), 'FIXTURE');
  symlinkSync(join(outside, 'fake-secret.txt'), join(ws, 'escape-link'));
  symlinkSync(outside, join(ws, 'escape-dir'));
  symlinkSync(join(ws, 'src', 'a.ts'), join(ws, 'inner-link'));
  return { ws, outside };
}

test('chemin simple dans le workspace autorisé', (t) => {
  const { ws } = setup(t);
  assert.equal(checkPath(ws, 'src/a.ts').allowed, true);
});

test('traversée ../ refusée', (t) => {
  const { ws } = setup(t);
  const r = checkPath(ws, '../outside/fake-secret.txt');
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'outside_workspace');
});

test('chemin absolu hors workspace refusé', (t) => {
  const { ws, outside } = setup(t);
  assert.equal(checkPath(ws, join(outside, 'fake-secret.txt')).allowed, false);
});

test('symlink fichier vers l\'extérieur refusé après résolution', (t) => {
  const { ws } = setup(t);
  const r = checkPath(ws, 'escape-link');
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'outside_workspace');
});

test('fichier inexistant sous un répertoire symlinké vers l\'extérieur refusé (écriture future)', (t) => {
  const { ws } = setup(t);
  assert.equal(checkPath(ws, 'escape-dir/new-file.txt').allowed, false);
});

test('symlink interne au workspace autorisé', (t) => {
  const { ws } = setup(t);
  assert.equal(checkPath(ws, 'inner-link').allowed, true);
});

test('octet NUL refusé', (t) => {
  const { ws } = setup(t);
  assert.equal(checkPath(ws, 'src/a.ts\0.png').reason, 'invalid_path');
});

test('noms protégés refusés même dans le workspace (UC-09)', (t) => {
  const { ws } = setup(t);
  for (const p of ['.env', '.env.local', 'config/.env.production', '.ssh/id_ed25519', 'certs/server.pem',
    'id_rsa', '.npmrc', '.aws/credentials', '.vercel/project.json', '.git-credentials', '.netrc', '.envrc']) {
    const r = checkPath(ws, p);
    assert.equal(r.allowed, false, p);
    assert.equal(r.reason, 'protected_path', p);
  }
});

test('noms proches mais légitimes autorisés', () => {
  for (const n of ['env.ts', 'environment.md', 'id_utils.ts', 'README.md', 'identity.pem.md']) {
    assert.equal(isProtectedName(n), false, n);
  }
  assert.equal(isProtectedName('.env.example'), true, '.env.* reste protégé par défaut (décision conservatrice)');
});
