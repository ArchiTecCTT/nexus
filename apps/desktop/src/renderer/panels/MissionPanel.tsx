// Mission avancée (équipe, gouvernance, plan IA) : liste des tâches (dépendances indiquées en texte) colorée par statut,
// et pilotage du plan (planification par le superviseur, acceptation, exécution, annulation).
import { Ban, CircleCheckBig, Play, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useT, useTd } from "../i18n/index.ts";
import { errorText } from "../lib/actions.ts";
import { useMissionsStore } from "../stores/missions.ts";
import { useProjectStore } from "../stores/project.ts";
import { Badge, Button, EmptyState, ErrorNotice, Skeleton } from "../ui/primitives.tsx";
import { openSession } from "../workbench/dock.ts";
import type { PanelProps } from "../workbench/DockHost.tsx";

const STATUS_COLORS: Record<string, string> = {
  draft: "var(--fg-subtle)",
  ready: "var(--info)",
  queued: "var(--info)",
  running: "var(--accent)",
  waiting_input: "var(--warning)",
  waiting_review: "var(--warning)",
  completed: "var(--success)",
  failed: "var(--danger)",
  cancelled: "var(--fg-subtle)",
  interrupted: "var(--warning)",
};

export function MissionPanel({ params }: PanelProps) {
  const t = useT();
  const td = useTd();
  const missionId = params.missionId ?? "";
  const projectId = useProjectStore((s) => s.current?.projectId);
  const mission = useMissionsStore((s) =>
    projectId ? s.byProject[projectId]?.data?.find((m) => m.missionId === missionId) : undefined,
  );
  const tasks = useMissionsStore((s) => s.tasks[missionId]);
  const plan = useMissionsStore((s) => s.plans[missionId]);
  const store = useMissionsStore.getState();
  const [busy, setBusy] = useState<string>();

  useEffect(() => {
    void useMissionsStore.getState().loadTasks(missionId);
    if (projectId && !useMissionsStore.getState().byProject[projectId])
      void useMissionsStore.getState().refresh(projectId);
  }, [missionId, projectId]);

  const act = async (name: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(name);
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(undefined);
    }
  };

  const fingerprint = plan?.data?.fingerprint;

  return (
    <div className="panel-fill">
      <header className="view-header">
        <div className="min-w-0">
          <h2 className="view-title truncate">{mission?.title ?? t("missions.mission")}</h2>
          {mission && (
            <p className="view-subtitle">
              <Badge tone="neutral">{td("mission.status.", mission.status)}</Badge>
              <span className="truncate ml-2">{mission.prompt.slice(0, 200)}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            icon={<Sparkles size={14} />}
            busy={busy === "plan"}
            onClick={() => void act("plan", () => store.planWithSupervisor(missionId))}
          >
            {t("missions.planAi")}
          </Button>
          {fingerprint && plan?.data?.valid && (
            <Button
              size="sm"
              variant="secondary"
              icon={<CircleCheckBig size={14} />}
              busy={busy === "accept"}
              onClick={() =>
                void act("accept", () => store.acceptPlan(missionId, fingerprint), t("missions.planAccepted"))
              }
            >
              {t("missions.acceptPlan")}
            </Button>
          )}
          <Button
            size="sm"
            variant="primary"
            icon={<Play size={14} />}
            busy={busy === "run"}
            onClick={() => void act("run", () => store.run(missionId, 2), t("missions.started"))}
          >
            {t("missions.run")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Ban size={14} />}
            busy={busy === "cancel"}
            onClick={() => void act("cancel", () => store.cancel(missionId))}
          >
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw size={14} />}
            onClick={() => void store.loadTasks(missionId)}
            aria-label={t("common.refresh")}
          />
        </div>
      </header>
      {plan?.data && (
        <div className="px-4 pb-2">
          <ul className="plan-checks">
            {plan.data.checks.map((c, i) => (
              <li key={i} className={c.ok ? "text-success" : "text-danger"}>
                {c.ok ? "✓" : "✗"} {c.rule}
                {c.detail ? ` — ${c.detail}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="px-4">
        <ErrorNotice error={plan?.error} />
        <ErrorNotice error={tasks?.error} />
      </div>
      <div className="scroll-area px-4 pb-4 flex-1" data-testid="mission-tasks">
        {tasks?.loading && !tasks.data && (
          <div className="p-6">
            <Skeleton lines={4} />
          </div>
        )}
        {tasks?.data && tasks.data.length === 0 && (
          <EmptyState title={t("missions.noTasks")}>{t("missions.noTasksBody")}</EmptyState>
        )}
        {tasks?.data && tasks.data.length > 0 && (
          <ul className="mission-tasks">
            {tasks.data.map((task) => {
              const after = task.dependsOn
                .map((d) => tasks.data?.find((x) => x.taskId === d)?.title)
                .filter((x): x is string => Boolean(x));
              return (
                <li key={task.taskId}>
                  <button type="button" className="orch-task" onClick={() => openSession(task.taskId, task.title)}>
                    <span className="orch-task-dot" style={{ background: STATUS_COLORS[task.status] }} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="orch-task-title">{task.title}</span>
                      {after.length > 0 && (
                        <span className="orch-task-meta">{t("orch.after", { tasks: after.join(", ") })}</span>
                      )}
                    </span>
                    <span className="orch-node-status" style={{ color: STATUS_COLORS[task.status] }}>
                      {td("status.", task.status)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
