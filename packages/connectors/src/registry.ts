// Registre des connecteurs et inventaire des CLI (FR-003, UC-01, AC-01).
import type { AgentConnector, ConnectorManifest, ProbeResult } from "@nexus/contracts";
import { probeCli, type ProbeContext } from "./probe.ts";
import { CLI_SIGNATURES, type CliSignature } from "./signatures.ts";

export class ConnectorRegistry {
  readonly #connectors = new Map<string, AgentConnector>();

  register(connector: AgentConnector): void {
    if (this.#connectors.has(connector.manifest.id))
      throw new Error(`Connector ${connector.manifest.id} already registered`);
    this.#connectors.set(connector.manifest.id, connector);
  }

  /** Retire un connecteur (ex. connecteur API supprimé ou reconfiguré dans les réglages). */
  unregister(id: string): boolean {
    return this.#connectors.delete(id);
  }

  get(id: string): AgentConnector | undefined {
    return this.#connectors.get(id);
  }

  manifests(): ConnectorManifest[] {
    return [...this.#connectors.values()].map((c) => c.manifest);
  }

  /**
   * Inventaire complet : chaque connecteur enregistré est sondé, ainsi que les outils d'intégration connus.
   * Une sonde qui échoue ne fait jamais échouer l'inventaire (sondes en parallèle, erreurs converties en résultat).
   */
  async inventory(ctx: ProbeContext, signatures: readonly CliSignature[] = CLI_SIGNATURES): Promise<ProbeResult[]> {
    const clock = ctx.clock ?? (() => new Date().toISOString());
    const byId = new Map<string, () => Promise<ProbeResult>>();
    for (const sig of signatures) byId.set(sig.connectorId, () => probeCli(sig, ctx));
    for (const c of this.#connectors.values()) byId.set(c.manifest.id, () => c.probe());
    const results = await Promise.all(
      [...byId.entries()].map(async ([connectorId, probe]) => {
        try {
          return await probe();
        } catch (e) {
          return {
            connectorId,
            installed: false,
            reason: `probe_failed: ${(e as Error).message}`.slice(0, 500),
            probedAt: clock(),
          };
        }
      }),
    );
    return results.sort((a, b) => a.connectorId.localeCompare(b.connectorId));
  }
}
