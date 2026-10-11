# Décisions du propriétaire (Dayifour, mainteneur)

Ces décisions prévalent sur le cahier maître lorsqu'elles s'en écartent (écarts signalés).

## 11/10/2026 — Simplicité et liberté de l'utilisateur

- **Simplicité avant tout** : pas de règles compliquées pour l'utilisateur. Les garde-fous restent dans le moteur, mais
  l'interface ne présente que des choix simples.
- **Trois modes de session** :
  - **Autonome** : l'agent agit directement dans le code du projet, sans sandbox ni validation (aucune revue imposée).
  - **Autonome en sandbox** : activé par l'utilisateur ; l'agent ne voit que sa copie de travail, sa connexion est montée
    dans SA sandbox, et le réseau est limité aux domaines de son fournisseur (+ domaines ajoutés dans les réglages).
  - **Avec validation** : l'agent travaille sur une copie isolée ; l'utilisateur relit et accepte.
- **D-1 levée** : un agent sous abonnement peut tourner en sandbox si l'utilisateur l'active.
- **D-4 maintenue** : fichiers `.env*` visibles par défaut, protection activable par projet. Les fichiers d'identifiants
  (`.npmrc`, clés SSH…) restent toujours masqués dans la sandbox.
- **Actions distantes** : push et production Vercel restent confirmés, par une simple boîte de dialogue (pas de page
  d'approbation à gérer). Le force-push et la suppression de branche distante ne sont jamais proposés.
  - Écart avec le cahier maître : UC-09/AC-06 (`.env` protégés par défaut) et l'exigence de revue systématique.

## 11/10/2026 — Organisation

- Hermes ne participe plus ; Claude prend en charge l'ensemble du projet. Le propriétaire commite.
- Pile : Zod, Zustand, Prisma imposés ; outils de build conservés.
- Interface : refaite au niveau d'un IDE (VS Code / Emdash), en s'inspirant d'Emdash **sans copier son code**.
- Paquets npm : accord global encadré (version figée, licence relevée).
- Licence **Apache-2.0**, « Copyright 2026 Dayifour » (fichiers `LICENSE` et `NOTICE`). Mainteneur : @Dayifour.
- Distribution : Linux d'abord (`.deb`, `.zip`) ; `.rpm` non produit tant que `rpmbuild` n'est pas installé ; Windows et
  macOS sans sandbox vérifiée (le mode « Autonome en sandbox » y est indisponible, les deux autres modes restent utilisables).

## 11/10/2026 — Suite à la revue de sécurité de Hermes

- **Mode par défaut : « Avec validation »** (copie isolée + relecture) ; Autonome reste à un clic.
- **Terminal utilisateur** : toujours ouvert dans un projet ouvert (dossier du projet ou worktree de session), jamais dans le HOME.
- **Session du CLI en sandbox** : conservée en lecture-écriture (le CLI doit rafraîchir ses jetons) et **affichée** dans la
  description du mode « Autonome en sandbox ». Risque documenté (modèle de menace M19).
- Les domaines ajoutés à la sandbox exigent une **boîte de dialogue native** du processus principal (M20).

## 11/10/2026 — pnpm, tous les agents, plan de déploiement

- **Gestionnaire de paquets : pnpm 11** (`pnpm-workspace.yaml`, `nodeLinker: hoisted` pour Electron Forge, scripts
  d'installation limités à `allowBuilds`). `package-lock.json` supprimé.
- **Tous les agents doivent fonctionner** : Claude, Codex, Hermes, OpenCode vérifiés en réel (hors sandbox et dans la
  sandbox) ; Gemini et Qwen en attente de la connexion du propriétaire.
- **Architecture = plan de déploiement**, pas de diagrammes : propositions d'hébergement (Vercel, Render, Railway, VPS
  Hostinger, MongoDB Atlas…) ajustées par l'IA qui pilote, validées par l'utilisateur, exécutées étape par étape.

## 11/10/2026 — Orchestre et revue de Hermes

- **L'Orchestre est la fonctionnalité phare** : un chef d'orchestre (agent choisi) planifie, attribue, transmet le travail,
  relit et intègre ; les agents se parlent via le bus MCP « nexus ». Autonomie « totale » ou « je valide le plan ».
- **D-4 confirmée par le propriétaire** : `.env` visibles par défaut, protection activable par projet (recommandation de
  Hermes de les masquer par défaut écartée).
- Déploiement : utilisateur Atlas limité à la base applicative, plage réseau explicite (ouverture totale sur case
  explicite seulement) ; empreinte SSH de l'hôte exigée avant tout envoi.
