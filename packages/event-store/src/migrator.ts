// Application des migrations SQL au démarrage, sans la CLI Prisma (non embarquée dans l'application).
// Chaque migration est appliquée dans une transaction avec son enregistrement dans `schema_migrations` :
// soit tout passe, soit rien. Une migration déjà appliquée dont le contenu a changé bloque le démarrage.
import { copyFileSync, existsSync } from "node:fs";
import { createClient, type Client } from "@libsql/client";
import { MIGRATIONS } from "./generated/migrations.ts";

export type Migration = { name: string; checksum: string; sql: string };

export class MigrationChecksumError extends Error {}

export type MigrationReport = { applied: string[]; alreadyApplied: string[]; backupPath?: string };

const DDL = `CREATE TABLE IF NOT EXISTS "schema_migrations" (
  "name" TEXT NOT NULL PRIMARY KEY,
  "checksum" TEXT NOT NULL,
  "appliedAt" TEXT NOT NULL
)`;

export async function applyPragmas(client: Client): Promise<void> {
  // WAL + synchronous=FULL : un événement validé survit à un arrêt brutal (NFR-002).
  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA synchronous = FULL");
  await client.execute("PRAGMA foreign_keys = ON");
  await client.execute("PRAGMA busy_timeout = 5000");
}

export async function migrate(
  filePath: string,
  migrations: readonly Migration[] = MIGRATIONS,
  now: () => string = () => new Date().toISOString(),
): Promise<MigrationReport> {
  const existed = existsSync(filePath);
  const client = createClient({ url: `file:${filePath}` });
  try {
    await applyPragmas(client);
    await client.execute(DDL);
    const rows = await client.execute(`SELECT "name", "checksum" FROM "schema_migrations"`);
    const done = new Map(rows.rows.map((r) => [String(r.name), String(r.checksum)]));

    for (const m of migrations) {
      const known = done.get(m.name);
      if (known !== undefined && known !== m.checksum) {
        throw new MigrationChecksumError(`Migration ${m.name} was modified after being applied`);
      }
    }
    const pending = migrations.filter((m) => !done.has(m.name));
    const report: MigrationReport = {
      applied: [],
      alreadyApplied: migrations.filter((m) => done.has(m.name)).map((m) => m.name),
    };
    if (pending.length === 0) return report;

    // Sauvegarde avant toute migration d'une base existante (cahier maître §11 : « migration sauvegardée »).
    if (existed && done.size > 0) {
      await client.execute("PRAGMA wal_checkpoint(TRUNCATE)");
      const backupPath = `${filePath}.backup-${now().replace(/[:.]/g, "-")}`;
      copyFileSync(filePath, backupPath);
      report.backupPath = backupPath;
    }

    for (const m of pending) {
      const tx = await client.transaction("write");
      try {
        await tx.executeMultiple(m.sql);
        await tx.execute({
          sql: `INSERT INTO "schema_migrations" ("name", "checksum", "appliedAt") VALUES (?, ?, ?)`,
          args: [m.name, m.checksum, now()],
        });
        await tx.commit();
        report.applied.push(m.name);
      } catch (e) {
        await tx.rollback();
        throw e;
      } finally {
        tx.close();
      }
    }
    return report;
  } finally {
    client.close();
  }
}
