// Barre latérale « Orchestres » : lancer un orchestre, retrouver ceux du projet (phase en direct, recherche).
import { Orbit, Plus, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useT, useTd } from "../i18n/index.ts";
import { useAppStore } from "../stores/app.ts";
import { useOrchestraStore } from "../stores/orchestra.ts";
import { AgentAvatar, agentName, familyOf } from "../ui/AgentAvatar.tsx";
import { Button, EmptyState, ErrorNotice, IconButton, SectionTitle, Skeleton, cx } from "../ui/primitives.tsx";
import { openOrchestra, useDockState } from "../workbench/dock.ts";
import { relativeTime } from "./AgentsView.tsx";

const LIVE = new Set(["planning", "awaiting_approval", "running", "summarizing"]);

interface Row {
  missionId: string;
  goal: string;
  phase?: string;
  createdAt?: string;
  lead?: string;
  members: string[];
}

export function OrchestraView() {
  const t = useT();
  const td = useTd();
  const lang = useAppStore((s) => s.lang);
  const list = useOrchestraStore((s) => s.list);
  const live = useOrchestraStore((s) => s.live);
  const refresh = useOrchestraStore((s) => s.refresh);
  const activeId = useDockState((s) => s.activePanelId);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!list.data && !list.loading) void refresh();
  }, [list.data, list.loading, refresh]);

  // Orchestres connus + ceux dont le fil arrive en direct avant le prochain rafraîchissement de la liste.
  const rows = useMemo<Row[]>(() => {
    const known: Row[] = (list.data ?? []).map((o) => ({
      missionId: o.missionId,
      goal: o.goal,
      phase: o.phase,
      createdAt: o.createdAt,
      lead: o.leadConnectorId,
      members: o.memberConnectorIds,
    }));
    for (const [missionId, feed] of Object.entries(live)) {
      if (known.some((k) => k.missionId === missionId) || feed.length === 0) continue;
      const phase = [...feed].reverse().find((e) => e.kind === "phase")?.text;
      known.unshift({
        missionId,
        goal: feed.find((e) => e.kind === "plan")?.text.split("\n")[0] ?? t("orch.untitled"),
        ...(phase && { phase }),
        createdAt: feed[0]?.at,
        members: [],
      });
    }
    const q = query.trim().toLowerCase();
    return q ? known.filter((r) => `${r.goal} ${r.members.join(" ")}`.toLowerCase().includes(q)) : known;
  }, [list.data, live, query, t]);

  return (
    <div className="sidebar-view" aria-label={t("view.orchestra")}>
      <SectionTitle
        actions={
          <IconButton size="sm" label={t("common.refresh")} onClick={() => void refresh()}>
            <RefreshCw size={13} className={cx(list.loading && "spin")} />
          </IconButton>
        }
      >
        {t("view.orchestra")}
      </SectionTitle>
      <div className="px-3 pb-3">
        <Button
          variant="primary"
          size="lg"
          className="w-full orch-launch"
          icon={<Plus size={16} />}
          onClick={() => useAppStore.getState().setOrchestraDialogOpen(true)}
        >
          {t("orch.launchShort")}
        </Button>
        <p className="text-[11.5px] text-fg-subtle mt-2 leading-snug">{t("orch.tagline")}</p>
      </div>
      <div className="px-3 pb-2">
        <label className="relative block">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-subtle" aria-hidden />
          <input
            className="input input-sm"
            style={{ paddingLeft: 26 }}
            placeholder={t("orch.search")}
            aria-label={t("orch.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="scroll-area flex-1" data-testid="orchestra-list">
        <div className="px-2">
          <ErrorNotice error={list.error} compact />
        </div>
        {list.loading && !list.data && (
          <div className="px-3">
            <Skeleton lines={3} />
          </div>
        )}
        {rows.length === 0 && !list.loading && (
          <EmptyState icon={<Orbit size={24} />} title={query ? t("orch.noMatch") : t("orch.emptyTitle")}>
            {query ? null : t("orch.emptyBody")}
          </EmptyState>
        )}
        {rows.map((r) => (
          <button
            key={r.missionId}
            type="button"
            className={cx("session-row orch-row", activeId === `orchestra:${r.missionId}` && "is-active")}
            onClick={() => openOrchestra(r.missionId, r.goal.split("\n")[0] ?? r.goal)}
            data-testid="orchestra-row"
          >
            <span
              className={cx("orch-phase-dot", r.phase && `is-${r.phase}`, r.phase && LIVE.has(r.phase) && "is-live")}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="session-row-title">{r.goal}</span>
              <span className="session-row-meta">
                {r.phase ? td("orch.phase.", r.phase) : t("orch.phase.running")}
                {r.members.length > 0 && (
                  <span className="orch-row-avatars" aria-label={r.members.map(agentName).join(", ")}>
                    {[...new Set([r.lead, ...r.members].filter((x): x is string => Boolean(x)))]
                      .slice(0, 5)
                      .map((m) => (
                        <AgentAvatar key={m} label={agentName(m)} family={familyOf(m)} size={14} lead={m === r.lead} />
                      ))}
                  </span>
                )}
              </span>
            </span>
            {r.createdAt && <span className="session-row-time">{relativeTime(r.createdAt, lang)}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
