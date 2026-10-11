// Dispatcher IPC côté main, indépendant d'Electron (testable sous Node).
// Le renderer est non fiable : enveloppe, canal, requête et réponse sont validés ici, même si le preload
// a déjà validé (défense en profondeur). Aucune pile ni message interne n'est renvoyé au renderer.
import {
  IpcEnvelope,
  type IpcChannel,
  type IpcError,
  type IpcErrorCode,
  type IpcRequest,
  type IpcResponse,
  type IpcResult,
  ipcChannels,
  isIpcChannel,
} from "@nexus/contracts";

export type IpcHandlers = {
  [C in IpcChannel]?: (request: IpcRequest<C>) => Promise<IpcResponse<C>> | IpcResponse<C>;
};

/** Erreur métier volontairement exposée au renderer (code + message contrôlé). */
export class IpcHandlerError extends Error {
  readonly code: IpcErrorCode;
  constructor(code: IpcErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type DispatchLog = (entry: {
  requestId: string | null;
  channel: string | null;
  outcome: "ok" | IpcErrorCode;
}) => void;

const fail = (requestId: string, code: IpcErrorCode, message: string): IpcResult<never> => ({
  requestId,
  ok: false,
  error: { code, message } satisfies IpcError,
});

export async function dispatchIpc(
  raw: unknown,
  handlers: IpcHandlers,
  log: DispatchLog = () => {},
): Promise<IpcResult<unknown>> {
  const envelope = IpcEnvelope.safeParse(raw);
  if (!envelope.success) {
    log({ requestId: null, channel: null, outcome: "invalid_request" });
    return fail("00000000-0000-0000-0000-000000000000", "invalid_request", "Malformed IPC envelope");
  }
  const { requestId, channel, payload } = envelope.data;

  if (!isIpcChannel(channel)) {
    log({ requestId, channel, outcome: "unknown_channel" });
    return fail(requestId, "unknown_channel", `Unknown channel ${channel}`);
  }
  const spec = ipcChannels[channel];
  const request = spec.request.safeParse(payload);
  if (!request.success) {
    log({ requestId, channel, outcome: "invalid_request" });
    // Chemins des champs en erreur seulement : pas d'écho des valeurs envoyées.
    const fields = request.error.issues.map((i) => i.path.join(".") || "(root)").slice(0, 10);
    return fail(requestId, "invalid_request", `Invalid payload: ${fields.join(", ")}`);
  }
  const handler = handlers[channel] as ((r: unknown) => unknown) | undefined;
  if (!handler) {
    log({ requestId, channel, outcome: "unavailable" });
    return fail(requestId, "unavailable", `Channel ${channel} is not available`);
  }

  try {
    const data = await handler(request.data);
    const response = spec.response.safeParse(data);
    if (!response.success) {
      // Une réponse non conforme est un bug du main : on ne l'envoie pas (pas de fuite de champ inattendu).
      log({ requestId, channel, outcome: "internal_error" });
      return fail(requestId, "internal_error", "Internal error");
    }
    log({ requestId, channel, outcome: "ok" });
    return { requestId, ok: true, data: response.data };
  } catch (e) {
    if (e instanceof IpcHandlerError) {
      log({ requestId, channel, outcome: e.code });
      return fail(requestId, e.code, e.message.slice(0, 2000));
    }
    log({ requestId, channel, outcome: "internal_error" });
    return fail(requestId, "internal_error", "Internal error");
  }
}
