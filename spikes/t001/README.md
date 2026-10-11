# Spike T-001 — streams, permissions, sandbox Linux

Code jetable de preuve, **pas** une implémentation produit. Les décisions et constats sont consignés dans
[`docs/adr/001-runtime.md`](../../docs/adr/001-runtime.md). Aucune dépendance npm : Node ≥ 22 (`node:test` intégré).

| Fichier | Rôle |
|---|---|
| `lib/run-process.mjs` | `spawn` binaire absolu, `shell:false`, env explicite, frontière d'arrêt PID namespace (`unshare`), timeout, annulation SIGTERM→SIGKILL, redaction |
| `lib/jsonl.mjs` | découpage en lignes borné (UTF-8 sûr, lignes surdimensionnées rejetées) |
| `lib/claude-stream.mjs` | normalisation `claude --print --output-format stream-json --verbose` → forme `AgentEvent` (§9) |
| `lib/path-policy.mjs` | contrôle de chemins côté broker (traversée, symlinks, noms protégés) — défense en profondeur |
| `lib/bwrap-profile.mjs` | sonde bwrap + construction du profil de montage minimal |
| `lib/egress-proxy.mjs` | proxy CONNECT hôte sur socket Unix, allowlist exacte + journal |
| `fixtures/` | flux Claude assainis (structure observée en 2.1.296), descendant adversarial `setsid` (`escaper.mjs`), pont proxy |

## Exécution

```bash
node --test 'tests/security/t001/*.test.mjs'
```

Les tests sandbox **échouent** (et ne sont pas ignorés) si bwrap est inutilisable ; `NEXUS_T001_ALLOW_NO_BWRAP=1`
permet un skip explicite sur une machine sans bwrap.

Essai réel du CLI Claude (opt-in, consomme le quota de l'abonnement, prompt inoffensif, aucun outil) :

```bash
NEXUS_T001_REAL_CLAUDE=1 NEXUS_T001_CLAUDE_BIN="$(readlink -f "$(command -v claude)")" \
  node --test tests/security/t001/claude-real.test.mjs
```

Toutes les fixtures sont créées dans des répertoires temporaires puis supprimées ; aucun vrai secret n'est lu.
Le test qui démontre la faille du groupe de processus tue lui-même le descendant évadé ; à défaut, celui-ci
se termine seul au bout de 8 s.
