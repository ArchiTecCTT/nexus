// Approbations humaines en attente (push, déploiement, actions sensibles) : chaque décision est explicite.
import { Check, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useT, useTd } from "../i18n/index.ts";
import { errorText } from "../lib/actions.ts";
import { useApprovalsStore } from "../stores/approvals.ts";
import { Badge, Button, EmptyState, ErrorNotice, Skeleton } from "../ui/primitives.tsx";
import type { PanelProps } from "../workbench/DockHost.tsx";

export function ApprovalsPanel(_props: PanelProps) {
  const t = useT();
  const td = useTd();
  const list = useApprovalsStore((s) => s.list);
  const { refresh, respond } = useApprovalsStore.getState();
  const [busy, setBusy] = useState<string>();

  useEffect(() => {
    void useApprovalsStore.getState().refresh();
  }, []);

  const decide = async (id: string, decision: "allow" | "deny") => {
    setBusy(id + decision);
    try {
      await respond(id, decision);
      toast.success(t(decision === "allow" ? "approvals.allowed" : "approvals.denied"));
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(undefined);
    }
  };

  const items = list.data ?? [];
  return (
    <div className="panel-fill">
      <header className="view-header">
        <div>
          <h2 className="view-title">{t("view.approvals")}</h2>
          <p className="view-subtitle">{t("approvals.subtitle")}</p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          icon={<RefreshCw size={14} />}
          busy={list.loading}
          onClick={() => void refresh()}
        >
          {t("common.refresh")}
        </Button>
      </header>
      <div className="scroll-area px-5 pb-6 max-w-4xl">
        {list.loading && !list.data && <Skeleton lines={4} />}
        <ErrorNotice error={list.error} />
        {list.data && items.length === 0 && (
          <EmptyState icon={<ShieldCheck size={26} />} title={t("approvals.empty")} />
        )}
        <ul className="flex flex-col gap-2">
          {items.map((a) => (
            <li key={a.approvalId} className="card">
              <div className="flex items-center gap-2 mb-1.5">
                <Badge tone={a.action.includes("production") || a.action.includes("force") ? "danger" : "warning"}>
                  {td("action.", a.action)}
                </Badge>
                <Badge tone="neutral">{td("approval.status.", a.status)}</Badge>
                <span className="ml-auto text-[11px] text-fg-subtle">{new Date(a.requestedAt).toLocaleString()}</span>
              </div>
              <pre className="code-block whitespace-pre-wrap">{a.summary}</pre>
              {a.status === "pending" && (
                <div className="flex justify-end gap-2 mt-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<X size={14} />}
                    busy={busy === a.approvalId + "deny"}
                    onClick={() => void decide(a.approvalId, "deny")}
                  >
                    {t("approvals.deny")}
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Check size={14} />}
                    busy={busy === a.approvalId + "allow"}
                    onClick={() => void decide(a.approvalId, "allow")}
                  >
                    {t("approvals.allow")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
