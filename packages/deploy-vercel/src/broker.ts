// Broker de déploiement Vercel (§14, UC-07, AC-08, NFR-009, FR-018) : processus réseau privilégié, distinct des agents.
//
// Invariants :
// - toute exécution passe par `runProcess` (binaire absolu, tableau d'arguments, shell:false, env construit, timeout,
//   plafond de sortie, frontière PID namespace par défaut) ;
// - un déploiement ne s'exécute qu'APRÈS `approvals.consume` réussi, avec l'action `vercel_deploy_preview` ou
//   `vercel_deploy_production` : deux actions distinctes, une approbation de preview ne vaut JAMAIS pour la production
//   (l'action ET l'environnement font partie du plan approuvé) ;
// - le jeton éventuel vient du coffre (`getToken`) et n'est transmis QUE par la variable d'environnement `VERCEL_TOKEN`,
//   jamais en argument (visible dans /proc/<pid>/cmdline) ; il est expurgé de tout journal et de toute erreur.
//
// LIMITES DÉCLARÉES : la CLI Vercel n'a été exercée qu'avec une fausse CLI (script). À VÉRIFIER contre une version réelle :
// - `vercel deploy --yes [--prod] [--scope <équipe>]` (noms et sémantique exacts des options) ;
// - la prise en compte de `VERCEL_TOKEN` comme jeton (équivalent documenté de `--token`) ;
// - le format de sortie : URL du déploiement seule sur stdout quand stdout n'est pas un TTY, journal sur stderr ;
// - `VERCEL_TELEMETRY_DISABLED`, `CI`, `NO_COLOR` : effet réel sur la CLI ;
// - le nom de projet attendu n'est pas transmis à la CLI (option non vérifiée) : il est affiché pour validation.
import { isAbsolute } from "node:path";
import type { Actor, ApprovalService } from "@nexus/core";
import { resolveExecutable, runProcess, type RunOptions, type RunResult } from "@nexus/process-supervisor";
import { detectProject, type ProjectDetection } from "./detect.ts";
import { clean, VercelError } from "./errors.ts";
import { createHash } from "node:crypto";

export type Runner = (opts: RunOptions) => Promise<RunResult>;
export type ApprovalConsumer = Pick<ApprovalService, "consume">;
export type DeployEnvironment = "preview" | "production";
export type DeployAction = "vercel_deploy_preview" | "vercel_deploy_production";

/** Fournisseur de jeton (coffre, T-015). `null`/`undefined` : la CLI utilise la session `vercel login` de l'utilisateur. */
export type TokenProvider = () => string | null | undefined | Promise<string | null | undefined>;

export type VercelBrokerOptions = {
  /** Chemin absolu de la CLI vercel ; absent -> `deploy` lève `unavailable`. */
  vercelPath?: string;
  home: string;
  /** PATH transmis (la CLI vercel est un script Node : `node` doit y être). Entrées absolues uniquement. */
  pathEnv: string;
  approvals: ApprovalConsumer;
  getToken?: TokenProvider;
  actor?: Actor;
  timeoutMs?: number;
  runner?: Runner;
};

export type PlanDeploymentInput = {
  root: string;
  environment: DeployEnvironment;
  projectName?: string;
  team?: string;
};

export type DeploymentApprovalPlan = {
  kind: "nexus.vercel_deploy";
  v: 1;
  action: DeployAction;
  environment: DeployEnvironment;
  root: string;
  projectName: string | null;
  team: string | null;
  linked: boolean;
  framework: string | null;
  buildCommand: string | null;
  /** Commande exacte (sans le chemin du binaire) : aucun jeton n'y figure jamais. */
  command: string[];
  requiredEnv: string[];
  compatibility: ProjectDetection["compatibility"];
  issues: string[];
  packageJsonSha256: string | null;
  vercelJsonSha256: string | null;
};

