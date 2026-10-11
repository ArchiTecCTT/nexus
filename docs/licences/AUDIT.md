# Audit de licences et de dépendances (T-025)

État au 11/10/2026. Reproductible : `pnpm run licenses` (échoue si une licence est incompatible ou inconnue).

## Licence du produit — décision du propriétaire requise

- Recommandation documentaire (ADR-012) : **Apache-2.0**. Texte prêt : `LICENSE-Apache-2.0.proposed.txt` (copie exacte du texte
  officiel livré avec TypeScript) et `NOTICE.proposed`.
- Non appliquée à la racine du dépôt : le choix de licence et le titulaire des droits relèvent du propriétaire (validation juridique
  souhaitée, ADR-012). Pour l'appliquer : copier ces fichiers en `LICENSE` et `NOTICE` à la racine et compléter le titulaire.
- Marque et nom « Nexus AI » : disponibilité **non vérifiée** (cahier maître §26) ; à faire avant toute communication publique.

## Dépendances embarquées

`THIRD_PARTY.md` : 153 paquets de production, 152 permissifs (MIT, Apache-2.0, BSD, ISC…), 1 copyleft faible, 0 incompatible, 0 inconnu.

| Point | Décision |
|---|---|
| elkjs 0.9.3 (EPL-2.0), dépendance de Mermaid | acceptable : copyleft au niveau des fichiers, utilisé sans modification ; mention dans NOTICE |
| khroma 2.1.0 (champ `license` absent) | MIT, vérifié dans le fichier `license` livré (correction tracée dans le script) |
| Contributions externes | prévoir CLA ou DCO avant d'accepter des contributions (cahier maître §26) |

## Avis de sécurité (npm audit, 11/10/2026)

| Paquet | Sévérité | Embarqué | Traitement |
|---|---|---|---|
| prisma (CLI) via mysql2, deepmerge-ts | high | non (outil de dev) | accepté tant que la CLI n'est pas embarquée ; réévaluer à chaque montée |
| oxfmt 0.41.0 via tinypool | critical | non | **corrigé** : mis à jour en 0.72.0 |
| monaco-editor via dompurify | low | oui (renderer) | Monaco n'affiche que des fichiers locaux de l'utilisateur ; surveiller la prochaine version |
| mermaid via katex | low | oui (renderer) | Mermaid exécuté en `securityLevel: "strict"`, sans rendu mathématique |

## Scripts d'installation

pnpm n'exécute que les scripts d'installation listés dans `pnpm-workspace.yaml` (`allowBuilds` : node-pty, electron) ; tous les autres scripts `postinstall` tiers sont refusés
(menace « scripts postinstall » du modèle de menace). `electron-winstaller` (Windows uniquement) reste non approuvé.
