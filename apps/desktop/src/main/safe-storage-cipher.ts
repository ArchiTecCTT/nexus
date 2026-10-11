// Chiffrement des secrets par le coffre de l'OS (Electron safeStorage : libsecret/KWallet, Keychain, DPAPI).
// Sous Linux sans coffre, Chromium retombe sur « basic_text » (clé fixe connue) : ce backend est marqué non sûr,
// et le coffre de Nexus refuse alors de stocker (§12 : jamais de sécurité simulée).
import { safeStorage } from "electron";
import { SECURE_BACKENDS, type Cipher } from "@nexus/secrets";

export function safeStorageCipher(): Cipher | undefined {
  if (!safeStorage.isEncryptionAvailable()) return undefined;
  const backend =
    process.platform === "linux"
      ? (safeStorage.getSelectedStorageBackend?.() ?? "unknown")
      : process.platform === "darwin"
        ? "keychain"
        : "dpapi";
  return {
    backend,
    isSecure: SECURE_BACKENDS.has(backend),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (buf) => safeStorage.decryptString(buf),
  };
}