export type PreparedDeployment = {
  input: PlanDeploymentInput;
  detection: ProjectDetection;
  /** Objet EXACT à passer à `approvals.request({ action: approvalPlan.action, plan: approvalPlan })`. */
  approvalPlan: DeploymentApprovalPlan;
  fingerprint: string;
  summary: string;
};

export type DeployResult = {
  url: string;
  environment: DeployEnvironment;
  /** Journal borné et expurgé (stdout + stderr). */
  log: string[];
  logTruncated: boolean;
};

export const VERCEL_VERIFICATION = {
  realCliTested: false,
  notes: [
    "La CLI vercel n'est pas installée sur l'hôte de développement : deploy testé avec une fausse CLI.",
    "Options `deploy --yes`, `--prod`, `--scope` et variable VERCEL_TOKEN à vérifier contre la version réelle.",
    "Extraction d'URL basée sur le format observé documenté (URL seule sur stdout) : à confirmer.",
  ],
} as const;

const SYSTEM_ACTOR: Actor = { actorType: "system", actorId: "nexus-vercel" };
const PROJECT_NAME = /^[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9])?$/;
const TEAM_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const MAX_LOG_LINES = 400;
const MAX_LOG_BYTES = 64 * 1024;

export const actionFor = (env: DeployEnvironment): DeployAction =>
  env === "production" ? "vercel_deploy_production" : "vercel_deploy_preview";

export function locateVercel(pathEnv: string): string | null {
  return resolveExecutable("vercel", pathEnv)?.path ?? null;
}

const canonical = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .filter((k) => o[k] !== undefined)
        .sort()
        .map((k) => [k, canonical(o[k])]),
    );
  }
  return v;
};
const fingerprintOf = (plan: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify(canonical(plan)))
    .digest("hex");

export class VercelBroker {
  readonly vercelPath: string | undefined;
  private readonly approvals: ApprovalConsumer;
  private readonly getToken: TokenProvider | undefined;
  private readonly actor: Actor;
  private readonly baseEnv: Readonly<Record<string, string>>;
  private readonly timeoutMs: number;
  private readonly runner: Runner;

  constructor(opts: VercelBrokerOptions) {
    if (typeof opts.home !== "string" || !isAbsolute(opts.home)) {
      throw new VercelError("invalid_argument", "home : chemin absolu requis");
    }
    if (opts.vercelPath !== undefined && (typeof opts.vercelPath !== "string" || !isAbsolute(opts.vercelPath))) {
      throw new VercelError("invalid_argument", "vercelPath : chemin absolu requis");
    }
    if (!opts.approvals || typeof opts.approvals.consume !== "function") {
      throw new VercelError("invalid_argument", "service d'approbation requis");
    }
    this.vercelPath = opts.vercelPath;
    this.approvals = opts.approvals;
    this.getToken = opts.getToken;
    this.actor = opts.actor ?? SYSTEM_ACTOR;
    this.timeoutMs = opts.timeoutMs ?? 15 * 60_000;
    this.runner = opts.runner ?? runProcess;
    const pathEnv = String(opts.pathEnv ?? "")
      .split(":")
      .filter((d) => d && isAbsolute(d))
      .join(":");
    this.baseEnv = {
      HOME: opts.home,
      LANG: "C",
      LC_ALL: "C",
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      CI: "1",
      VERCEL_TELEMETRY_DISABLED: "1",
      ...(pathEnv ? { PATH: pathEnv } : {}),
    };
  }

  detectProject(root: string): ProjectDetection {
    return detectProject(root);
  }

