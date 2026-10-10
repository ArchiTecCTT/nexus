# Démarrer ici — instructions obligatoires pour un agent de développement

> Nexus AI — version documentaire 1.1, 10 octobre 2026. Statut : spécification, pas implémentation.

## Ordre de lecture impératif
1. `ID/idee.md` : source intégrale de la spécification maîtresse.
2. `ID/exigences_conversation.md` : inventaire des décisions issues des échanges.
3. `GOUVERNANCE/decisions_et_priorites.md` : arbitrages et résolution des contradictions.
4. `ARCHITECTURE/systeme.md`, `ARCHITECTURE/contrats.md`, `SECURITE/politique.md`.
5. `ROADMAP/plan_developpement.md` et le ticket propre à la tâche dans `TICKETS/`.
6. Le paquet spécialisé dans `CONTEXTES_AGENTS/`.

## Règles absolues
- Ce dossier est une **spécification**, pas un dépôt contenant une application achevée.
- Ne pas raccourcir le périmètre de production sous prétexte que le prototype est plus réduit.
- Lire les documents complets plutôt que se fonder sur quelques extraits.
- Aucun agent n'ajoute une permission, ne modifie un contrat public ni ne téléverse ou pousse le code sans validation explicite.
- Une ambiguïté doit donner une question ou un ADR, pas une invention ; voir `GOUVERNANCE/questions_ouvertes.md`.
- N'exécuter aucune commande destructrice et ne jamais accéder à `.env` réel ni à une clé privée.
- Implémenter avec tests de contrat, de sécurité et de bout en bout ; fournir un compte rendu factuel de ce qui marche et de ce qui reste simulé.

## À remettre à une IA qui possède peu de contexte
`00_START_HERE.md` + `ID/idee.md` + `GOUVERNANCE/decisions_et_priorites.md` + son fichier `CONTEXTES_AGENTS/<role>.md` + ticket `TICKETS/T-xxx.md` + contrats concernés. Si fenêtre de contexte limitée, segmenter les parties du maître sans les supprimer du dépôt.

## Premier ordre de travail
Commencer T-000 : inspecter environnement Ubuntu, versions Node, Git, CLI disponibles et les mécanismes d'isolation. Ne pas supposer qu'une fonctionnalité est installée.
