// Déploiement guidé du projet fini : analyse (lecture seule) → propositions comparables → avis de l'IA qui pilote →
// préparation (paramètres, jetons, variables) → exécution étape par étape avec journal en direct.
// Les jetons et valeurs de variables partent directement au coffre du main (`deployPlan.setSecret`) : le champ est
// vidé aussitôt et la valeur n'est jamais relue ; seule une coche indique sa présence.
import type { DeploymentPlan, DeploymentProposal, ProposalStep } from "@nexus/contracts";
import {
  Bot,
  Check,
  CircleAlert,
  CircleCheckBig,
  CircleDashed,
  Copy,
  Database,
  KeyRound,
  LoaderCircle,
  Monitor,
  Play,
  RefreshCw,
  Rocket,
  ScanSearch,
  Server,
  Sparkles,
  SkipForward,
  Undo2,
  Workflow,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { toNexusError, type NexusError } from "../api.ts";
import { useT, type TKey } from "../i18n/index.ts";
import { errorText } from "../lib/actions.ts";
import { useAppStore } from "../stores/app.ts";
import { useDeployPlanStore } from "../stores/deployPlan.ts";
import { useProjectStore } from "../stores/project.ts";
import { NON_AGENT_TOOLS } from "../types.ts";
import { Badge, Button, EmptyState, Skeleton, cx } from "../ui/primitives.tsx";
import type { PanelProps } from "../workbench/DockHost.tsx";

type Proposal = DeploymentProposal;
type Role = Proposal["placements"][number]["role"];
type Provider = Proposal["placements"][number]["provider"];

const PROVIDER_LABEL: Record<Provider, string> = {
  vercel: "Vercel",
  netlify: "Netlify",
  render: "Render",
  railway: "Railway",
  "hostinger-vps": "VPS Hostinger",
  fly: "Fly.io",
  "mongodb-atlas": "MongoDB Atlas",
  supabase: "Supabase",
  neon: "Neon",
};
const ROLE_ICON: Record<Role, typeof Monitor> = {
  frontend: Monitor,
  backend: Server,
  database: Database,
  worker: Workflow,
};
/** Jeton de plateforme attendu dans le coffre, par hébergeur. */
const TOKEN_REF: Partial<Record<Provider, string>> = {
  vercel: "deploy.vercel",
  render: "deploy.render",
  railway: "deploy.railway",
  "mongodb-atlas": "deploy.atlas",
};
/** Variables remplies automatiquement par les étapes précédentes si laissées vides (cf. deploy-planner). */
const DB_ENV = /^(MONGODB_URI|MONGO_URI|MONGO_URL|MONGODB_URL|DATABASE_URL|DB_URL|DB_URI)$/;
const API_ENV = /(API_URL|API_BASE_URL|BACKEND_URL|SERVER_URL|API_ENDPOINT)$/;

const envRef = (componentId: string, name: string) => `deploy.env.${componentId.toLowerCase()}.${name.toLowerCase()}`;
/** Fait défiler jusqu'à un champ (ou une étape) et le focalise, avec un bref surlignage. */
export function focusDeployTarget(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  const focusable = el.matches("input, button, select, textarea") ? el : el.querySelector<HTMLElement>("input, button");
  focusable?.focus({ preventScroll: true });
  el.classList.add("is-flash");
  setTimeout(() => el.classList.remove("is-flash"), 1400);
}

const fieldId = (key: string) => `dplan-field-${key.replace(/\./g, "-")}`;
const secretId = (ref: string) => `dplan-secret-${ref.replace(/\./g, "-")}`;
const stepId = (id: string) => `dplan-step-${id}`;
const DB_PROVIDERS = new Set<Provider>(["mongodb-atlas", "supabase", "neon"]);
const FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{20,}={0,2}$/;

interface Missing {
  label: string;
  target: string;
}

/** Rôle d'une étape (ordre base → back → front) : composant ciblé, sinon base de données selon le fournisseur. */
function stepRole(step: ProposalStep, plan: DeploymentPlan): Role | undefined {
  const comp = plan.profile.components.find((c) => c.id === step.componentId);
  if (comp) return comp.role === "worker" ? "backend" : comp.role;
  return DB_PROVIDERS.has(step.provider) ? "database" : undefined;
}

/** Prérequis manquants pour lancer une étape automatique (paramètres enregistrés, secrets du coffre, étapes amont). */
function missingFor(
  step: ProposalStep,
  plan: DeploymentPlan,
  proposal: Proposal,
  secrets: string[],
  t: ReturnType<typeof useT>,
): Missing[] {
  const out: Missing[] = [];
  const input = (k: string) => plan.inputs[k]?.trim() ?? "";
  const need = (k: string, label: string) => {
    if (!input(k)) out.push({ label, target: fieldId(k) });
  };
  const token = TOKEN_REF[step.provider];
  if (token && !secrets.includes(token))
    out.push({ label: t("dplan.tokenOf", { provider: PROVIDER_LABEL[step.provider] }), target: secretId(token) });
  const repo = input("repo") || githubRepo(plan.profile.gitRemote);
  if (step.provider === "mongodb-atlas") {
    need("atlas.clientId", t("dplan.atlasClient"));
    need("atlas.groupId", t("dplan.atlasGroup"));
    if (!input("atlas.cidr") && input("atlas.allowAnywhere") !== "true")
      out.push({ label: t("dplan.atlasAccess"), target: fieldId("atlas.cidr") });
  } else if (step.provider === "hostinger-vps") {
    need("vps.host", t("dplan.vpsHost"));
    need("vps.user", t("dplan.vpsUser"));
    need("vps.keyPath", t("dplan.vpsKey"));
    if (!FINGERPRINT.test(input("vps.hostKeyFingerprint")))
      out.push({ label: t("dplan.vpsFingerprint"), target: fieldId("vps.hostKeyFingerprint") });
    if (!repo && !input("vps.repoUrl")) out.push({ label: t("dplan.repo"), target: fieldId("repo") });
  } else if (["vercel", "render", "railway"].includes(step.provider) && !repo) {
    out.push({ label: t("dplan.repo"), target: fieldId("repo") });
  }
  // Ordre : la base avant le back, le back (et la base) avant le front.
  const role = stepRole(step, plan);
  const before = role === "backend" ? ["database"] : role === "frontend" ? ["database", "backend"] : [];
  for (const other of proposal.steps) {
    if (other.id === step.id) continue;
    const r = stepRole(other, plan);
    const st = plan.stepStatus[other.id]?.status;
    if (r && before.includes(r) && st !== "done" && st !== "skipped")
      out.push({ label: t("dplan.afterStep", { title: other.title }), target: stepId(other.id) });
  }
  return out;
}

const githubRepo = (remote?: string) => remote?.match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/)?.[1];

