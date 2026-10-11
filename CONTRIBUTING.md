# Contribuer à Nexus AI

Lire d'abord `docs/00_START_HERE.md`, la spécification `docs/ID/idee.md`, les décisions (`docs/GOUVERNANCE/`, `.coordination/DECISIONS.md`)
et les ADR (`docs/adr/`). Une ambiguïté donne une question ou un ADR, jamais une invention.

## Environnement

- Ubuntu/Linux, Node 24.18 et pnpm 11 (voir `engines` et `packageManager`). Pour les tests de sandbox : `bwrap` et des user namespaces non privilégiés.
- `pnpm install --frozen-lockfile` puis `pnpm run generate` (client Prisma et migrations embarquées).

## Commandes

| Commande | Rôle |
|---|---|
| `pnpm run check` | lint + formatage + typecheck + tous les tests unitaires et d'intégration |
| `pnpm run e2e --workspace @nexus/desktop` | empaquetage puis E2E Electron (Playwright, sous `xvfb-run`) |
| `npm start` | application en développement |
| `pnpm run licenses` | audit des licences des dépendances embarquées (échoue sur licence incompatible ou inconnue) |
| `pnpm run test:spikes` | preuves historiques du spike T-001 |

Tests réels opt-in (consomment un abonnement) : `NEXUS_REAL_CLAUDE=1 node --test packages/connectors/test/*.test.ts`.

## Règles (cahier maître §23)

- Une PR = un ticket : objectif, chemins modifiés, tests exécutés et résultats, impact sécurité, changement de contrat éventuel,
  procédure de retour arrière. Un résultat obtenu avec des fixtures est signalé comme tel.
- Code TypeScript à syntaxe effaçable (pas d'`enum`, de `namespace`, ni de propriétés de paramètre), imports relatifs en `.ts`.
- Toute exécution de processus passe par `@nexus/process-supervisor` (binaire absolu, tableau d'arguments, pas de shell,
  environnement construit). Aucun `exec` de chaîne concaténée.
- Les contrats (`packages/contracts`) sont la seule source des schémas partagés ; toute modification incompatible exige un ADR.
- Toute dépendance ajoutée : version figée, licence relevée, justification. Pas de nouvelle commande externe sans passage par un broker.
- Aucun secret dans le dépôt, les tests ou les journaux ; utiliser des valeurs de fixture manifestement factices.
- Pas de push, de PR ni de déploiement réel sans validation explicite du propriétaire.
- Contributions externes : un CLA ou un DCO doit être défini avant d'en accepter (cahier maître §26).
