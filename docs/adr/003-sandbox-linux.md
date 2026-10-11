# ADR-003 — Sandbox Linux de production (T-014)

- **Statut :** acceptée (11/10/2026). Complète l'ADR-001 ; s'applique à Linux uniquement.
- **Code :** `packages/sandbox` ; **preuves :** `packages/sandbox/test/sandbox.test.ts` (11 tests, hôte réel Ubuntu 24.04, noyau 7.0).

## Décision

Chaque exécution d'agent en `sandbox-auto` passe par `createSandboxedRunner(profile, capabilities)` :

```
systemd-run --user --scope -p MemoryMax=… -p MemorySwapMax=0 -p TasksMax=… -p CPUQuota=…   (si limites demandées)
  └─ bwrap --unshare-all --die-with-parent --new-session --clearenv … --seccomp 3 … --remount-ro /
       └─ commande de l'agent (environnement = celui du profil uniquement)
```

| Couche | Rôle | Preuve |
|---|---|---|
| bwrap (namespaces user/pid/net/ipc/uts/cgroup) | rien de visible sauf les montages ; réseau absent ; PID namespace = frontière d'arrêt | lecture hors workspace `ENOENT`, HOME hôte absent, `ENETUNREACH`, descendant `setsid` tué à l'annulation |
| `--remount-ro /` | système en lecture seule | `/`, `/etc`, `/usr` : `EROFS` |
| seccomp BPF (`seccomp.ts`, x86_64) | refus de `unshare`, `setns`, `clone` avec drapeaux de namespace, `clone3` (ENOSYS), `mount` et nouvelle API de montage, modules, keyring, `bpf`, `ptrace`, `perf_event_open`, `userfaultfd`, `kexec`… ; ABI x32 et autres architectures tuées | `Seccomp: 2`, `unshare -U` et `mount` refusés |
| cgroups v2 (scope systemd utilisateur) | mémoire (sans swap), nombre de tâches, CPU | fork bornée, allocation de 1 Gio tuée |
| Masquage | identifiants (`.npmrc`, `.git-credentials`, clés, `.ssh/`, `.aws/`…) toujours masqués ; `.env*` masqués seulement si `protectEnvFiles` (D-4) | `.env` lisible par défaut ; illisible (lecture et `cat`) une fois protégé |
| Proxy egress | seule sortie réseau ; allowlist exacte `hôte:port` ; IP littérales refusées ; DNS résolu côté hôte, adresses privées/bouclage/link-local/CGNAT/multicast refusées | 200 pour l'allowlist, 403 sinon, rebinding vers `10.x` refusé, journal des décisions |

## Constats de mise en œuvre

1. **systemd-run dans un user namespace ne joint pas le bus D-Bus** (`Failed to connect to bus: No data available`). L'ordre retenu
   place donc systemd-run à l'extérieur et bwrap à l'intérieur ; la frontière d'arrêt est le PID namespace de bwrap
   (`killBoundary: "wrapper-pid-namespace"` dans `@nexus/process-supervisor`).
2. **`MemoryMax` seul ne suffit pas** sur un hôte avec swap : la mémoire part en swap. `MemorySwapMax=0` est imposé.
3. Si des limites sont demandées mais que les cgroups sont indisponibles, l'exécution est **refusée** (pas d'exécution non bornée).
4. Si bwrap, le PID namespace ou seccomp manquent : `sandbox_unavailable`, et le moteur de politiques refuse `sandbox-auto`.

## Risques résiduels

- Masquage calculé au démarrage (un fichier protégé créé ensuite n'est pas masqué).
- Allowlist par nom d'hôte sans inspection TLS : un domaine autorisé reste un canal possible.
- `seccomp` en liste de refus (et non en liste d'autorisation) : réduit fortement la surface noyau sans la supprimer.
- Dépendance aux user namespaces non privilégiés et à la politique AppArmor de la distribution (sondée au démarrage).
- **Windows et macOS : aucun backend** ; `probeSandbox()` renvoie indisponible, donc `sandbox-auto` est refusé (critère §12).
