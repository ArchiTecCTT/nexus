// Broker de secrets : seul point de sortie d'une valeur, pour un usage déclaré et autorisé (§12).
// Les agents génériques ne reçoivent jamais de secret ; seuls les connecteurs API (clé injectée à la requête) et les
// brokers spécialisés (GitHub, Vercel) en obtiennent, pour leur usage, sans exposition au modèle ni au renderer.
import { createRedactor, redactKnownTokenPatterns } from "@nexus/process-supervisor";
import type { SecretVault } from "./vault.ts";

export class SecretAccessDenied extends Error {}

export type AccessRecord = { at: string; ref: string; purpose: string; granted: boolean };

export class SecretBroker {
  readonly #vault: SecretVault;
  readonly #clock: () => string;
  /** Journal des accès (métadonnées seulement, jamais la valeur). */
  readonly audit: AccessRecord[] = [];
  /** Valeurs déjà révélées pendant cette session : alimentent l'expurgation de toutes les sorties. */
  readonly #revealed = new Set<string>();
  readonly #onAccess: ((r: AccessRecord) => void) | undefined;

  constructor(vault: SecretVault, opts: { clock?: () => string; onAccess?: (r: AccessRecord) => void } = {}) {
    this.#vault = vault;
    this.#clock = opts.clock ?? (() => new Date().toISOString());
    this.#onAccess = opts.onAccess;
  }

  #record(ref: string, purpose: string, granted: boolean): void {
    const r = { at: this.#clock(), ref, purpose, granted };
    this.audit.push(r);
    this.#onAccess?.(r);
  }

  /** Fournit la valeur à `fn` si `purpose` est autorisé pour ce secret ; la valeur n'est pas conservée par le broker. */
  async withSecret<T>(ref: string, purpose: string, fn: (value: string) => Promise<T> | T): Promise<T> {
    let revealed: { value: string; purposes: string[] };
    try {
      revealed = this.#vault.reveal(ref);
    } catch {
      this.#record(ref, purpose, false);
      throw new SecretAccessDenied(`Secret ${ref} indisponible`);
    }
    if (!revealed.purposes.includes(purpose)) {
      this.#record(ref, purpose, false);
      throw new SecretAccessDenied(`Usage ${purpose} non autorisé pour ${ref}`);
    }
    this.#record(ref, purpose, true);
    this.#revealed.add(revealed.value);
    return fn(revealed.value);
  }

  /** Fabrique un `getApiKey` pour un connecteur API (T-008) limité à son usage. */
  apiKeyProvider(ref: string, purpose: string): () => Promise<string> {
    return () => this.withSecret(ref, purpose, (v) => v);
  }

  /** Valeurs à expurger de toute sortie (journal, logs, flux, exports). */
  knownSecrets(): string[] {
    return [...this.#revealed];
  }

  redact(text: string): string {
    return redactKnownTokenPatterns(createRedactor(this.knownSecrets())(text));
  }
}
