// Moteur de politiques (matrice des permissions, cahier maître §12, T-013). Fonction pure et explicable :
// chaque décision porte la règle appliquée. Seul ce moteur accorde ; un agent ne peut que proposer (§10).
import { createHash } from "node:crypto";
import type { PermissionMode, SensitiveAction } from "@nexus/contracts";

export type PolicyContext = {
  mode: PermissionMode;
  /** Isolation OS vérifiée au démarrage (sonde bwrap + PID namespace, ADR-001). */
  sandboxAvailable: boolean;
  /** Mode d'authentification du profil d'agent. */
  authMode: "vendor-login" | "api-key" | "local-none";
};

export type PolicyDecision =
  | { effect: "allow"; rule: string }
  | { effect: "require_approval"; rule: string; approvalKind: "notify" | "confirm" | "confirm_distinct" }
  | { effect: "deny"; rule: string };

const allow = (rule: string): PolicyDecision => ({ effect: "allow", rule });
const deny = (rule: string): PolicyDecision => ({ effect: "deny", rule });
const ask = (rule: string, approvalKind: "notify" | "confirm" | "confirm_distinct" = "confirm"): PolicyDecision => ({
  effect: "require_approval",
  rule,
  approvalKind,
});

export function evaluatePolicy(action: SensitiveAction, ctx: PolicyContext): PolicyDecision {
  // Invariants indépendants du mode (matrice : refus par défaut, confirmation toujours distincte).
  if (action === "git_force_push" || action === "remote_branch_delete")
    return deny("force-push/suppression distante : refus par défaut (hors MVP)");
  if (action === "vercel_deploy_production")
    return ask("production : confirmation spécifique, toujours distincte", "confirm_distinct");
  if (action === "git_push" || action === "github_pr_create")
    return ask("action distante : confirmation avec aperçu destination/commits");
  if (action === "merge_to_main") return ask("aucun merge silencieux (ADR-008) : revue humaine");

  // §12 : sans isolation OS vérifiée, refuser l'autonomie au lieu de simuler une sécurité.
  if (ctx.mode === "sandbox-auto" && !ctx.sandboxAvailable)
    return deny("sandbox-auto sans isolation OS vérifiée : refusé");

  switch (ctx.mode) {
    case "autonomous":
      // Choix du propriétaire : l'agent agit directement, sans validation (seules les actions distantes restent confirmées).
      return allow(`autonomous : ${action} autorisé`);
    case "read-only":
      return deny(`read-only : ${action} interdit`);
    case "manual":
      if (action === "file_write") return allow("manual : écriture du worktree après assignation explicite");
      if (action === "vercel_deploy_preview") return ask("preview Vercel : consentement");
      return ask(`manual : ${action} soumis à validation humaine`);
    case "notify":
      if (action === "file_write" || action === "command_exec") return ask(`notify : ${action} notifié`, "notify");
      if (action === "vercel_deploy_preview") return ask("preview Vercel : consentement");
      return ask(`notify : ${action} confirmé`);
    case "sandbox-auto":
      if (action === "file_write" || action === "command_exec")
        return allow("sandbox-auto : automatique dans le confinement vérifié");
      if (action === "network_egress") return allow("sandbox-auto : egress limité à l'allowlist du proxy");
      if (action === "dependency_install")
        return ask("installation de dépendance réseau : confirmation selon politique");
      if (action === "vercel_deploy_preview") return ask("preview Vercel : consentement selon politique");
      return ask(`sandbox-auto : ${action} confirmé`);
  }
}

/** Empreinte déterministe d'un plan à approuver (clés triées) : l'approbation ne vaut que pour ce plan exact. */
export function planFingerprint(plan: unknown): string {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical(plan)))
    .digest("hex");
}
