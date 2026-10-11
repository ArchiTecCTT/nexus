import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * En développement, @vitejs/plugin-react injecte dans index.html un script INLINE (préambule React Refresh).
 * La CSP (`script-src 'self'`) le bloque, à juste titre. On retire ce script et le préambule est chargé à la place
 * par le module virtuel `@vitejs/plugin-react/preamble`, importé en premier par `src/renderer.ts` (même origine).
 * En production ce module virtuel est vide et aucun script inline n'est injecté.
 */
function stripInlineReactPreamble(): Plugin {
  return {
    name: "nexus:strip-inline-react-preamble",
    apply: "serve",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        return html.replace(/<script type="module">\s*import \{ injectIntoGlobalHook \}[\s\S]*?<\/script>/g, "");
      },
    },
  };
}

export default defineConfig({
  // Tailwind 4 : feuille de style générée au build (aucun style ni script injecté à l'exécution).
  plugins: [react(), tailwindcss(), stripInlineReactPreamble()],
  worker: {
    // Workers Monaco émis comme fichiers distincts (même origine, `worker-src 'self'`), jamais en blob: ni data:.
    format: "es",
  },
  build: {
    // Pas de worker ni d'asset inliné en data: URI (les polices Monaco/codicons restent des fichiers servis par 'self').
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4000,
  },
});
