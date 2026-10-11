# Publier une version téléchargeable

La publication est automatique : le workflow [`.github/workflows/release.yml`](../.github/workflows/release.yml)
construit l'application sur Linux, Windows et macOS et crée la **Release GitHub** avec les fichiers à télécharger.

## En pratique

1. Mettre à jour le numéro de version dans `apps/desktop/package.json` (`"version": "0.2.0"` par exemple) et les notes
   dans `docs/RELEASE_NOTES.md`, puis commiter.
2. Créer et pousser un tag :

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

3. Dans l'onglet **Actions** du dépôt, le workflow « Release » tourne (≈ 15 à 25 min). À la fin, la version apparaît
   dans **Releases** avec :
   - Linux : `.deb` (Ubuntu/Debian), `.rpm` (Fedora/openSUSE), `.zip` portable ;
   - Windows : installateur `Setup.exe` et `.zip` ;
   - macOS : `.zip` (Apple Silicon) ;
   - `SHA256SUMS.txt` (empreintes des fichiers).

Pour un essai sans tag : **Actions → Release → Run workflow**. La Release est alors créée en **brouillon**, à relire et
publier à la main.

## Docker

L'application est un logiciel de bureau (fenêtre, terminaux, sandbox du système) : elle ne se distribue pas comme un
conteneur. Docker sert en revanche à **construire** les paquets Linux de façon reproductible, sans rien installer
d'autre que Docker :

```bash
docker build -f Dockerfile.release --target export -o dist .
ls dist/   # deb/, rpm/, zip/
```

## Limites connues

- Les builds Windows et macOS ne sont **pas signés** : avertissement SmartScreen sous Windows, et sous macOS il faut faire
  clic droit → Ouvrir au premier lancement. La signature exige un certificat de développeur (Microsoft, Apple).
- Le mode « Autonome en sandbox » n'est disponible que sous Linux.
- Le `Dockerfile.release` n'a pas encore été exécuté de bout en bout (espace disque insuffisant sur la machine de
  développement) ; le workflow GitHub est la voie de référence.
