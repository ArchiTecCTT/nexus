# T-000 — Environnement de développement et matrice de prérequis

> Nexus AI — relevé factuel exécuté le 10 octobre 2026 sur l’hôte de développement initial. Ce document ne contient aucun secret, emplacement de credential ni jeton.

## Objectif

Établir la base reproductible avant T-001 et T-002 : environnement Ubuntu, toolchain, CLI détectables en lecture seule, capacités d’isolation, état du dépôt et dépendances/ licences à vérifier.

## Plateforme vérifiée

| Élément | Valeur observée | Statut pour le projet |
|---|---|---|
| Système | Ubuntu 24.04.4 LTS x86_64 | plateforme initiale retenue |
| Noyau | 7.0.0-34-generic | à consigner dans les preuves de sandbox |
| Node.js | v24.18.0 | présent ; compatibilité Forge/Electron à vérifier avant T-002 |
| npm / npx | 11.16.0 | présent ; gestionnaire retenu pour le bootstrap initial |
| Git | 2.43.0 | présent |
| Python | 3.12.3 | présent ; outil auxiliaire uniquement |
| Make | GNU Make 4.3 | présent |
| GCC / G++ | 13.3.0 | présents |
| `pkg-config` | absent | à installer uniquement si une dépendance native validée l’exige |
| `apt-get` / `dpkg` | présents | installation système soumise à validation humaine |

## CLI et intégrations détectées

Les résultats ci-dessous proviennent uniquement de `command -v` et `--version`. Aucun `login`, téléchargement, ni interrogation de répertoires d’authentification n’a été effectué.

| Outil | État observé | Conséquence |
|---|---|---|
| Claude Code | présent, 2.1.291 | candidat réel pour le spike T-001 ; utiliser un prompt/fixtures inoffensifs |
| Hermes | présent, 0.18.0 | détectable ; adaptateur à évaluer ultérieurement |
| Codex CLI | absent | T-001/T-007 doivent employer une fixture contrôlée et ne pas revendiquer de compatibilité réelle |
| Gemini CLI | absent | même restriction |
| OpenCode | absent | même restriction |
| GitHub CLI (`gh`) | absent | T-018 est bloqué pour les essais réels jusqu’à installation et authentification explicitement autorisées |
| Vercel CLI | absent | T-019 est bloqué pour les essais réels jusqu’à installation et authentification explicitement autorisées |

La présence ou l’absence d’une CLI ne permet pas de conclure à ses capacités, à son état d’authentification, ni à l’autorisation de l’utiliser au nom d’un abonnement. Les connecteurs devront déclarer leurs capacités réelles via le manifeste contractuel.

## Isolation et exécution

| Mécanisme | Valeur observée | Usage autorisé à ce stade |
|---|---|---|
| `bwrap` / bubblewrap | présent, 0.9.0 | candidat au spike T-001 ; aucune garantie de confinement avant tests adversariaux |
| Docker | présent, 29.8.0 | candidat de comparaison ; vérifier le mode rootless et les mounts avant toute décision |
| Podman | absent | non retenu sans installation explicitement approuvée |

Le sandbox Electron ne constitue pas une barrière pour les processus CLI. Toute exécution agent future doit passer par un runner distinct et un mécanisme d’isolation OS vérifié. Si le spike ne démontre pas le confinement attendu, l’application devra refuser les opérations autonomes dangereuses.

## État du dépôt observé

- Branche de travail : `dayif`.
- Le dépôt ne contient pas encore de `package.json`, lockfile, `LICENSE`, `NOTICE`, `SECURITY.md` ou `CONTRIBUTING.md` à sa racine.
- Aucun package applicatif ni dépendance npm n’est encore installé.
- Un seul lockfile sera autorisé après T-002 ; le bootstrap Forge initial utilise npm, conformément à la spécification. Toute migration vers pnpm nécessite une décision et une validation complète des scripts/CI.

## Matrice de licences et dépendances

À la date de ce relevé, aucune dépendance applicative n’est importée : il n’existe donc pas encore de matrice de licences de dépendances à valider. La liste suivante est un registre de contrôle pour T-002 et tickets ultérieurs, et non une autorisation d’installation globale.