function DeployErrorNotice({ error }: { error?: NexusError }) {
  const t = useT();
  if (!error) return null;
  const known = `err.${error.code}` as TKey;
  const message = error.code === "unknown_channel" ? undefined : error.message;
  return (
    <div className="notice notice-error" role="alert">
      <CircleAlert size={15} aria-hidden />
      <div className="min-w-0">
        <p className="notice-title">{message || t(known)}</p>
        {message && error.code !== "unavailable" && error.code !== "policy_denied" && (
          <p className="notice-detail">{t(known)}</p>
        )}
      </div>
    </div>
  );
}

function CopyField({ value, label }: { value: string; label: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2 items-center">
      <input
        className="input input-sm font-mono"
        readOnly
        value={value}
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
      />
      <Button
        size="sm"
        icon={copied ? <Check size={13} /> : <Copy size={13} />}
        onClick={() =>
          void navigator.clipboard
            ?.writeText(value)
            .then(() => setCopied(true))
            .catch(() => {})
        }
      >
        {copied ? t("pr.copied") : t("pr.copy")}
      </Button>
    </div>
  );
}

function Section({
  n,
  title,
  children,
  actions,
}: {
  n: number;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="dplan-section" aria-label={title}>
      <h3 className="dplan-section-title">
        <span className="step">{n}</span>
        <span className="flex-1">{title}</span>
        {actions}
      </h3>
      {children}
    </section>
  );
}

// --- 1. Résumé de l'analyse -------------------------------------------------------------------------------------