  /** Résumé à approuver : projet, environnement, framework, commande, variables requises (noms seulement). */
  planDeployment(input: PlanDeploymentInput): PreparedDeployment {
    if (!input || typeof input !== "object") throw new VercelError("invalid_argument", "entrée invalide");
    const { environment } = input;
    if (environment !== "preview" && environment !== "production") {
      throw new VercelError("invalid_argument", "environnement : preview ou production");
    }
    if (
      input.projectName !== undefined &&
      (typeof input.projectName !== "string" || !PROJECT_NAME.test(input.projectName))
    ) {
      throw new VercelError("invalid_argument", "nom de projet Vercel invalide");
    }
    if (input.team !== undefined && (typeof input.team !== "string" || !TEAM_SLUG.test(input.team))) {
      throw new VercelError("invalid_argument", "équipe (scope) Vercel invalide");
    }
    const detection = detectProject(input.root);
    const command = ["deploy", "--yes", ...(environment === "production" ? ["--prod"] : [])];
    if (input.team) command.push("--scope", input.team);
    const action = actionFor(environment);
    const approvalPlan: DeploymentApprovalPlan = {
      kind: "nexus.vercel_deploy",
      v: 1,
      action,
      environment,
      root: detection.root,
      projectName: input.projectName ?? null,
      team: input.team ?? null,
      linked: detection.linked,
      framework: detection.framework,
      buildCommand: detection.buildCommand,
      command,
      requiredEnv: detection.requiredEnv,
      compatibility: detection.compatibility,
      issues: detection.issues.map((i) => i.code),
      packageJsonSha256: detection.packageJsonSha256,
      vercelJsonSha256: detection.vercelJsonSha256,
    };
    const project = input.projectName ?? detection.packageName ?? "(nom du dossier)";
    const lines = [
      `${environment === "production" ? "DÉPLOIEMENT EN PRODUCTION" : "Déploiement preview"} Vercel du projet « ${project} »${input.team ? ` (équipe ${input.team})` : ""}`,
      `Dossier : ${detection.root} ; ${detection.linked ? "projet lié (.vercel présent)" : "projet NON lié : la CLI liera le dossier avec ses valeurs par défaut"}`,
      `Framework : ${detection.framework ?? "non détecté"} ; build : ${detection.buildCommand ?? "aucun"}`,
      `Commande : vercel ${command.join(" ")}`,
      `Variables requises (noms) : ${detection.requiredEnv.length ? detection.requiredEnv.join(", ") : "aucune détectée"}`,
      `Compatibilité Vercel : ${detection.compatibility}${detection.issues.length ? ` (${detection.issues.map((i) => i.code).join(", ")})` : ""}`,
      "Coût : selon l'offre Vercel du compte (non estimé par Nexus).",
    ];
    return {
      input: { ...input },
      detection,
      approvalPlan,
      fingerprint: fingerprintOf(approvalPlan),
      summary: lines.join("\n").slice(0, 2000),
    };
  }

