// Coffre de secrets (cahier maître §12 « Secret Guard », FR-016, T-015).
// - Le chiffrement est délégué à un `Cipher` adossé au coffre de l'OS (Electron safeStorage : libsecret/KWallet,
//   Keychain, DPAPI). Un backend non sûr (ex. « basic_text » de Chromium sous Linux) est REFUSÉ, pas toléré.
// - Les secrets vivent dans un fichier séparé du journal d'événements, droits 0600, écriture atomique.
// - Une valeur n'est jamais renvoyée sans usage autorisé (voir broker) ; jamais dans localStorage ni dans l'UI.
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export type Cipher = {
  /** Nom du backend (ex. `gnome_libsecret`, `keychain`, `dpapi`, `basic_text`). */
  backend: string;
  /** false si le backend ne protège pas réellement (clé fixe connue, absence de coffre). */
  isSecure: boolean;
  encrypt(plain: string): Buffer;
  decrypt(cipher: Buffer): string;
};

export class InsecureBackendError extends Error {}
export class SecretNotFoundError extends Error {}

export type SecretMetadata = {
  ref: string;
  label: string;
  /** Usages autorisés, ex. `connector:openai-api`, `broker:github`, `broker:vercel`. */
  purposes: string[];
  createdAt: string;
  updatedAt: string;
};

type Entry = SecretMetadata & { ciphertext: string };
type FileShape = { version: 1; entries: Record<string, Entry> };

const REF = /^[a-z0-9][a-z0-9:._-]{1,100}$/;
const PURPOSE = /^[a-z]+:[a-z0-9._-]{1,80}$/;

export class SecretVault {
  readonly #file: string;
  readonly #cipher: Cipher;
  readonly #clock: () => string;

  constructor(file: string, cipher: Cipher, clock: () => string = () => new Date().toISOString()) {
    if (!cipher.isSecure) {
      throw new InsecureBackendError(`Backend de chiffrement non sûr (${cipher.backend}) : stockage de secrets refusé`);
    }
    this.#file = file;
    this.#cipher = cipher;
    this.#clock = clock;
  }

  get backend(): string {
    return this.#cipher.backend;
  }

  #read(): FileShape {
    if (!existsSync(this.#file)) return { version: 1, entries: {} };
    const data = JSON.parse(readFileSync(this.#file, "utf8")) as FileShape;
    if (data.version !== 1 || typeof data.entries !== "object") throw new Error("Fichier de secrets illisible");
    return data;
  }

  #write(data: FileShape): void {
    const tmp = `${this.#file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.#file);
  }

  set(ref: string, value: string, meta: { label: string; purposes: string[] }): SecretMetadata {
    if (!REF.test(ref)) throw new Error("Référence de secret invalide");
    if (typeof value !== "string" || value.length === 0 || value.length > 16_384)
      throw new Error("Valeur de secret invalide");
    if (meta.purposes.length === 0 || meta.purposes.some((p) => !PURPOSE.test(p)))
      throw new Error("Usages autorisés invalides");
    const data = this.#read();
    const now = this.#clock();
    const previous = data.entries[ref];
    data.entries[ref] = {
      ref,
      label: meta.label.slice(0, 100),
      purposes: [...new Set(meta.purposes)].sort(),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      ciphertext: this.#cipher.encrypt(value).toString("base64"),
    };
    this.#write(data);
    return this.metadata(ref);
  }

  has(ref: string): boolean {
    return Boolean(this.#read().entries[ref]);
  }

  metadata(ref: string): SecretMetadata {
    const e = this.#read().entries[ref];
    if (!e) throw new SecretNotFoundError(`Secret ${ref} introuvable`);
    const { ciphertext: _c, ...meta } = e;
    return meta;
  }

  list(): SecretMetadata[] {
    return Object.values(this.#read().entries).map(({ ciphertext: _c, ...meta }) => meta);
  }

  delete(ref: string): boolean {
    const data = this.#read();
    if (!data.entries[ref]) return false;
    delete data.entries[ref];
    this.#write(data);
    return true;
  }

  /** Déchiffrement brut : réservé au broker (non exporté par l'index du package). */
  reveal(ref: string): { value: string; purposes: string[] } {
    const e = this.#read().entries[ref];
    if (!e) throw new SecretNotFoundError(`Secret ${ref} introuvable`);
    return { value: this.#cipher.decrypt(Buffer.from(e.ciphertext, "base64")), purposes: e.purposes };
  }
}