function ProfileSummary({ plan }: { plan: DeploymentPlan }) {
  const t = useT();
  const { profile } = plan;
  return (
    <div className="flex flex-col gap-3" data-testid="deploy-profile">
      {profile.components.length === 0 ? (
        <div className="notice notice-muted">
          <CircleAlert size={15} aria-hidden />
          <p>{t("dplan.noComponents")}</p>
        </div>
      ) : (
        <div className="dplan-components">
          {profile.components.map((c) => {
            const Icon = ROLE_ICON[c.role];
            return (
              <div key={c.id} className={cx("dplan-component", `role-${c.role}`)}>
                <div className="flex items-center gap-2">
                  <span className="dplan-role-icon" aria-hidden>
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="block truncate text-[11px] text-fg-subtle font-mono">{c.path}</span>
                  </span>
                  <Badge tone="accent">{t(`dplan.role.${c.role}` as TKey)}</Badge>
                </div>
                <p className="text-[11.5px] text-fg-muted mt-1.5">
                  {[
                    c.framework,
                    c.language,
                    c.hasDockerfile ? "Dockerfile" : undefined,
                    c.port ? `:${c.port}` : undefined,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {c.envNames.length > 0 && (
                  <div className="dplan-env-names" aria-label={t("dplan.expectedVars")}>
                    {c.envNames.map((n) => (
                      <code key={n}>{n}</code>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {profile.databases.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center text-[12px]">
          <Database size={13} className="text-fg-subtle" aria-hidden />
          <span className="text-fg-muted">{t("dplan.databases")}</span>
          {profile.databases.map((d) => (
            <span key={d.kind} title={d.evidence}>
              <Badge tone="info">{d.kind}</Badge>
            </span>
          ))}
        </div>
      )}
      {profile.notes.length > 0 && (
        <ul className="dplan-notes">
          {profile.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- 2. Propositions ------------------------------------------------------------------------------------------------

/** Placement des composants, en texte : « Front (client) → Vercel ». */
function PlacementSchema({ proposal, plan }: { proposal: Proposal; plan: DeploymentPlan }) {
  const t = useT();
  return (
    <ul className="placement-list" aria-label={t("dplan.placement")}>
      {proposal.placements.map((p) => {
        const comp = plan.profile.components.find((c) => c.id === p.componentId);
        return (
          <li key={`${p.componentId}-${p.provider}`} className="placement-row" title={p.why}>
            <span className="font-medium">{t(`dplan.roleShort.${p.role}` as TKey)}</span>
            {comp && comp.path !== "." && <span className="text-fg-subtle"> ({comp.path})</span>}
            <span className="text-fg-subtle"> → </span>
            <span>{PROVIDER_LABEL[p.provider]}</span>
            {p.plan && <span className="text-fg-subtle"> · {p.plan}</span>}
          </li>
        );
      })}
    </ul>
  );
}

function ProposalCard({ proposal, plan }: { proposal: Proposal; plan: DeploymentPlan }) {
  const t = useT();
  const choose = useDeployPlanStore((s) => s.choose);
  const busy = useDeployPlanStore((s) => s.busy);
  const chosen = plan.chosenProposalId === proposal.id;
  const { monthlyCost: cost } = proposal;
  const symbol = cost.currency === "EUR" ? "€" : "$";
  return (
    <article
      className={cx("proposal-card", chosen && "is-chosen")}
      data-testid="proposal-card"
      aria-label={proposal.title}
    >
      <header className="flex items-start gap-2">
        <h4 className="proposal-title flex-1">{proposal.title}</h4>
        {proposal.origin === "ai" ? (
          <Badge tone="accent">
            <Sparkles size={11} aria-hidden /> {t("dplan.originAi")}
          </Badge>
        ) : (
          <Badge>{t("dplan.originRules")}</Badge>
        )}
      </header>
      <p className="proposal-summary">{proposal.summary}</p>
      <PlacementSchema proposal={proposal} plan={plan} />
      <div className="proposal-facts">
        <div>
          <span className="stat-label">{t("dplan.cost")}</span>
          <span className="proposal-cost">
            {cost.min === cost.max ? `${cost.min} ${symbol}` : `${cost.min}–${cost.max} ${symbol}`}
            <span className="text-fg-subtle text-[11px] font-normal"> {t("dplan.perMonth")}</span>
          </span>
        </div>
        <div>
          <span className="stat-label">{t("dplan.complexity")}</span>
          <Badge
            tone={proposal.complexity === "low" ? "success" : proposal.complexity === "medium" ? "warning" : "danger"}
          >
            {t(`dplan.complexity.${proposal.complexity}` as TKey)}
          </Badge>
        </div>
      </div>
      <p className="text-[11px] text-fg-subtle">{cost.caveat}</p>
      {(proposal.pros.length > 0 || proposal.cons.length > 0) && (
        <ul className="proposal-points">
          {proposal.pros.map((p, i) => (
            <li key={`p${i}`} className="is-pro">
              {p}
            </li>
          ))}
          {proposal.cons.map((c, i) => (
            <li key={`c${i}`} className="is-con">
              {c}
            </li>
          ))}
        </ul>
      )}
      <footer className="mt-auto pt-2 flex gap-2">
        {chosen ? (
          <>
            <Badge tone="success">
              <Check size={11} aria-hidden /> {t("dplan.chosen")}
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              disabled={busy === "choose"}
              onClick={() => void choose(null).catch((e: unknown) => toast.error(errorText(e)))}
            >
              {t("dplan.unchoose")}
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="primary"
            className="w-full"
            busy={busy === "choose"}
            onClick={() => void choose(proposal.id).catch((e: unknown) => toast.error(errorText(e)))}
          >
            {t("dplan.choose")}
          </Button>
        )}
      </footer>
    </article>
  );
}

// --- 3. IA qui pilote ---------------------------------------------------------------------------------------------

function LeadBlock({ plan }: { plan: DeploymentPlan }) {
  const t = useT();
  const inventory = useAppStore((s) => s.inventory);
  const apiConnectors = useAppStore((s) => s.settings.data?.apiConnectors);
  const leadToken = useDeployPlanStore((s) => s.leadToken);
  const leadError = useDeployPlanStore((s) => s.leadError);
  const askLead = useDeployPlanStore((s) => s.askLead);
  const cancelLead = useDeployPlanStore((s) => s.cancelLead);
  const [agent, setAgent] = useState("");
  const [request, setRequest] = useState("");
  const [now, setNow] = useState(Date.now());

  const agents = useMemo(() => {
    const ids = (inventory.data ?? [])
      .filter((p) => p.installed && !NON_AGENT_TOOLS.has(p.connectorId))
      .map((p) => p.connectorId);
    for (const c of apiConnectors ?? []) if (c.id && !ids.includes(c.id)) ids.push(c.id);
    return ids;
  }, [inventory.data, apiConnectors]);

  useEffect(() => {
    if (!inventory.data && !inventory.loading) void useAppStore.getState().loadDiagnostics();
  }, [inventory.data, inventory.loading]);
  useEffect(() => {
    if ((!agent || !agents.includes(agent)) && agents[0]) setAgent(agents[0]);
  }, [agents, agent]);
  useEffect(() => {
    if (!leadToken) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [leadToken]);

  const elapsed = leadToken ? Math.max(0, Math.round((now - leadToken) / 1000)) : 0;
  return (
    <div className="dplan-lead" data-testid="deploy-lead">
      <div className="flex flex-wrap items-end gap-3">
        <label className="field w-[200px]">
          <span>{t("dplan.leadAgent")}</span>
          <select
            className="input"
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            disabled={agents.length === 0 || Boolean(leadToken)}
          >
            {agents.length === 0 && <option value="">{t("dplan.noAgent")}</option>}
            {agents.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="field flex-1 min-w-[240px]">
          <span>{t("dplan.leadRequest")}</span>
          <input
            className="input"
            maxLength={4000}
            value={request}
            placeholder={t("dplan.leadRequestPlaceholder")}
            disabled={Boolean(leadToken)}
            onChange={(e) => setRequest(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && agent && !leadToken) void askLead(agent, request);
            }}
          />
        </label>
        {leadToken ? (
          <Button variant="ghost" onClick={cancelLead}>
            {t("common.cancel")}
          </Button>
        ) : (
          <Button
            variant="secondary"
            icon={<Bot size={14} />}
            disabled={!agent}
            onClick={() => void askLead(agent, request)}
          >
            {t("dplan.leadAsk")}
          </Button>
        )}
      </div>
      {leadToken && (
        <div className="dplan-lead-wait" role="status">
          <LoaderCircle size={14} className="spin" aria-hidden />
          <span className="flex-1">{t("dplan.leadWaiting", { agent })}</span>
          <span className="font-mono text-fg-subtle">
            {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
          </span>
        </div>
      )}
      <DeployErrorNotice error={leadError} />
      {plan.advice && (
        <div className="dplan-advice" data-testid="deploy-advice">
          <p className="dplan-advice-title">
            <Sparkles size={13} aria-hidden /> {t("dplan.advice")}
          </p>
          <p className="whitespace-pre-wrap">{plan.advice}</p>
        </div>
      )}
    </div>
  );
}

// --- 4. Préparer ----------------------------------------------------------------------------------------------------

function SecretField({ refName, label, hint }: { refName: string; label: string; hint?: string }) {
  const t = useT();
  const present = useDeployPlanStore((s) => s.secrets.includes(refName));
  const setSecret = useDeployPlanStore((s) => s.setSecret);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const v = value;
    if (!v || busy) return;
    setValue(""); // Le champ est vidé aussitôt : la valeur ne reste pas dans l'interface.
    setBusy(true);
    try {
      await setSecret(refName, v);
      toast.success(t("dplan.secretSaved", { name: label }));
    } catch (e) {
      // Message du main (ex. « Coffre de secrets indisponible ») plutôt que le libellé générique.
      const err = toNexusError(e, "deployPlan.setSecret");
      toast.error(err.code === "unknown_channel" || !err.message ? errorText(e) : err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="secret-field" data-ref={refName}>
      <label className="field flex-1 min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="font-mono truncate">{label}</span>
          {present && (
            <span className="text-success inline-flex items-center gap-0.5" data-testid="secret-present">
              <Check size={12} aria-hidden /> {t("dplan.secretPresent")}
            </span>
          )}
        </span>
        <input
          id={secretId(refName)}
          className="input input-sm"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={present ? t("dplan.secretReplace") : (hint ?? t("dplan.secretPlaceholder"))}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            }
          }}
        />
      </label>
      <Button size="sm" busy={busy} disabled={!value} onClick={() => void save()}>
        {t("common.save")}
      </Button>
    </div>
  );
}

function PrepareStep({ plan, proposal }: { plan: DeploymentPlan; proposal: Proposal }) {
  const t = useT();
  const setInputs = useDeployPlanStore((s) => s.setInputs);
  const busy = useDeployPlanStore((s) => s.busy);
  const providers = useMemo(() => new Set(proposal.placements.map((p) => p.provider)), [proposal]);
  const detectedRepo = githubRepo(plan.profile.gitRemote);
  const initial = useMemo(
    () => ({
      repo: plan.inputs.repo ?? detectedRepo ?? "",
      branch: plan.inputs.branch ?? "main",
      "vps.host": plan.inputs["vps.host"] ?? "",
      "vps.user": plan.inputs["vps.user"] ?? "",
      "vps.port": plan.inputs["vps.port"] ?? "22",
      "vps.keyPath": plan.inputs["vps.keyPath"] ?? "",
      "atlas.clientId": plan.inputs["atlas.clientId"] ?? "",
      "atlas.groupId": plan.inputs["atlas.groupId"] ?? "",
      "atlas.cidr": plan.inputs["atlas.cidr"] ?? "",
      "atlas.allowAnywhere": plan.inputs["atlas.allowAnywhere"] ?? "false",
      "atlas.dbName": plan.inputs["atlas.dbName"] ?? "",
      "vps.hostKeyFingerprint": plan.inputs["vps.hostKeyFingerprint"] ?? "",
      "vercel.production": plan.inputs["vercel.production"] ?? "false",
    }),
    [plan.inputs, detectedRepo],
  );
  const [form, setForm] = useState<Record<string, string>>(initial);
  useEffect(() => setForm(initial), [initial]);
  const dirty = Object.entries(form).some(([k, v]) => (initial as Record<string, string>)[k] !== v);
  const field = (
    key: string,
    label: string,
    opts: { placeholder?: string; mono?: boolean; width?: string; help?: ReactNode } = {},
  ) => (
    <label className={cx("field", opts.width ?? "flex-1 min-w-[160px]")}>
      <span>{label}</span>
      <input
        id={fieldId(key)}
        className={cx("input input-sm", opts.mono && "font-mono")}
        maxLength={500}
        value={form[key] ?? ""}
        placeholder={opts.placeholder}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      />
      {opts.help && <span className="text-[11px] text-fg-subtle">{opts.help}</span>}
    </label>
  );

  const tokens = [...providers].flatMap((p) => (TOKEN_REF[p] ? [{ provider: p, ref: TOKEN_REF[p] }] : []));
  const placed = new Set(proposal.placements.map((p) => p.componentId));
  const comps = plan.profile.components.filter((c) => placed.has(c.id) && c.envNames.length > 0);

  return (
    <div className="flex flex-col gap-4" data-testid="deploy-prepare">
      {proposal.requirements.length > 0 && (
        <div>
          <p className="dplan-subtitle">{t("dplan.requirements")}</p>
          <ul className="dplan-reqs">
            {proposal.requirements.map((r) => (
              <li key={r.id}>
                <KeyRound size={13} className="text-fg-subtle mt-0.5" aria-hidden />
                <div className="min-w-0">
                  <p className="text-[12.5px]">
                    {r.label}
                    {r.provider && <span className="text-fg-subtle"> · {PROVIDER_LABEL[r.provider]}</span>}
                  </p>
                  {r.help && <p className="text-[11.5px] text-fg-subtle">{r.help}</p>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void setInputs(form).then(
            () => toast.success(t("dplan.inputsSaved")),
            (err: unknown) => toast.error(errorText(err)),
          );
        }}
      >
        <p className="dplan-subtitle">{t("dplan.parameters")}</p>
        <div className="flex flex-wrap gap-3">
          {field("repo", t("dplan.repo"), { placeholder: "owner/repo", mono: true })}
          {field("branch", t("dplan.branch"), { placeholder: "main", mono: true, width: "w-[140px]" })}
        </div>
        {providers.has("hostinger-vps") && (
          <fieldset className="dplan-fieldset">
            <legend>{t("dplan.vps")}</legend>
            <div className="flex flex-wrap gap-3">
              {field("vps.host", t("dplan.vpsHost"), { placeholder: "203.0.113.10", mono: true })}
              {field("vps.user", t("dplan.vpsUser"), { placeholder: "root", mono: true, width: "w-[130px]" })}
              {field("vps.port", t("dplan.vpsPort"), { placeholder: "22", mono: true, width: "w-[80px]" })}
              {field("vps.keyPath", t("dplan.vpsKey"), { placeholder: "~/.ssh/id_ed25519", mono: true })}
            </div>
            <div className="flex flex-wrap gap-3 mt-3">
              {field("vps.hostKeyFingerprint", t("dplan.vpsFingerprint"), {
                placeholder: "SHA256:…",
                mono: true,
                help: (
                  <>
                    {t("dplan.vpsFingerprintHelp")} <code>ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</code>
                  </>
                ),
              })}
            </div>
          </fieldset>
        )}
        {providers.has("mongodb-atlas") && (
          <fieldset className="dplan-fieldset">
            <legend>MongoDB Atlas</legend>
            <div className="flex flex-wrap gap-3">
              {field("atlas.clientId", t("dplan.atlasClient"), { mono: true })}
              {field("atlas.groupId", t("dplan.atlasGroup"), { mono: true })}
            </div>
            <div className="flex flex-wrap gap-3 mt-3">
              {field("atlas.cidr", t("dplan.atlasCidr"), {
                placeholder: "203.0.113.0/24, 198.51.100.7/32",
                mono: true,
                help: t("dplan.atlasCidrHelp"),
              })}
              {field("atlas.dbName", t("dplan.atlasDbName"), { placeholder: "app", mono: true, width: "w-[180px]" })}
            </div>
            <label className="check mt-3" id={fieldId("atlas.allowAnywhere")}>
              <input
                type="checkbox"
                checked={form["atlas.allowAnywhere"] === "true"}
                onChange={(e) => setForm((f) => ({ ...f, "atlas.allowAnywhere": e.target.checked ? "true" : "false" }))}
              />
              {t("dplan.atlasAllowAnywhere")}
            </label>
            {form["atlas.allowAnywhere"] === "true" && (
              <p className="notice notice-error notice-compact mt-2" role="alert">
                <CircleAlert size={14} aria-hidden /> {t("dplan.atlasAllowAnywhereWarn")}
              </p>
            )}
          </fieldset>
        )}
        {providers.has("vercel") && (
          <label className="check">
            <input
              type="checkbox"
              checked={form["vercel.production"] === "true"}
              onChange={(e) => setForm((f) => ({ ...f, "vercel.production": e.target.checked ? "true" : "false" }))}
            />
            {t("dplan.vercelProd")}
          </label>
        )}
        <div>
          <Button type="submit" size="sm" variant={dirty ? "primary" : "secondary"} busy={busy === "inputs"}>
            {t("dplan.saveInputs")}
          </Button>
        </div>
      </form>

      {tokens.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="dplan-subtitle">{t("dplan.tokens")}</p>
          {tokens.map(({ provider, ref }) => (
            <SecretField key={ref} refName={ref} label={t("dplan.tokenOf", { provider: PROVIDER_LABEL[provider] })} />
          ))}
        </div>
      )}

      {comps.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="dplan-subtitle">{t("dplan.envValues")}</p>
          <p className="text-[11.5px] text-fg-subtle">{t("dplan.envAutoHint")}</p>
          {comps.map((c) => (
            <fieldset key={c.id} className="dplan-fieldset">
              <legend>
                {c.name} <span className="text-fg-subtle font-mono">({c.path})</span>
              </legend>
              <div className="flex flex-col gap-2">
                {c.envNames.map((n) => {
                  const auto = (DB_ENV.test(n) && c.role !== "frontend") || (API_ENV.test(n) && c.role === "frontend");
                  return (
                    <SecretField
                      key={n}
                      refName={envRef(c.id, n)}
                      label={n}
                      {...(auto && { hint: t("dplan.envAuto") })}
                    />
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      )}
    </div>
  );
}

// --- 5. Déployer ----------------------------------------------------------------------------------------------------

function StepRow({
  step,
  index,
  plan,
  proposal,
}: {
  step: ProposalStep;
  index: number;
  plan: DeploymentPlan;
  proposal: Proposal;
}) {
  const t = useT();
  const secrets = useDeployPlanStore((s) => s.secrets);
  const missing = step.kind === "auto" ? missingFor(step, plan, proposal, secrets, t) : [];
  const status = plan.stepStatus[step.id];
  const busy = useDeployPlanStore((s) => s.busy);
  const anyRunning = Boolean(busy?.startsWith("step:"));
  const runningHere = busy === `step:${step.id}` || status?.status === "running";
  const logs = useDeployPlanStore((s) => s.logs[step.id]);
  const error = useDeployPlanStore((s) => s.stepErrors[step.id]);
  const runStep = useDeployPlanStore((s) => s.runStep);
  const markStep = useDeployPlanStore((s) => s.markStep);
  const state = runningHere ? "running" : (status?.status ?? "pending");
  const Icon =
    state === "done"
      ? CircleCheckBig
      : state === "failed"
        ? CircleAlert
        : state === "running"
          ? LoaderCircle
          : state === "skipped"
            ? SkipForward
            : CircleDashed;
  return (
    <li id={stepId(step.id)} className={cx("deploy-step", `is-${state}`)} data-testid="deploy-step" data-step={step.id}>
      <span className="deploy-step-icon" aria-hidden>
        <Icon size={16} className={cx(state === "running" && "spin")} />
      </span>
      <div className="min-w-0 flex-1 flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-fg-subtle font-mono text-[11px]">{index + 1}.</span>
          <span className="font-medium text-[13px]">{step.title}</span>
          <Badge tone="info">{PROVIDER_LABEL[step.provider]}</Badge>
          <Badge>{step.kind === "auto" ? t("dplan.kindAuto") : t("dplan.kindManual")}</Badge>
          <Badge
            tone={
              state === "done" ? "success" : state === "failed" ? "danger" : state === "running" ? "accent" : "neutral"
            }
          >
            {t(`dplan.status.${state}` as TKey)}
          </Badge>
        </div>
        <p className={cx("text-[12px] whitespace-pre-wrap", step.kind === "manual" ? "text-fg" : "text-fg-muted")}>
          {step.detail}
        </p>
        {status?.message && (
          <p className={cx("text-[12px]", state === "failed" ? "text-danger" : "text-fg-muted")}>{status.message}</p>
        )}
        {!status?.message && error && <DeployErrorNotice error={error} />}
        {status?.url && <CopyField value={status.url} label={t("dplan.url")} />}
        {missing.length > 0 && state !== "running" && (
          <div className="dplan-missing" data-testid="step-missing" id={`${stepId(step.id)}-missing`}>
            <p>{t("dplan.missingTitle")}</p>
            <ul>
              {missing.map((m) => (
                <li key={`${m.target}-${m.label}`}>
                  <button type="button" className="link-btn" onClick={() => focusDeployTarget(m.target)}>
                    {m.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {logs && logs.length > 0 && (
          <details className="deploy-log" open={state === "running"}>
            <summary>{t("dplan.log", { n: logs.length })}</summary>
            <pre>{logs.join("\n")}</pre>
          </details>
        )}
      </div>
      <div className="flex flex-col gap-1 items-end shrink-0">
        {step.kind === "auto" ? (
          <Button
            size="sm"
            variant={state === "done" ? "ghost" : "primary"}
            icon={state === "done" || state === "failed" ? <RefreshCw size={13} /> : <Play size={13} />}
            busy={runningHere}
            disabled={(anyRunning && !runningHere) || (missing.length > 0 && !runningHere)}
            aria-describedby={missing.length > 0 ? `${stepId(step.id)}-missing` : undefined}
            title={missing.length > 0 ? t("dplan.missingTitle") : undefined}
            onClick={() => void runStep(step.id)}
          >
            {state === "done" || state === "failed" ? t("dplan.rerun") : t("dplan.run")}
          </Button>
        ) : state === "done" || state === "skipped" ? (
          <Button
            size="sm"
            variant="ghost"
            icon={<Undo2 size={13} />}
            onClick={() => void markStep(step.id, "pending")}
          >
            {t("dplan.markPending")}
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="primary"
              icon={<Check size={13} />}
              onClick={() => void markStep(step.id, "done")}
            >
              {t("dplan.markDone")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void markStep(step.id, "skipped")}>
              {t("dplan.markSkipped")}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

// --- Panneau ----------------------------------------------------------------------------------------------------------

export function DeploymentPanel(_props: PanelProps) {
  const t = useT();
  const projectId = useProjectStore((s) => s.current?.projectId);
  const plan = useDeployPlanStore((s) => (s.projectId === projectId ? s.plan : undefined));
  const loading = useDeployPlanStore((s) => s.loading);
  const busy = useDeployPlanStore((s) => s.busy);
  const error = useDeployPlanStore((s) => s.error);
  const analyze = useDeployPlanStore((s) => s.analyze);

  useEffect(() => {
    if (projectId) void useDeployPlanStore.getState().load(projectId);
  }, [projectId]);

  const proposal = plan?.proposals.find((p) => p.id === plan.chosenProposalId);
  const doneCount = proposal ? proposal.steps.filter((s) => plan?.stepStatus[s.id]?.status === "done").length : 0;
  const stage = !plan ? 0 : !proposal ? 1 : doneCount > 0 ? 3 : 2;
  const stages = [t("dplan.stage.analyze"), t("dplan.stage.choose"), t("dplan.stage.prepare"), t("dplan.stage.deploy")];

  return (
    <div className="panel-fill" data-testid="deployment-panel">
      <header className="view-header">
        <div className="min-w-0">
          <h2 className="view-title">{t("view.deployment")}</h2>
          <p className="view-subtitle">{t("dplan.subtitle")}</p>
        </div>
        {plan && (
          <Button
            size="sm"
            variant="ghost"
            icon={<ScanSearch size={14} />}
            busy={busy === "analyze"}
            onClick={() => void analyze()}
          >
            {t("dplan.reanalyze")}
          </Button>
        )}
      </header>
      <ol className="dplan-stages" aria-label={t("dplan.progress")}>
        {stages.map((label, i) => (
          <li key={label} className={cx(i < stage && "is-done", i === stage && "is-current")}>
            <span className="dplan-stage-dot">{i < stage ? <Check size={11} aria-hidden /> : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <div className="scroll-area px-5 pb-8">
        <div className="mb-3">
          <DeployErrorNotice error={error} />
        </div>
        {plan === undefined && loading ? (
          <Skeleton lines={4} />
        ) : !plan ? (
          <EmptyState
            icon={<Rocket size={28} />}
            title={t("dplan.emptyTitle")}
            action={
              <Button
                variant="primary"
                icon={<ScanSearch size={15} />}
                busy={busy === "analyze"}
                onClick={() => void analyze()}
              >
                {t("dplan.analyze")}
              </Button>
            }
          >
            {t("dplan.emptyBody")}
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-6">
            <Section n={1} title={t("dplan.summary")}>
              <ProfileSummary plan={plan} />
            </Section>
            {plan.proposals.length > 0 && (
              <Section n={2} title={t("dplan.proposals")}>
                <div className="proposal-grid">
                  {plan.proposals.map((p) => (
                    <ProposalCard key={p.id} proposal={p} plan={plan} />
                  ))}
                </div>
                <div className="mt-4">
                  <p className="dplan-subtitle flex items-center gap-1.5">
                    <Bot size={13} aria-hidden /> {t("dplan.leadTitle")}
                  </p>
                  <p className="text-[11.5px] text-fg-subtle mb-2">{t("dplan.leadHint")}</p>
                  <LeadBlock plan={plan} />
                </div>
              </Section>
            )}
            {proposal && (
              <>
                <Section n={3} title={t("dplan.prepareTitle", { title: proposal.title })}>
                  <PrepareStep plan={plan} proposal={proposal} />
                </Section>
                <Section
                  n={4}
                  title={t("dplan.deployTitle")}
                  actions={
                    <span className="text-[12px] text-fg-subtle font-normal">
                      {t("dplan.stepsDone", { done: doneCount, total: proposal.steps.length })}
                    </span>
                  }
                >
                  <p className="text-[11.5px] text-fg-subtle mb-2">{t("dplan.deployHint")}</p>
                  <ol className="deploy-steps">
                    {proposal.steps.map((s, i) => (
                      <StepRow key={s.id} step={s} index={i} plan={plan} proposal={proposal} />
                    ))}
                  </ol>
                </Section>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
