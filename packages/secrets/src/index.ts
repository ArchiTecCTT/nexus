export { InsecureBackendError, SecretNotFoundError, SecretVault, type Cipher, type SecretMetadata } from "./vault.ts";
export { SecretAccessDenied, SecretBroker, type AccessRecord } from "./broker.ts";

/** Backends de safeStorage (Electron) considérés comme protégeant réellement les données. */
export const SECURE_BACKENDS: ReadonlySet<string> = new Set([
  "gnome_libsecret",
  "kwallet",
  "kwallet5",
  "kwallet6",
  "keychain",
  "dpapi",
]);
