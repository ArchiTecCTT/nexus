// Petit utilitaire d'action asynchrone : état « occupé », erreur typée, et remise à zéro.
import { useCallback, useState } from "react";
import { toNexusError, type NexusError } from "./api.ts";

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<NexusError | undefined>(undefined);
  const run = useCallback(async (fn: () => Promise<void>): Promise<boolean> => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(toNexusError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  const clear = useCallback(() => setError(undefined), []);
  return { busy, error, run, clear };
}
