// Missions avancées (secondaires) : missions multi-agents avec équipe et gouvernance, plus les accès aux équipes,
// approbations, architecture et publication. Le parcours simple reste la session d'agent.
import { ChevronDown, ChevronRight, ListChecks, Network, Plus, Rocket, ShieldCheck, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useT, useTd } from "../i18n/index.ts";
import { errorText } from "../lib/actions.ts";
import { useApprovalsStore } from "../stores/approvals.ts";
import { useMissionsStore } from "../stores/missions.ts";
import { useProjectStore } from "../stores/project.ts";
import { useTeamsStore } from "../stores/teams.ts";
import { Button, EmptyState, ErrorNotice, SectionTitle, Skeleton } from "../ui/primitives.tsx";
import { openMission, openView } from "../workbench/dock.ts";

export function MissionsView() {
  const t = useT();
  const td = useTd();
  const projectId = useProjectStore((s) => s.current?.projectId);
  const missions = useMissionsStore((s) => (projectId ? s.byProject[projectId] : undefined));
  const teams = useTeamsStore((s) => (projectId ? s.byProject[projectId] : undefined));
  const pending = useApprovalsStore((s) => s.list.data?.filter((a) => a.status === "pending").length ?? 0);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [teamId, setTeamId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    void useMissionsStore.getState().refresh(projectId);
    void useTeamsStore.getState().refresh(projectId);
  }, [projectId]);

  const teamList = teams?.data ?? [];
  const selectedTeam = teamId || teamList[0]?.teamId || "";

  const create = async () => {
    if (!projectId || !selectedTeam) return;
    setBusy(true);
    try {
      const m = await useMissionsStore
        .getState()
        .create({ projectId, teamId: selectedTeam, title: title.trim(), prompt: prompt.trim() });
      setTitle("");
      setPrompt("");
      setCreating(false);
      openMission(m.missionId, m.title);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const links: Array<[string, typeof Users, () => void, number?]> = [
    [t("view.teams"), Users, () => openView("teams")],
    [t("view.approvals"), ShieldCheck, () => openView("approvals"), pending],
    [t("view.architecture"), ListChecks, () => openView("architecture")],
    [t("view.delivery"), Rocket, () => openView("delivery")],
  ];

  return (
    <div className="sidebar-view" aria-label={t("view.missions")}>
      <SectionTitle>{t("view.missions")}</SectionTitle>
      <p className="px-3 pb-2 text-[12px] text-fg-subtle leading-snug">{t("missions.intro")}</p>
      <div className="px-2 pb-2 flex flex-col">
        {links.map(([label, Icon, run, count]) => (
          <button key={label} type="button" className="nav-row" onClick={run}>
            <Icon size={14} aria-hidden />
            <span className="flex-1 text-left">{label}</span>
            {count ? <span className="count-pill count-pill-warn">{count}</span> : null}
          </button>
        ))}
      </div>
      <div className="section-subtitle flex items-center">
        <span className="flex-1">{t("missions.list")}</span>
        <button
          type="button"
          className="link-btn inline-flex items-center gap-1"
          onClick={() => setCreating(!creating)}
          aria-expanded={creating}
        >
          {creating ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Plus size={12} /> {t("missions.new")}
        </button>
      </div>
      {creating && (
        <form
          className="px-3 pb-3 flex flex-col gap-2"
          aria-label={t("missions.new")}
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          {teams?.data && teamList.length === 0 ? (
            <div className="notice notice-muted text-[12px]">
              <div>
                <p>{t("missions.needTeam")}</p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-1"
                  icon={<Users size={13} />}
                  onClick={() => openView("teams")}
                >
                  {t("view.teams")}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <input
                className="input"
                required
                maxLength={200}
                placeholder={t("missions.titlePlaceholder")}
                aria-label={t("missions.title")}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <textarea
                className="input"
                required
                rows={3}
                maxLength={20_000}
                placeholder={t("missions.promptPlaceholder")}
                aria-label={t("missions.prompt")}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
              <select
                className="input"
                aria-label={t("missions.team")}
                value={selectedTeam}
                onChange={(e) => setTeamId(e.target.value)}
              >
                {teamList.map((tm) => (
                  <option key={tm.teamId} value={tm.teamId}>
                    {tm.name} · {td("gov.", tm.governanceMode)}
                  </option>
                ))}
              </select>
              <Button
                type="submit"
                variant="primary"
                busy={busy}
                disabled={!title.trim() || !prompt.trim() || !selectedTeam}
              >
                {t("common.create")}
              </Button>
            </>
          )}
          <ErrorNotice error={teams?.error} compact />
        </form>
      )}
      <div className="scroll-area flex-1">
        <div className="px-2">
          <ErrorNotice error={missions?.error} compact />
        </div>
        {missions?.loading && !missions.data && (
          <div className="px-3">
            <Skeleton lines={3} />
          </div>
        )}
        {missions?.data?.length === 0 && <EmptyState icon={<Network size={22} />} title={t("missions.empty")} />}
        {missions?.data?.map((m) => (
          <button
            key={m.missionId}
            type="button"
            className="session-row"
            onClick={() => openMission(m.missionId, m.title)}
          >
            <Network size={14} className="text-fg-muted shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="session-row-title">{m.title}</span>
              <span className="session-row-meta">{td("mission.status.", m.status)}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
