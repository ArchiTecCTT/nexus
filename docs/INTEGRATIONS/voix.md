# Voix

> Nexus AI — version documentaire 1.1, 10 octobre 2026. Statut : spécification, pas implémentation.

**Source :** chapitres 15 de `ID/idee.md`. Ce fichier est une extraction documentaire, sans remplacement du maître.

## Chapitre 15 — Voice input et accessibilité

**Flux :** clic/maintien micro -> permission OS -> enregistrement indicateur visible -> moteur STT local sélectionnable si installé, cloud uniquement sur opt-in -> transcription éditable -> envoi par validation utilisateur. App ne transmet pas audio brut à un fournisseur non choisi. Gestion erreurs absence micro, permissions refusées, langue FR/EN au minimum, sessions courtes, limite taille audio, interruption. Les moteurs concrets seront choisis après benchmark qualité FR, latence, packaging Linux/Windows/macOS, licence ; ne pas promettre fonctionnement vocal hors-ligne sans moteur installé.

**Accessibilité :** clavier pour les fonctions essentielles, lecteur d'écran, contrastes, captions/transcripts, arrêt facile, indicateur micro, interface i18n FR/EN.
