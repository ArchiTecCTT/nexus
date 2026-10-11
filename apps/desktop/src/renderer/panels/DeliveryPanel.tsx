// Publication avancée : push GitHub avec plan vérifié et approbation (UC-06), déploiement Vercel preview/production
// (UC-07, confirmation supplémentaire en production). Le push simple en un clic est dans la vue Contrôle de source.
import { CloudUpload, GitBranch, Rocket, ShieldCheck } from "lucide-react";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { useT, useTd } from "../i18n/index.ts";
import { useApprovalsStore } from "../stores/approvals.ts";
import { useDeliveryStore } from "../stores/delivery.ts";
import { useGitStore } from "../stores/git.ts";
import { useProjectStore } from "../stores/project.ts";
import { confirmAction } from "../ui/dialog.tsx";
import { Badge, Button, ErrorNotice, Spinner } from "../ui/primitives.tsx";
import { openView } from "../workbench/dock.ts";
import type { PanelProps } from "../workbench/DockHost.tsx";

function ApprovalGate({ approvalId, children }: { approvalId: string; children: (allowed: boolean) => ReactNode }) {
  const t = useT();
  const td = useTd();
  const approval = useApprovalsStore((s) => s.list.data?.find((a) => a.approvalId === approvalId));
  const refresh = useApprovalsStore((s) => s.refresh);
  const loading = useApprovalsStore((s) => s.list.loading);
  useEffect(() => {
    void refresh();
  }, [approvalId, refresh]);
  const allowed = approval?.status === "allowed";
  return (
    <div className="subcard">
      {!allowed && (
        <div className="flex items-center gap-2 flex-wrap">
          <ShieldCheck size={15} className="text-warning" aria-hidden />
          <span className="text-[13px] flex-1">
            {t("delivery.waiting", { status: approval ? td("approval.status.", approval.status) : "…" })}
          </span>
          <Button size="sm" variant="ghost" onClick={() => openView("approvals")}>
            {t("delivery.goApprovals")}
          </Button>
          <Button size="sm" variant="ghost" busy={loading} onClick={() => void refresh()}>
            {t("delivery.check")}
          </Button>
        </div>
      )}
      {children(allowed)}
    </div>
  );
}

