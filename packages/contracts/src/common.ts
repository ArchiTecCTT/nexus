import { z } from "zod";

/** Version du jeu de contrats. Toute modification incompatible incrémente la majeure (ADR requis). */
export const CONTRACTS_VERSION = "1.1.0";

export const Id = z.uuid();
export type Id = z.infer<typeof Id>;

export const Timestamp = z.iso.datetime({ offset: true });
export type Timestamp = z.infer<typeof Timestamp>;

/** Chaîne courte non vide, bornée pour éviter les charges utiles démesurées via IPC. */
export const ShortText = z.string().trim().min(1).max(200);
export const LongText = z.string().max(100_000);

/** Chemin absolu POSIX ou Windows, sans octet NUL. La validation de périmètre reste côté broker. */
export const AbsolutePath = z
  .string()
  .min(1)
  .max(4096)
  .refine((p) => !p.includes("\0"), "NUL byte")
  .refine((p) => p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p), "absolute path required");

export const Platform = z.enum(["linux", "win32", "darwin"]);
export type Platform = z.infer<typeof Platform>;