  async deploy(
    plan: PreparedDeployment,
    approvalId: string,
    opts: { signal?: AbortSignal } = {},
  ): Promise<DeployResult> {
    const ap = plan?.approvalPlan;
    if (!ap || ap.kind !== "nexus.vercel_deploy" || !plan.input) {
      throw new VercelError("invalid_argument", "plan de déploiement invalide");
    }
    if (ap.environment !== plan.input.environment || ap.action !== actionFor(ap.environment)) {
      throw new VercelError("invalid_argument", "action et environnement incohérents");
    }
    if (!this.vercelPath) throw new VercelError("unavailable", "CLI vercel non configurée : déploiement indisponible");
    if (typeof approvalId !== "string" || approvalId.length === 0) {
      throw new VercelError("approval_denied", "approbation requise");
    }

    // 1. Approbation AVANT toute commande, pour l'action propre à l'environnement.
    try {
      await this.approvals.consume(approvalId, ap.action, ap, this.actor);
    } catch (e) {
      throw new VercelError("approval_denied", `approbation refusée : ${(e as Error).message}`);
    }

    // 2. Le projet doit toujours correspondre au plan approuvé.
    let current: PreparedDeployment;
    try {
      current = this.planDeployment(plan.input);
    } catch (e) {
      throw new VercelError("state_changed", `le projet ne correspond plus au plan : ${(e as Error).message}`);
    }
    if (current.fingerprint !== fingerprintOf(ap)) {
      throw new VercelError("state_changed", "le projet a changé depuis l'approbation : nouveau plan requis");
    }

    // 3. Jeton depuis le coffre, transmis uniquement par l'environnement.
    let token: string | null = null;
    if (this.getToken) {
      const t = await this.getToken();
      if (typeof t === "string" && t.length > 0) {
        if (!/^[\x21-\x7e]{8,512}$/.test(t))
          throw new VercelError("invalid_argument", "jeton Vercel de forme invalide");
        token = t;
      }
    }
    const known = token ? [token] : [];
    const env: Record<string, string> = { ...this.baseEnv, ...(token ? { VERCEL_TOKEN: token } : {}) };
    const args = [...ap.command];
    if (token && args.some((a) => a.includes(token)))
      throw new VercelError("invalid_argument", "jeton interdit en argument");

    const log: string[] = [];
    let logBytes = 0;
    let logTruncated = false;
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const r = await this.runner({
      file: this.vercelPath,
      args,
      cwd: current.detection.root,
      env,
      timeoutMs: this.timeoutMs,
      killGraceMs: 3000,
      maxOutputBytes: 16 << 20,
      redact: known,
      maxLineBytes: 8192,
      ...(opts.signal ? { signal: opts.signal } : {}),
      onLine: (line, channel) => {
        const l = clean(line, 2000, known);
        (channel === "stdout" ? stdoutLines : stderrLines).push(l);
        if (stdoutLines.length > 200) stdoutLines.shift();
        if (stderrLines.length > 200) stderrLines.shift();
        if (log.length >= MAX_LOG_LINES || logBytes + l.length > MAX_LOG_BYTES) {
          logTruncated = true;
          log.shift();
        }
        log.push(l);
        logBytes = log.reduce((n, x) => n + x.length, 0);
      },
    });
    const tail = clean(stderrLines.slice(-15).join("\n"), 1200, known);
    if (r.spawnError) throw new VercelError("unavailable", `lancement de vercel impossible (${r.spawnError})`);
    if (r.timedOut) throw new VercelError("timeout", "déploiement : délai dépassé");
    if (r.outputLimitExceeded) throw new VercelError("output_limit", "déploiement : sortie au-delà de la limite");
    if (r.cancelled) throw new VercelError("deploy_failed", "déploiement annulé");
    if (r.exitCode !== 0) {
      if (
        /not logged in|No existing credentials|token is not valid|invalid token|vercel login|Not authorized/i.test(tail)
      ) {
        throw new VercelError("auth_required", `authentification Vercel requise : ${tail}`);
      }
      throw new VercelError("deploy_failed", `vercel deploy a échoué (code ${r.exitCode}) : ${tail}`, { log });
    }
    const url = extractDeploymentUrl(stdoutLines.join("\n"), stderrLines.join("\n"));
    if (!url) throw new VercelError("deploy_failed", "URL de déploiement introuvable dans la sortie", { log });
    return { url, environment: ap.environment, log, logTruncated };
  }
}

/**
 * URL du déploiement : dernière URL https de stdout (la CLI y écrit l'URL seule quand stdout n'est pas un TTY),
 * sinon ligne `Production:`/`Preview:` de stderr, sinon dernière URL *.vercel.app de stderr.
 */
export function extractDeploymentUrl(stdout: string, stderr = ""): string | null {
  const URL_RE = /https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[^\s"'<>\][)]*)?/g;
  const last = (text: string, re: RegExp): string | null => {
    const all = [...text.matchAll(re)];
    return all.length ? all[all.length - 1]![0] : null;
  };
  const trim = (u: string | null) => (u ? u.replace(/[.,;:]+$/, "") : null);
  const fromStdout = last(stdout, URL_RE);
  if (fromStdout) return trim(fromStdout);
  const labelled = [...stderr.matchAll(/(?:Production|Preview):\s*(https:\/\/\S+)/g)];
  if (labelled.length) return trim(labelled[labelled.length - 1]![1]!);
  return trim(last(stderr, /https:\/\/[A-Za-z0-9.-]+\.vercel\.app\b[^\s]*/g));
}
