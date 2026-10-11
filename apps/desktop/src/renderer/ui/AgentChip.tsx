// Puce d'un agent détecté : nom d'affichage, état de connexion (vert connecté, ambre non connecté, gris inconnu)
// et aide pour se connecter (commande à lancer une fois dans un terminal).
import { useT } from "../i18n/index.ts";
import { agentLoginCommand, agentName } from "./AgentAvatar.tsx";
import { Tip, cx } from "./primitives.tsx";

export function authHelp(t: ReturnType<typeof useT>, connectorId: string): string {
  return t("agents.loginHelp", { cmd: agentLoginCommand(connectorId) });
}

export function AgentChip({
  connectorId,
  version,
  authenticated,
}: {
  connectorId: string;
  version?: string;
  authenticated?: boolean;
}) {
  const t = useT();
  const state = authenticated === true ? "ok" : authenticated === false ? "off" : "unknown";
  const label =
    state === "ok" ? t("agents.connected") : state === "off" ? t("agents.notConnected") : t("agents.authUnknown");
  const tip = [
    `${agentName(connectorId)}${version ? ` ${version}` : ""}`,
    label,
    state === "off" && authHelp(t, connectorId),
  ]
    .filter(Boolean)
    .join(" — ");
  return (
    <Tip label={tip}>
      <span className={cx("chip agent-chip", `is-${state}`)} tabIndex={0} data-testid={`agent-chip-${connectorId}`}>
        <span
          className={cx("status-dot", state === "ok" ? "dot-success" : state === "off" ? "dot-warning" : "dot-muted")}
          aria-hidden
        />
        {agentName(connectorId)}
        {state === "off" && <span className="agent-chip-warn">{t("agents.notConnected")}</span>}
        <span className="sr-only">{label}</span>
      </span>
    </Tip>
  );
}