function PushSection({ projectId }: { projectId: string }) {
  const t = useT();
  const base = useId();
  const branchDefault = useGitStore((s) => s.status.data?.branch);
  const plan = useDeliveryStore((s) => s.push[projectId]);
  const result = useDeliveryStore((s) => s.pushResult[projectId]);
  const { preparePush, runPush } = useDeliveryStore.getState();
  const [branch, setBranch] = useState(branchDefault ?? "");
  const [remote, setRemote] = useState("origin");
  useEffect(() => {
    if (branchDefault && !branch) setBranch(branchDefault);
  }, [branchDefault, branch]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void preparePush({ projectId, branch: branch.trim(), remote: remote.trim() });
  };
  const data = plan?.data;
  return (
    <section className="card" aria-labelledby={`${base}-h`}>
      <h3 id={`${base}-h`} className="card-title">
        <GitBranch size={15} aria-hidden /> {t("delivery.pushTitle")}
      </h3>
      <p className="text-[12.5px] text-fg-muted mb-3">{t("delivery.pushIntro")}</p>
      <form className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end" onSubmit={submit}>
        <label className="field">
          <span>{t("delivery.branch")}</span>
          <input
            className="input font-mono"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            required
            maxLength={200}
            spellCheck={false}
          />
        </label>
        <label className="field">
          <span>{t("delivery.remote")}</span>
          <input
            className="input font-mono"
            value={remote}
            onChange={(e) => setRemote(e.target.value)}
            required
            maxLength={100}
            spellCheck={false}
          />
        </label>
        <Button type="submit" busy={plan?.loading}>
          {t("delivery.prepare")}
        </Button>
      </form>
      <div className="mt-3 flex flex-col gap-2">
        <ErrorNotice error={plan?.error} />
        {data && (
          <>
            <pre className="code-block whitespace-pre-wrap">{data.summary}</pre>
            {data.blocked && (
              <div className="notice notice-error" role="alert">
                <div>
                  <p className="notice-title">{t("delivery.blocked")}</p>
                  <ul className="notice-detail list-disc pl-4">
                    {data.blockedReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {!data.blocked && data.approvalId && (
              <ApprovalGate approvalId={data.approvalId}>
                {(allowed) =>
                  allowed && (
                    <Button
                      variant="primary"
                      className="mt-2"
                      icon={<CloudUpload size={14} />}
                      busy={result?.loading}
                      disabled={Boolean(result?.data)}
                      onClick={() => data.approvalId && void runPush(projectId, data.approvalId)}
                    >
                      {t("delivery.runPush")}
                    </Button>
                  )
                }
              </ApprovalGate>
            )}
            <ErrorNotice error={result?.error} />
            {result?.data && (
              <p className="text-success text-[13px]" role="status">
                {t(result.data.upToDate ? "delivery.upToDate" : "delivery.pushed", {
                  branch: result.data.remoteBranch,
                  sha: result.data.sha.slice(0, 10),
                })}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function DeploySection({ projectId }: { projectId: string }) {
  const t = useT();
  const td = useTd();
  const base = useId();
  const plan = useDeliveryStore((s) => s.deploy[projectId]);
  const result = useDeliveryStore((s) => s.deployResult[projectId]);
  const { prepareDeploy, runDeploy } = useDeliveryStore.getState();
  const [environment, setEnvironment] = useState<"preview" | "production">("preview");
  const [team, setTeam] = useState("");
  const data = plan?.data;
  const prod = data?.environment === "production";
  const blocking = data?.issues.some((i) => i.severity === "blocking") ?? false;

  const run = async () => {
    if (!data?.approvalId) return;
    if (prod) {
      const ok = await confirmAction({
        title: t("deploy.confirmProdTitle"),
        body: t("deploy.confirmProdBody"),
        confirmLabel: t("deploy.runProd"),
        cancelLabel: t("common.cancel"),
        danger: true,
      });
      if (!ok) return;
    }
    void runDeploy(projectId, data.approvalId);
  };

  return (
    <section className="card" aria-labelledby={`${base}-h`}>
      <h3 id={`${base}-h`} className="card-title">
        <Rocket size={15} aria-hidden /> {t("deploy.title")}
      </h3>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void prepareDeploy({ projectId, environment, ...(team.trim() && { team: team.trim() }) });
        }}
      >
        <div className="segmented self-start" role="radiogroup" aria-label={t("deploy.environment")}>
          {(["preview", "production"] as const).map((env) => (
            <button
              key={env}
              type="button"
              role="radio"
              aria-checked={environment === env}
              className={environment === env ? "is-active" : ""}
              onClick={() => setEnvironment(env)}
            >
              {t(env === "preview" ? "deploy.preview" : "deploy.production")}
            </button>
          ))}
        </div>
        {environment === "production" && (
          <p className="notice notice-error text-[12.5px]">{t("deploy.productionWarn")}</p>
        )}
        <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
          <label className="field">
            <span>{t("deploy.team")}</span>
            <input
              className="input font-mono"
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              maxLength={100}
              spellCheck={false}
            />
          </label>
          <Button type="submit" busy={plan?.loading}>
            {t("deploy.prepare")}
          </Button>
        </div>
      </form>
      <div className="mt-3 flex flex-col gap-2">
        <ErrorNotice error={plan?.error} />
        {data && (
          <>
            <div className="flex flex-wrap gap-2 text-[12.5px]">
              <Badge tone={prod ? "danger" : "info"}>{t(prod ? "deploy.production" : "deploy.preview")}</Badge>
              <Badge tone="neutral">{data.framework ?? t("deploy.noFramework")}</Badge>
              <Badge
                tone={
                  data.compatibility === "likely" ? "success" : data.compatibility === "unlikely" ? "danger" : "warning"
                }
              >
                {td("deploy.compat.", data.compatibility)}
              </Badge>
              <Badge tone={data.cliAvailable ? "success" : "warning"}>
                {data.cliAvailable ? t("deploy.cliYes") : t("deploy.cliNo")}
              </Badge>
            </div>
            {data.issues.length > 0 && (
              <ul className="flex flex-col gap-1 text-[12.5px]">
                {data.issues.map((i, k) => (
                  <li key={k}>
                    <Badge tone={i.severity === "blocking" ? "danger" : "warning"}>
                      {td("deploy.severity.", i.severity)}
                    </Badge>{" "}
                    {i.message}
                  </li>
                ))}
              </ul>
            )}
            <pre className="code-block whitespace-pre-wrap">{data.summary}</pre>
            {data.approvalId && data.compatibility !== "unlikely" && (
              <ApprovalGate approvalId={data.approvalId}>
                {(allowed) =>
                  allowed && (
                    <Button
                      variant={prod ? "danger" : "primary"}
                      className="mt-2"
                      busy={result?.loading}
                      disabled={Boolean(result?.data) || !data.cliAvailable || blocking}
                      onClick={() => void run()}
                    >
                      {t(prod ? "deploy.runProd" : "deploy.run")}
                    </Button>
                  )
                }
              </ApprovalGate>
            )}
            {result?.loading && <Spinner label={t("deploy.running")} />}
            <ErrorNotice error={result?.error} />
            {result?.data && (
              <div className="flex flex-col gap-1" role="status">
                <p className="text-success text-[13px]">{t("deploy.done")}</p>
                {/* Texte sélectionnable, volontairement pas un lien : aucune fenêtre externe n'est ouverte. */}
                <input
                  className="input font-mono"
                  readOnly
                  value={result.data.url}
                  aria-label={t("deploy.url")}
                  onFocus={(e) => e.currentTarget.select()}
                />
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export function DeliveryPanel(_props: PanelProps) {
  const t = useT();
  const projectId = useProjectStore((s) => s.current?.projectId);
  if (!projectId) return null;
  return (
    <div className="panel-fill">
      <header className="view-header">
        <div>
          <h2 className="view-title">{t("view.delivery")}</h2>
          <p className="view-subtitle">{t("delivery.subtitle")}</p>
        </div>
      </header>
      <div className="scroll-area px-5 pb-6">
        <div className="grid gap-4 xl:grid-cols-2 max-w-6xl">
          <PushSection projectId={projectId} />
          <DeploySection projectId={projectId} />
        </div>
      </div>
    </div>
  );
}
