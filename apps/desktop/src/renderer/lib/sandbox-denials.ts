// Refus réseau de la sandbox (événement `sandbox-denied`) : toast non bloquant avec « Autoriser ce domaine »,
// qui ajoute la cible à `settings.sandboxExtraAllow` (pris en compte au prochain lancement de la session).
import { toast } from "sonner";
import { tNow } from "../i18n/index.ts";
import { useAppStore } from "../stores/app.ts";
import { useSessionsStore } from "../stores/sessions.ts";

export async function allowSandboxDomain(target: string): Promise<boolean> {
  const app = useAppStore.getState();
  const current = app.settings.data?.sandboxExtraAllow ?? [];
  if (current.includes(target)) {
    toast.info(tNow("sandbox.alreadyAllowed", { target }));
    return true;
  }
  const ok = await app.saveSettings({ sandboxExtraAllow: [...current, target] });
  if (ok) toast.success(tNow("sandbox.allowed", { target }));
  else if (!useAppStore.getState().settingsServed) toast.error(tNow("settings.notServed"));
  return ok;
}

export function onSandboxDenied(event: { taskId?: string; target: string; reason: string }): void {
  useSessionsStore.getState().addDenial(event.taskId, { target: event.target, reason: event.reason });
  toast.warning(tNow("sandbox.blocked", { target: event.target }), {
    id: `sandbox-denied:${event.taskId ?? ""}:${event.target}`,
    description: event.reason,
    action: { label: tNow("sandbox.allowDomain"), onClick: () => void allowSandboxDomain(event.target) },
  });
}
