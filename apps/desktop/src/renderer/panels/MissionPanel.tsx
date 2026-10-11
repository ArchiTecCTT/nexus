// Mission avancée (équipe, gouvernance, plan IA) : graphe des tâches (DAG, @xyflow/react) coloré par statut,
// dépendances en arêtes, et pilotage du plan (planification par le superviseur, acceptation, exécution, annulation).
import { Background, Controls, MarkerType, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Ban, CircleCheckBig, Play, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useT, useTd } from "../i18n/index.ts";
import { errorText } from "../lib/actions.ts";
import { useAppStore } from "../stores/app.ts";
import { useMissionsStore } from "../stores/missions.ts";
import { useProjectStore } from "../stores/project.ts";
import type { TaskSummary } from "../types.ts";
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

/** Disposition en couches : profondeur = plus long chemin depuis une tâche sans dépendance. */
function layout(tasks: TaskSummary[]): Map<string, { x: number; y: number }> {
  const byId = new Map(tasks.map((t) => [t.taskId, t]));
  const depth = new Map<string, number>();
  const visit = (id: string, stack: Set<string>): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (stack.has(id)) return 0;
    stack.add(id);
    const task = byId.get(id);
    const d =
      task && task.dependsOn.length > 0
        ? 1 + Math.max(...task.dependsOn.filter((p) => byId.has(p)).map((p) => visit(p, stack)), -1)
        : 0;
    stack.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const t of tasks) visit(t.taskId, new Set());
  const rows = new Map<number, number>();
  const pos = new Map<string, { x: number; y: number }>();
  for (const t of tasks) {
    const d = depth.get(t.taskId) ?? 0;
    const r = rows.get(d) ?? 0;
    rows.set(d, r + 1);
    pos.set(t.taskId, { x: d * 280, y: r * 110 });
  }
  return pos;
}

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
  const theme = useAppStore((s) => s.resolvedTheme);
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

  const { nodes, edges } = useMemo(() => {
    const list = tasks?.data ?? [];
    const pos = layout(list);
    const nodes: Node[] = list.map((task) => ({
      id: task.taskId,
      position: pos.get(task.taskId) ?? { x: 0, y: 0 },
      data: {
        label: (
          <div className="dag-node" style={{ borderColor: STATUS_COLORS[task.status] }}>
            <div className="dag-node-title">{task.title}</div>
            <div className="dag-node-status" style={{ color: STATUS_COLORS[task.status] }}>
              ● {td("status.", task.status)}
            </div>
          </div>
        ),
      },
      style: { padding: 0, border: "none", background: "transparent", width: 230 },
    }));
    const edges: Edge[] = list.flatMap((task) =>
      task.dependsOn.map((dep) => ({
        id: `${dep}->${task.taskId}`,
        source: dep,
        target: task.taskId,
        animated: task.status === "running",
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: "var(--border-strong)", strokeWidth: 1.5 },
      })),
    );
    return { nodes, edges };
  }, [tasks?.data, td]);

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
      <div className="dag-host" data-testid="mission-dag">
        {tasks?.loading && !tasks.data && (
          <div className="p-6">
            <Skeleton lines={4} />
          </div>
        )}
        {tasks?.data && tasks.data.length === 0 && (
          <EmptyState title={t("missions.noTasks")}>{t("missions.noTasksBody")}</EmptyState>
        )}
        {tasks?.data && tasks.data.length > 0 && (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            colorMode={theme}
            nodesConnectable={false}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_e, node) => {
              const task = tasks.data?.find((x) => x.taskId === node.id);
              if (task) openSession(task.taskId, task.title);
            }}
          >
            <Background gap={20} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
      </div>
    </div>
  );
}
