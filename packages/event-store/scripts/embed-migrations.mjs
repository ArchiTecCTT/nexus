// Embarque les migrations SQL dans un module TypeScript généré, consommable à l'identique par Node (tests)
// et par Vite (application Electron), sans lecture de fichiers à l'exécution.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dir = join(root, "prisma", "migrations");
const migrations = readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^\d{4}_[a-z0-9_]+$/.test(d.name))
  .map((d) => d.name)
  .sort()
  .map((name) => {
    const sql = readFileSync(join(dir, name, "migration.sql"), "utf8");
    return { name, checksum: createHash("sha256").update(sql).digest("hex"), sql };
  });
mkdirSync(join(root, "src", "generated"), { recursive: true });
writeFileSync(
  join(root, "src", "generated", "migrations.ts"),
  `// Fichier généré par scripts/embed-migrations.mjs — ne pas modifier.\n` +
    `export const MIGRATIONS: ReadonlyArray<{ name: string; checksum: string; sql: string }> = ${JSON.stringify(migrations, null, 2)};\n`,
);
console.log(`embedded ${migrations.length} migration(s)`);
