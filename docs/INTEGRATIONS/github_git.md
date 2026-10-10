# Github Git

> Nexus AI — version documentaire 1.1, 10 octobre 2026. Statut : spécification, pas implémentation.

**Source :** chapitres 13 de `ID/idee.md`. Ce fichier est une extraction documentaire, sans remplacement du maître.

## Chapitre 13 — Git, GitHub et gestion des modifications

Git CLI via broker contrôlé ; 1 tâche écrivant du code = 1 worktree + branche isolée. Avant merge : diff, tests, lint, review et résolution de conflits ; changements non autorisés au worktree principal refusés. Les commandes de force push, suppression branche distante, nettoyage irréversible exigent approbation renforcée. Pour GitHub MVP, utiliser `gh` officiellement authentifié ou intégration OAuth/GitHub App validée ; **aucun mot de passe GitHub brut dans Nexus AI**. Fonctionnalités : détecter remote, statut, commit, push explicite, créer PR si CLI disponible, afficher URL/erreurs. `gh auth login` stocke habituellement en credential store, mais peut retomber sur fichier clair ; avertir l'utilisateur et ne pas le lire en brut.

**Pipeline exemple :** `feature/login` créée -> agent A modifie -> QA teste -> reviewer inspecte -> utilisateur accepte -> commit signé si disponible -> push -> ouvrir PR. Aucune modification distante silencieuse.
