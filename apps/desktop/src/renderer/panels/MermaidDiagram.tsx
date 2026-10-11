// Rendu Mermaid côté renderer. Seul composant autorisé à injecter du HTML (SVG) dans le DOM.
import { useEffect, useId, useState } from "react";
import { useT } from "../i18n/index.ts";
import { useAppStore } from "../stores/app.ts";
import { Skeleton } from "../ui/primitives.tsx";

let initialized: Promise<typeof import("mermaid").default> | undefined;
let currentTheme: "dark" | "light" | undefined;

function loadMermaid(theme: "dark" | "light") {
  initialized ??= import("mermaid").then(({ default: mermaid }) => mermaid);
  return initialized.then((mermaid) => {
    if (currentTheme === theme) return mermaid;
    currentTheme = theme;
    mermaid.initialize({
      startOnLoad: false,
      // « strict » : balises HTML des libellés échappées, clics/scripts désactivés, SVG assaini par DOMPurify.
      securityLevel: "strict",
      theme: theme === "dark" ? "dark" : "default",
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    });
    return mermaid;
  });
}

export function MermaidDiagram({ code, label }: { code: string; label: string }) {
  const t = useT();
  const rawId = useId();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const theme = useAppStore((st) => st.resolvedTheme);

  useEffect(() => {
    let alive = true;
    setSvg(null);
    setError(null);
    const id = `mermaid-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
    loadMermaid(theme)
      .then((mermaid) => mermaid.render(id, code))
      .then(
        (result) => alive && setSvg(result.svg),
        (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)),
      );
    return () => {
      alive = false;
    };
  }, [code, rawId, theme]);

  if (error) {
    return (
      <div className="notice notice-error" role="alert">
        <p className="notice-title">{t("arch.renderError", { msg: error.slice(0, 300) })}</p>
      </div>
    );
  }
  if (!svg) return <Skeleton lines={6} />;
  return (
    <figure className="diagram" role="img" aria-label={label}>
      {/*
        Exception unique à la règle « pas de dangerouslySetInnerHTML » : ce SVG est produit par Mermaid en
        securityLevel "strict" (libellés échappés, aucun gestionnaire d'événement, sortie assainie par DOMPurify).
        La CSP (script-src 'self') bloque en plus tout script qui y subsisterait.
      */}
      <div dangerouslySetInnerHTML={{ __html: svg }} />
    </figure>
  );
}
