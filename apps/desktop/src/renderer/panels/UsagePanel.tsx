// Consommation des agents (jetons, coût indicatif, quotas d'abonnement) : « indisponible » quand la donnée n'est pas
// connue, jamais de chiffre inventé.
import { ChartNoAxesColumn, Gauge, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { useT, useTd } from "../i18n/index.ts";
import { useProjectStore } from "../stores/project.ts";
import { useSecretsStore } from "../stores/secrets.ts";
import { Badge, Button, ErrorNotice, InfoTip, Skeleton } from "../ui/primitives.tsx";
import type { PanelProps } from "../workbench/DockHost.tsx";
import { agentName } from "../ui/AgentAvatar.tsx";

export function UsagePanel(_props: PanelProps) {
  const t = useT();
  const td = useTd();
  const projectId = useProjectStore((s) => s.current?.projectId);
  const usage = useSecretsStore((s) => (projectId ? s.usage[projectId] : undefined));
  const loadUsage = useSecretsStore((s) => s.loadUsage);

  useEffect(() => {
    if (projectId) void loadUsage(projectId);
  }, [projectId, loadUsage]);

  const u = usage?.data;
  return (
    <div className="panel-fill">
      <header className="view-header">
        <div>
          <h2 className="view-title">{t("view.usage")}</h2>
          <p className="view-subtitle">{t("consumption.subtitle")}</p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          icon={<RefreshCw size={14} />}
          busy={usage?.loading}
          onClick={() => projectId && void loadUsage(projectId)}
        >
          {t("common.refresh")}
        </Button>
      </header>
      <div className="scroll-area px-5 pb-6">
        <section className="card mb-4" aria-label={t("consumption.tokens")}>
          <h3 className="card-title">
            <ChartNoAxesColumn size={15} aria-hidden /> {t("consumption.tokens")}
          </h3>
          {usage?.loading && !u && <Skeleton lines={2} />}
          <ErrorNotice error={usage?.error} compact />
          {u && (
            <div className="stat-row">
              <div className="stat">
                <span className="stat-label">{t("consumption.inputTokens")}</span>
                <span className="stat-value">
                  {u.source === "unavailable" ? t("common.unavailable") : u.inputTokens.toLocaleString()}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">{t("consumption.outputTokens")}</span>
                <span className="stat-value">
                  {u.source === "unavailable" ? t("common.unavailable") : u.outputTokens.toLocaleString()}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">{t("consumption.cost")}</span>
                <span className="stat-value">
                  {u.indicativeUsd !== undefined ? `~$${u.indicativeUsd.toFixed(2)}` : t("common.unavailable")}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">{t("consumption.source")}</span>
                <span className="stat-value">
                  <Badge tone={u.source === "reported" ? "success" : "neutral"}>{td("usage.source.", u.source)}</Badge>
                </span>
              </div>
            </div>
          )}
          {u?.caveat && <p className="text-[12px] text-fg-subtle mt-2">{u.caveat}</p>}
        </section>

        {u && u.quotas.length > 0 && (
          <section className="card" aria-label={t("consumption.quotas")}>
            <h3 className="card-title">
              <Gauge size={15} aria-hidden /> {t("consumption.quotas")}
            </h3>
            <ul className="flex flex-col gap-2">
              {u.quotas.map((q) => (
                <li
                  key={`${q.connectorId}-${q.label}`}
                  className="subcard flex flex-wrap items-center gap-2 text-[12.5px]"
                >
                  <span title={q.connectorId}>{agentName(q.connectorId)}</span>
                  <span className="text-fg-muted flex-1">{q.label}</span>
                  {q.snapshot.consumed !== undefined && (
                    <span>
                      {q.snapshot.unit === "percent"
                        ? `${Math.round(q.snapshot.consumed)} %`
                        : `${q.snapshot.consumed.toLocaleString()} ${q.snapshot.unit ?? ""}`}
                    </span>
                  )}
                  {q.snapshot.windowEnd && (
                    <span className="text-fg-subtle">
                      {t("quota.resets", { when: new Date(q.snapshot.windowEnd).toLocaleString() })}
                    </span>
                  )}
                  {q.snapshot.caveat && <InfoTip text={q.snapshot.caveat} />}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
