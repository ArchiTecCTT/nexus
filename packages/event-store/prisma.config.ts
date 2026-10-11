// Configuration de la CLI Prisma (développement uniquement : génération du client et des migrations SQL).
// L'application n'embarque pas la CLI : elle applique elle-même les migrations SQL au démarrage (migrator.ts).
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: "file:./prisma/dev.db" },
});
