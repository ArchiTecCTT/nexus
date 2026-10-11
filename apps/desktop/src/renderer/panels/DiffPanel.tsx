// Vue de diff Monaco côte à côte (`git.fileDiff`) pour un fichier du projet ou du dossier de travail d'une session.
// Repli : diff unifié de la session (`tasks.diff`) quand le canal n'est pas servi.
import { Columns2, RefreshCw, Rows2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { call, isUnavailable, toNexusError, type NexusError } from "../api.ts";
import { useT } from "../i18n/index.ts";
import { languageFor, monaco } from "../lib/monaco-setup.ts";
import { useAppStore } from "../stores/app.ts";
import { useProjectStore } from "../stores/project.ts";
import { useSessionsStore } from "../stores/sessions.ts";
import { ErrorNotice, IconButton, Skeleton } from "../ui/primitives.tsx";
import { UnifiedDiff } from "../ui/UnifiedDiff.tsx";
import type { PanelProps } from "../workbench/DockHost.tsx";
import { Breadcrumbs } from "./EditorPanel.tsx";

export function DiffPanel({ params }: PanelProps) {
  const t = useT();
  const path = params.path ?? "";
  const taskId = params.taskId;
  const projectId = useProjectStore((s) => s.current?.projectId);
  const theme = useAppStore((s) => s.resolvedTheme);
  const [state, setState] = useState<{
    status: "loading" | "ready" | "fallback" | "error";
    error?: NexusError;
    original?: string;
    modified?: string;
  }>({ status: "loading" });
  const [inline, setInline] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const diffRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const sessionDiff = useSessionsStore((s) => (taskId ? s.diffs[taskId] : undefined));
  const loadDiff = useSessionsStore((s) => s.loadDiff);

  const load = useCallback(async () => {
    if (!projectId || !path) return;
    setState({ status: "loading" });
    try {
      const r = await call("git.fileDiff", { projectId, path, ...(taskId && { taskId }) });
      setState({ status: "ready", original: r.original, modified: r.modified });
    } catch (e) {
      if (isUnavailable(e) && taskId) {
        setState({ status: "fallback" });
        void loadDiff(taskId);
      } else setState({ status: "error", error: toNexusError(e, "git.fileDiff") });
    }
  }, [projectId, path, taskId, loadDiff]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (state.status !== "ready" || !host.current) return;
    const language = languageFor(path);
    const original = monaco.editor.createModel(state.original ?? "", language);
    const modified = monaco.editor.createModel(state.modified ?? "", language);
    const editor = monaco.editor.createDiffEditor(host.current, {
      automaticLayout: true,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: !inline,
      theme: theme === "dark" ? "nexus-dark" : "nexus-light",
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', ui-monospace, monospace",
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      hideUnchangedRegions: { enabled: true },
    });
    editor.setModel({ original, modified });
    diffRef.current = editor;
    return () => {
      editor.dispose();
      original.dispose();
      modified.dispose();
      diffRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, path]);

  useEffect(() => {
    diffRef.current?.updateOptions({ renderSideBySide: !inline });
  }, [inline]);

  return (
    <div className="panel-fill" data-testid="diff-panel">
      <Breadcrumbs path={path}>
        <IconButton
          size="sm"
          label={inline ? t("diff.sideBySide") : t("diff.inline")}
          onClick={() => setInline(!inline)}
        >
          {inline ? <Columns2 size={14} /> : <Rows2 size={14} />}
        </IconButton>
        <IconButton size="sm" label={t("common.refresh")} onClick={() => void load()}>
          <RefreshCw size={14} />
        </IconButton>
      </Breadcrumbs>
      {state.status === "loading" && (
        <div className="p-5">
          <Skeleton lines={8} />
        </div>
      )}
      {state.status === "error" && (
        <div className="p-5 max-w-xl">
          <ErrorNotice error={state.error} />
        </div>
      )}
      {state.status === "fallback" && (
        <div className="scroll-area p-4">
          {sessionDiff?.loading && <Skeleton lines={8} />}
          <ErrorNotice error={sessionDiff?.error} />
          {sessionDiff?.data && <UnifiedDiff unified={sessionDiff.data.unified} only={path} />}
        </div>
      )}
      {state.status === "ready" && <div ref={host} className="editor-host" />}
    </div>
  );
}
