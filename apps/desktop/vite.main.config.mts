import { defineConfig } from "vite";

// Modules chargés depuis node_modules à l'exécution (binaire N-API libsql, runtime Prisma) : ils ne doivent pas être
// réécrits par le bundler. Ils sont copiés dans l'application empaquetée par le hook `packageAfterCopy` (forge.config).
export const RUNTIME_EXTERNALS = ["@prisma/client", "@prisma/adapter-libsql", "@libsql/client", "libsql", "node-pty"];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

export default defineConfig({
  build: {
    rollupOptions: {
      external: [...RUNTIME_EXTERNALS.map((m) => new RegExp(`^${escape(m)}(/.*)?$`)), /^@libsql\//],
    },
  },
});