| Famille / candidat documentaire | Usage prévu | Version | Licence à relever au moment de l’ajout | Condition d’acceptation |
|---|---|---:|---|---|
| Electron Forge / Electron / Vite / TypeScript | bootstrap desktop | préflight npm : Forge/create-electron-app 8.0.1, Electron 44.7.0, Vite 8.3.4, TypeScript 7.0.2 | MIT, MIT, MIT, Apache-2.0 respectivement | Node 24 satisfait les moteurs relevés ; verrouiller les versions réellement retenues seulement après ADR T-001 |
| React / ReactDOM / plugin React Vite | renderer | préflight npm : React 19.3.0, plugin React 6.1.2 ; ReactDOM à verrouiller avec React | MIT relevée pour React et plugin | ajout seulement après bootstrap Forge validé ; Node 24 satisfait le moteur du plugin |
| Zod | contrats runtime | préflight npm : 4.6.5 | MIT | validation architecturale des contrats |
| SQLite native ou `better-sqlite3` | event store | non figée | licence exacte et contraintes de build natif | benchmark/build Ubuntu et maintenance vérifiés |
| Vitest / Playwright | qualité et E2E | préflight npm : Vitest 5.0.3, Playwright 1.64.0 | MIT, Apache-2.0 respectivement | Node 24 satisfait les moteurs relevés ; scripts reproductibles et CI |
| Monaco / xterm.js | expérience code/terminal | non figée | licence exacte et avis NOTICE requis | T-017 seulement |
| bubblewrap / backend sandbox | confinement Linux | version système relevée ci-dessus | licence du mécanisme et de toute couche ajoutée | T-001/T-014 : tests fuite/écriture/réseau réussis |
| SDK/CLI GitHub et Vercel | intégrations | non installés | licence et conditions fournisseur | installation, auth et action distante approuvées séparément |
| SDK fournisseurs IA | connecteurs API | non installés | licence et conditions fournisseur | clés uniquement via secret broker, jamais dans le renderer ou CLI générique |

La recommandation de licence du produit est Apache-2.0, mais elle reste soumise à validation juridique et de marque (T-025). Pour chaque dépendance ajoutée, la PR doit indiquer : version verrouillée, licence relevée depuis sa distribution officielle, raison d’usage, alternatives évaluées et impact de ses dépendances transitives.

## Commandes de vérification reproductibles

Ces commandes sont non destructrices et ne doivent pas afficher de secret :

```bash
. /etc/os-release && printf '%s %s\n' "$PRETTY_NAME" "$(uname -m)"
uname -r
node --version
npm --version
npx --version
git --version
python3 --version
for tool in claude codex gemini hermes opencode gh vercel bwrap docker podman; do
  command -v "$tool" >/dev/null 2>&1 && "$tool" --version 2>&1 | head -1 || printf '%s absent\n' "$tool"
done
```

## Gates et décisions avant le ticket suivant

1. **T-001** peut démarrer avec Claude Code et des fixtures inoffensives. Il doit tester la lecture/écriture autorisée, le refus de chemins sensibles ou traversants, la limitation réseau, les timeouts et l’annulation ; il doit documenter un ADR de runtime.
2. **T-002** ne démarre qu’après décision ADR de T-001 et vérification explicite de la compatibilité entre la version Node installée et les versions Forge/Electron sélectionnées. Aucun package ne doit être installé avant cette vérification.
3. L’installation ou l’authentification de Codex, `gh`, Vercel, Gemini ou tout SDK supplémentaire nécessite une validation explicite du propriétaire. Aucune commande d’authentification n’est automatique.
4. Le support Windows/macOS ne peut pas être annoncé à partir de ce relevé Ubuntu. Il nécessitera ses propres preuves de sandbox, build et packaging sur les systèmes cibles.

## Limites connues

- Ce relevé ne prouve pas que Claude, Docker ou bubblewrap fonctionnent dans le modèle de sécurité requis ; T-001 est précisément chargé de le vérifier.
- Il ne contient pas de test réel d’API fournisseur, de push GitHub, de déploiement Vercel ni de packaging Electron.
- Un préflight npm a relevé des versions et licences publiées pour les candidats de base, mais aucune version n’est encore verrouillée ni intégrée. Chaque package réellement ajouté devra être revérifié depuis son artefact officiel, avec ses dépendances transitives.
