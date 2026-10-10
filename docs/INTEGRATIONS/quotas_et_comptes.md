# Quotas Et Comptes

> Nexus AI — version documentaire 1.1, 10 octobre 2026. Statut : spécification, pas implémentation.

**Source :** chapitres 16 de `ID/idee.md`. Ce fichier est une extraction documentaire, sans remplacement du maître.

## Chapitre 16 — Monitoring de consommation et budget

**Trois classes :** `reported` (fournisseur/CLI officiel), `estimated` (calcul local transparent), `unavailable`. Afficher horodatage, unité, période de réinitialisation *si fournie*, source et marge d'incertitude. Ne pas manipuler les endpoints privés/non documentés pour contourner les limites ni supposer les quotas d'abonnements équivalents aux crédits API. Budget par agent/projet, alerte avant seuil, stop à dépassement si calcul fiable ; sinon politiques conservatrices (temps/tours/tâches). Diagnostics anonymisables.
