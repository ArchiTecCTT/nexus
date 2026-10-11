# Sécurité

## État des garanties (11/10/2026)

| Plateforme | Isolation des agents | Statut |
|---|---|---|
| Ubuntu/Linux | bwrap + seccomp + cgroups v2 + proxy egress (ADR-003), testé sur hôte réel | préversion interne |
| Windows | aucun backend vérifié | `sandbox-auto` refusé |
| macOS | aucun backend vérifié | `sandbox-auto` refusé |

Conformément au cahier maître §12, Nexus AI **n'annonce pas « sandbox disponible »** tant que les tests de fuite, d'écriture, de réseau
et de confinement n'ont pas réussi sur les trois systèmes cibles. Sans isolation vérifiée, les actions autonomes dangereuses sont refusées.

Décisions du propriétaire qui affectent la posture de sécurité (voir `.coordination/DECISIONS.md`) :
- **D-1** : Claude sous abonnement fonctionne en mode manuel par défaut ; sa session de connexion n'est jamais montée dans un sandbox.
- **D-4** : les fichiers `.env*` d'un projet sont visibles par défaut ; une option par projet les protège (divergence assumée avec UC-09).
  Les secrets de l'hôte et les fichiers d'identifiants restent toujours inaccessibles aux agents.

Modèle de menace, défenses et tests associés : `docs/threat-model/README.md`.

## Signaler une vulnérabilité

Ne pas ouvrir d'issue publique. Contacter le propriétaire du projet en privé (canal à définir avant la première publication),
avec une description, les étapes de reproduction et l'impact estimé. Ne pas joindre de secret réel.
