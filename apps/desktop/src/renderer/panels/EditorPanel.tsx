// Éditeur Monaco dans un panneau. Le modèle (contenu) est partagé entre les vues d'un même fichier ; l'onglet
// d'aperçu devient permanent dès la première modification. Les fichiers protégés ne sont ni lus ni modifiables.
import { ChevronRight, Lock, RotateCcw } from "lucide-react";
import { useEffect, useRef } from "react";
import { useT } from "../i18n/index.ts";
import { monaco } from "../lib/monaco-setup.ts";
import { useAppStore } from "../stores/app.ts";
import { modelFor, useEditorsStore } from "../stores/editors.ts";
import { Badge, Button, EmptyState, ErrorNotice, Skeleton } from "../ui/primitives.tsx";
import type { PanelProps } from "../workbench/DockHost.tsx";

export function Breadcrumbs({ path, children }: { path: string; children?: React.ReactNode }) {
  const parts = path.split("/");
  return (
    <div className="breadcrumbs">
      <div className="flex items-center min-w-0 overflow-hidden">
        {parts.map((p, i) => (
          <span key={i} className="flex items-center min-w-0">
            {i > 0 && <ChevronRight size={12} className="mx-0.5 shrink-0 text-fg-subtle" aria-hidden />}
            <span className={i === parts.length - 1 ? "text-fg truncate" : "truncate"}>{p}</span>
          </span>
        ))}
      </div>
      {children && <div className="ml-auto flex items-center gap-2 shrink-0">{children}</div>}
    </div>
  );
}

export function EditorPanel({ params, api }: PanelProps) {
  const t = useT();
  const path = params.path ?? "";
  const doc = useEditorsStore((s) => s.docs[path]);
  const ensure = useEditorsStore((s) => s.ensure);
  const revert = useEditorsStore((s) => s.revert);
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const previewRef = useRef(params.preview);
  previewRef.current = params.preview;
  const fontSize = 13;
  const theme = useAppStore((s) => s.resolvedTheme);

  useEffect(() => {
    if (path) void ensure(path, Boolean(params.protected));
  }, [path, params.protected, ensure]);

  const ready = doc?.status === "ready" && doc.reason !== "protected";

  useEffect(() => {
    if (!ready || !host.current) return;
    const model = modelFor(path);
    if (!model) return;
    const editor = monaco.editor.create(host.current, {
      model,
      theme: theme === "dark" ? "nexus-dark" : "nexus-light",
      automaticLayout: true,
      fontSize,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', ui-monospace, monospace",
      fontLigatures: true,
      minimap: { enabled: true, renderCharacters: false, scale: 1 },
      smoothScrolling: true,
      cursorSmoothCaretAnimation: "on",
      cursorBlinking: "smooth",
      renderLineHighlight: "all",
      scrollBeyondLastLine: false,
      padding: { top: 8 },
      stickyScroll: { enabled: true },
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: "active", indentation: true },
      readOnly: useEditorsStore.getState().docs[path]?.readOnly ?? false,
      readOnlyMessage: { value: t("editor.readOnlyMessage") },
      tabSize: 2,
    });
    editorRef.current = editor;
    const sub = model.onDidChangeContent(() => {
      if (previewRef.current) api.updateParameters({ preview: false });
    });
    const active = api.onDidActiveChange((e) => {
      if (e.isActive) requestAnimationFrame(() => editor.focus());
    });
    if (api.isActive) requestAnimationFrame(() => editor.focus());
    return () => {
      sub.dispose();
      active.dispose();
      editor.dispose();
      editorRef.current = null;
    };
    // Le thème est appliqué globalement (monaco.editor.setTheme) : pas de recréation sur changement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, path, api]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly: doc?.readOnly ?? false });
  }, [doc?.readOnly]);

  if (!doc || doc.status === "loading") {
    return (
      <div className="panel-fill">
        <Breadcrumbs path={path} />
        <div className="p-5">
          <Skeleton lines={10} />
        </div>
      </div>
    );
  }

  if (doc.reason === "protected") {
    return (
      <div className="panel-fill">
        <Breadcrumbs path={path}>
          <Badge tone="warning">
            <Lock size={11} /> {t("editor.protected")}
          </Badge>
        </Breadcrumbs>
        <EmptyState icon={<Lock size={28} />} title={t("editor.protectedTitle")}>
          {t("editor.protectedBody")}
        </EmptyState>
      </div>
    );
  }

  if (doc.status === "error") {
    return (
      <div className="panel-fill">
        <Breadcrumbs path={path} />
        <div className="p-5 max-w-xl">
          <ErrorNotice error={doc.error} />
          <Button className="mt-3" icon={<RotateCcw size={14} />} onClick={() => void revert(path)}>
            {t("common.retry")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel-fill" data-testid="editor-panel" data-path={path}>
      <Breadcrumbs path={params.untitled ? (api.title ?? path) : path}>
        {doc.reason === "truncated" && <Badge tone="warning">{t("editor.truncated")}</Badge>}
        {doc.readOnly && doc.reason !== "truncated" && <Badge tone="neutral">{t("editor.readOnly")}</Badge>}
        {doc.saving && <span className="text-[11px] text-fg-subtle">{t("editor.saving")}</span>}
        {doc.dirty && !doc.saving && <span className="text-[11px] text-fg-subtle">{t("editor.unsaved")}</span>}
      </Breadcrumbs>
      <div ref={host} className="editor-host" />
    </div>
  );
}
