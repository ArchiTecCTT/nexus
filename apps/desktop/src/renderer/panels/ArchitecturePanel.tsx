// Architecture du projet (Mermaid en mode strict) et consommation (jetons, coût indicatif) : « indisponible »
// quand la donnée n'est pas connue, jamais de chiffre inventé.
import { ChartNoAxesColumn, RefreshCw, Workflow } from "lucide-react";
import { useEffect, useState } from "react";
import { call, toNexusError, type NexusError } from "../api.ts";
import { useT, useTd } from "../i18n/index.ts";
import { useProjectStore } from "../stores/project.ts";
import { useSecretsStore } from "../stores/secrets.ts";
import type { Diagram } from "../types.ts";
import { Badge, Button, ErrorNotice, Skeleton, cx } from "../ui/primitives.tsx";
import type { PanelProps } from "../workbench/DockHost.tsx";
import { MermaidDiagram } from "./MermaidDiagram.tsx";

export function ArchitecturePanel(_props: PanelProps) {
  const t = useT();
  const td = useTd();
  const projectId = useProjectStore((s) => s.current?.projectId);
  const [diagram, setDiagram] = useState<{ data?: Diagram; error?: NexusError; loading: boolean }>({ loading: false });
  const [view, setView] = useState<"flowchart" | "sequence" | "markdown">("flowchart");
  const usage = useSecretsStore((s) => (projectId ? s.usage[projectId] : undefined));
  const loadUsage = useSecretsStore((s) => s.loadUsage);

  const generate = async () => {
    if (!projectId) return;
    setDiagram((d) => ({ ...d, loading: true, error: undefined }));
    try {
      setDiagram({ data: await call("diagrams.generate", { projectId }), loading: false });
    } catch (e) {
      setDiagram({ error: toNexusError(e, "diagrams.generate"), loading: false });
    }
  };

  useEffect(() => {
    void generate();
    if (projectId) void loadUsage(projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const u = usage?.data;
  return (
    <div className="panel-fill">
      <header className="view-header">
        <div>
          <h2 className="view-title">{t("view.architecture")}</h2>
          <p className="view-subtitle">{t("arch.subtitle")}</p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          icon={<RefreshCw size={14} />}
          busy={diagram.loading}
          onClick={() => void generate()}
        >
          {t("arch.regenerate")}
        </Button>
      </header>
      <div className="scroll-area px-5 pb-6">
        <section className="card mb-4" aria-label={t("arch.usage")}>
          <h3 className="card-title">
            <ChartNoAxesColumn size={15} aria-hidden /> {t("arch.usage")}
          </h3>
          {usage?.loading && !u && <Skeleton lines={2} />}
          <ErrorNotice error={usage?.error} compact />
          {u && (
            <div className="stat-row">
              <div className="stat">
                <span className="stat-label">{t("arch.inputTokens")}</span>
                <span className="stat-value">
                  {u.source === "unavailable" ? t("common.unavailable") : u.inputTokens.toLocaleString()}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">{t("arch.outputTokens")}</span>
                <span className="stat-value">
                  {u.source === "unavailable" ? t("common.unavailable") : u.outputTokens.toLocaleString()}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">{t("arch.cost")}</span>
                <span className="stat-value">
                  {u.indicativeUsd !== undefined ? `~$${u.indicativeUsd.toFixed(2)}` : t("common.unavailable")}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">{t("arch.source")}</span>
                <span className="stat-value">
                  <Badge tone={u.source === "reported" ? "success" : "neutral"}>{td("usage.source.", u.source)}</Badge>
                </span>
              </div>
            </div>
          )}
          {u?.caveat && <p className="text-[12px] text-fg-subtle mt-2">{u.caveat}</p>}
        </section>

        <section className="card" aria-label={t("view.architecture")}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="card-title">
              <Workflow size={15} aria-hidden /> {t("arch.diagram")}
            </h3>
            <div className="segmented" role="tablist">
              {(["flowchart", "sequence", "markdown"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  className={cx(view === v && "is-active")}
                  onClick={() => setView(v)}
                >
                  {t(`arch.${v}`)}
                </button>
              ))}
            </div>
          </div>
          {diagram.loading && !diagram.data && <Skeleton lines={6} />}
          <ErrorNotice error={diagram.error} />
          {diagram.data && view !== "markdown" && (
            <MermaidDiagram
              code={view === "flowchart" ? diagram.data.flowchart : diagram.data.sequence}
              label={t(`arch.${view}`)}
            />
          )}
          {diagram.data && view === "markdown" && (
            <pre className="code-block whitespace-pre-wrap">{diagram.data.markdown}</pre>
          )}
        </section>
      </div>
    </div>
  );
}
