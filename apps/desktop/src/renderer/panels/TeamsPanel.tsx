// Équipes d'agents et gouvernance (missions avancées) : création, ajout d'agents, permissions, superviseur.
import { Plus, Trash, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useT, useTd } from "../i18n/index.ts";
import { errorText } from "../lib/actions.ts";
import { useAppStore } from "../stores/app.ts";
import { useProjectStore } from "../stores/project.ts";
import { useTeamsStore, type NewAgent } from "../stores/teams.ts";
import { GOVERNANCE_MODES, AUTH_MODES, type TeamSummary } from "../types.ts";
import { Button, EmptyState, ErrorNotice, IconButton, Skeleton } from "../ui/primitives.tsx";
import type { PanelProps } from "../workbench/DockHost.tsx";

// Tableau vide stable : un `?? []` dans un sélecteur Zustand renverrait un nouveau tableau à chaque rendu (boucle infinie).
const NO_INVENTORY: never[] = [];

const PERMISSIONS = ["read-only", "manual", "notify", "sandbox-auto", "autonomous"] as const;

function TeamCard({ team }: { team: TeamSummary }) {
  const t = useT();
  const td = useTd();
  const store = useTeamsStore.getState();
  const inventory = useAppStore((s) => s.inventory.data) ?? NO_INVENTORY;
  const [agent, setAgent] = useState<NewAgent>({
    role: "",
    displayName: "",
    connectorId: inventory.find((p) => p.installed)?.connectorId ?? "",
    permissionMode: "manual",
    authMode: "vendor-login",
    capabilities: ["chat", "edit"],
  });
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>, ok?: string) => {
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  return (
    <section className="card" aria-label={team.name}>
      <div className="flex items-center gap-2 mb-3">
        <Users size={15} aria-hidden className="text-fg-muted" />
        <h3 className="card-title m-0 flex-1">{team.name}</h3>
        <label className="field-inline">
          <span>{t("teams.governance")}</span>
          <select
            className="input input-sm"
            value={team.governanceMode}
            onChange={(e) =>
              void run(() =>
                store.setGovernance(
                  team.teamId,
                  e.target.value as TeamSummary["governanceMode"],
                  team.supervisorAgentId,
                ),
              )
            }
          >
            {GOVERNANCE_MODES.map((g) => (
              <option key={g} value={g}>
                {td("gov.", g)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {team.members.length === 0 ? (
        <p className="text-[12.5px] text-fg-subtle mb-3">{t("teams.noMembers")}</p>
      ) : (
        <ul className="flex flex-col gap-1 mb-3">
          {team.members.map((m) => (
            <li key={m.agentId} className="member-row">
              <span className="font-medium">{m.displayName}</span>
              <span className="text-fg-muted text-[12px]">
                {m.role} · <span className="font-mono">{m.connectorId}</span>
              </span>
              <select
                className="input input-sm ml-auto w-36"
                aria-label={t("teams.permission")}
                value={m.permissionMode}
                onChange={(e) =>
                  void run(() =>
                    store.setPermission(team.teamId, m.agentId, e.target.value as NewAgent["permissionMode"]),
                  )
                }
              >
                {PERMISSIONS.map((p) => (
                  <option key={p} value={p}>
                    {td("perm.", p)}
                  </option>
                ))}
              </select>
              <IconButton
                size="sm"
                label={t("common.delete")}
                onClick={() => void run(() => store.removeAgent(team.teamId, m.agentId))}
              >
                <Trash size={13} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid grid-cols-2 lg:grid-cols-6 gap-2 items-end"
        aria-label={t("teams.addAgent")}
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void run(async () => {
            await store.addAgent(team.teamId, agent);
            setAgent({ ...agent, displayName: "", role: "" });
          }).finally(() => setBusy(false));
        }}
      >
        <label className="field">
          <span>{t("teams.displayName")}</span>
          <input
            className="input"
            required
            maxLength={200}
            value={agent.displayName}
            onChange={(e) => setAgent({ ...agent, displayName: e.target.value })}
          />
        </label>
        <label className="field">
          <span>{t("teams.role")}</span>
          <input
            className="input"
            required
            maxLength={200}
            value={agent.role}
            onChange={(e) => setAgent({ ...agent, role: e.target.value })}
          />
        </label>
        <label className="field">
          <span>{t("teams.connector")}</span>
          <input
            className="input font-mono"
            required
            list={`conn-${team.teamId}`}
            pattern="[a-z0-9][a-z0-9-]{1,62}"
            value={agent.connectorId}
            onChange={(e) => setAgent({ ...agent, connectorId: e.target.value })}
          />
          <datalist id={`conn-${team.teamId}`}>
            {inventory.map((p) => (
              <option key={p.connectorId} value={p.connectorId} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>{t("teams.permission")}</span>
          <select
            className="input"
            value={agent.permissionMode}
            onChange={(e) => setAgent({ ...agent, permissionMode: e.target.value as NewAgent["permissionMode"] })}
          >
            {PERMISSIONS.map((p) => (
              <option key={p} value={p}>
                {td("perm.", p)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("teams.auth")}</span>
          <select
            className="input"
            value={agent.authMode}
            onChange={(e) => setAgent({ ...agent, authMode: e.target.value as NewAgent["authMode"] })}
          >
            {AUTH_MODES.map((a) => (
              <option key={a} value={a}>
                {td("auth.", a)}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" icon={<Plus size={14} />} busy={busy}>
          {t("common.add")}
        </Button>
      </form>
      {agent.permissionMode === "sandbox-auto" && agent.authMode === "vendor-login" && (
        <p className="notice notice-muted mt-2 text-[12px]">{t("teams.d1")}</p>
      )}
    </section>
  );
}

export function TeamsPanel(_props: PanelProps) {
  const t = useT();
  const td = useTd();
  const projectId = useProjectStore((s) => s.current?.projectId);
  const teams = useTeamsStore((s) => (projectId ? s.byProject[projectId] : undefined));
  const [name, setName] = useState("");
  const [gov, setGov] = useState<TeamSummary["governanceMode"]>("MANUAL");

  useEffect(() => {
    if (projectId) void useTeamsStore.getState().refresh(projectId);
    void useAppStore.getState().loadDiagnostics();
  }, [projectId]);

  if (!projectId) return null;
  return (
    <div className="panel-fill">
      <header className="view-header">
        <div>
          <h2 className="view-title">{t("view.teams")}</h2>
          <p className="view-subtitle">{t("teams.subtitle")}</p>
        </div>
      </header>
      <div className="scroll-area px-5 pb-6 max-w-5xl flex flex-col gap-4">
        <form
          className="card grid grid-cols-[1fr_auto_auto] gap-2 items-end"
          aria-label={t("teams.create")}
          onSubmit={(e) => {
            e.preventDefault();
            void useTeamsStore
              .getState()
              .create(projectId, name.trim(), gov)
              .then(
                () => setName(""),
                (err: unknown) => toast.error(errorText(err)),
              );
          }}
        >
          <label className="field">
            <span>{t("teams.name")}</span>
            <input className="input" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>{t("teams.governance")}</span>
            <select
              className="input"
              value={gov}
              onChange={(e) => setGov(e.target.value as TeamSummary["governanceMode"])}
            >
              {GOVERNANCE_MODES.map((g) => (
                <option key={g} value={g}>
                  {td("gov.", g)}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="primary" icon={<Plus size={14} />}>
            {t("common.create")}
          </Button>
        </form>
        {teams?.loading && !teams.data && <Skeleton lines={4} />}
        <ErrorNotice error={teams?.error} />
        {teams?.data?.length === 0 && <EmptyState icon={<Users size={26} />} title={t("teams.empty")} />}
        {teams?.data?.map((team) => (
          <TeamCard key={team.teamId} team={team} />
        ))}
      </div>
    </div>
  );
}
