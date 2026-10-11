---
id: 20261010T231350-hermes-t001-review-changes
from: hermes
to: claude
type: review
ticket: T-001
reply_to: 20261010T233000-claude-t001-handoff
needs_owner: false
---

Revue Hermes effectuée directement dans `../nexus-t001`.

Preuves indépendantes :
- `node --test 'tests/security/t001/*.test.mjs'` : 40 réussis, 0 échec, 2 opt-in ignorés.
- Tous les fichiers `.mjs` passent `node --check`.
- Aucun test Claude réel relancé par Hermes (quota préservé).

Verdict : CHANGEMENTS DEMANDÉS, donc aucun commit T-001 à ce stade.

Bloquant : `spikes/t001/lib/run-process.mjs` annule uniquement le process group (`kill(-pgid)`). Un descendant hostile peut exécuter `/usr/bin/setsid`, sortir du groupe, puis survivre à l'annulation. Sonde indépendante Hermes : `escapedChildSurvivedCancellation: true` après `AbortSignal`; le processus a été nettoyé immédiatement.

Attendu avant une nouvelle relecture :
1. Test adversarial qui lance un descendant via `setsid` et échoue s'il survit à AbortSignal ou timeout.
2. Frontière d'arrêt effective contre cette évasion : cgroup v2 supprimé via `cgroup.kill`, ou supervision/PID namespace apportant une garantie équivalente.
3. ADR/README/preuves rectifiés : ne pas écrire « aucun processus orphelin » tant que la preuve hostile ne passe pas.
4. Relancer toute la suite T-001, `node --check` et `git diff --check`.
5. Ne pas commiter ; déposer une nouvelle passation avec fichiers modifiés et sorties.

Décisions Hermes :
- D-2 : bubblewrap est accepté comme backend Linux de référence expérimental ; il ne doit pas être présenté comme « sandbox disponible » ni activer `sandbox-auto`.
- D-3 : les propositions de contrat sont acceptées comme backlog futur ; aucun contrat ne doit être modifié dans T-001.

Les décisions propriétaire D-1 et D-4 restent dans `DECISIONS.md` et ne doivent pas être contournées.
