import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { cpSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RUNTIME_EXTERNALS } from "./vite.main.config.mts";

const rootNodeModules = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "node_modules");

/**
 * Fermeture des dépendances des modules exclus du bundle Vite (dépendances + optionnelles installées,
 * ce qui inclut le binaire libsql de la plateforme courante).
 */
function runtimeClosure(roots: string[]): string[] {
  const seen = new Set<string>();
  const visit = (name: string) => {
    if (seen.has(name)) return;
    const manifest = join(rootNodeModules, name, "package.json");
    if (!existsSync(manifest)) return; // dépendance optionnelle d'une autre plateforme
    seen.add(name);
    const pkg = JSON.parse(readFileSync(manifest, "utf8"));
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) visit(dep);
  };
  roots.forEach(visit);
  return [...seen].sort();
}

const config: ForgeConfig = {
  // Nom d'exécutable explicite : le nom npm « @nexus/desktop » n'est pas un nom de binaire/paquet Debian valide.
  packagerConfig: { asar: true, executableName: "nexus-ai" },
  rebuildConfig: {},
  hooks: {
    // Le plugin Vite n'embarque pas node_modules : on copie uniquement les modules chargés à l'exécution.
    packageAfterCopy: async (_config, buildPath) => {
      for (const name of runtimeClosure(RUNTIME_EXTERNALS)) {
        cpSync(join(rootNodeModules, name), join(buildPath, "node_modules", name), { recursive: true, dereference: true });
      }
    },
  },
  // RPM (MakerRpm) retiré tant que `rpmbuild` n'est pas installé sur l'hôte de build (installation soumise au propriétaire).
  makers: [new MakerSquirrel({}), new MakerZIP({}, ["darwin", "linux"]), new MakerDeb({
      options: {
        name: "nexus-ai",
        bin: "nexus-ai",
        productName: "Nexus AI",
        genericName: "Atelier d'agents de code",
        categories: ["Development"],
        // À compléter par le propriétaire avant toute publication.
        maintainer: "Dayifour <dayifour@users.noreply.github.com>",
        homepage: "https://github.com/Dayifour/nexus",
      },
    })],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        { entry: "src/main.ts", config: "vite.main.config.mts", target: "main" },
        { entry: "src/preload.ts", config: "vite.preload.config.mts", target: "preload" },
      ],
      renderer: [{ name: "main_window", config: "vite.renderer.config.mts" }],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
