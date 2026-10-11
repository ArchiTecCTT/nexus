import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { dispatchIpc, IpcHandlerError, type IpcHandlers } from "../src/main/ipc-dispatch.ts";

const info = { appVersion: "0.1.0", contractsVersion: "1.0.0", platform: "linux", electron: "44", node: "24" };
const handlers: IpcHandlers = { "app.info": () => info };
const env = (channel: string, payload: unknown = {}) => ({ requestId: randomUUID(), channel, payload });

test("requête valide : réponse validée renvoyée", async () => {
  const r = await dispatchIpc(env("app.info"), handlers);
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.data, info);
});

test("enveloppe malformée refusée sans exception", async () => {
  for (const raw of [
    null,
    42,
    "x",
    [],
    { channel: "app.info" },
    { requestId: "nope", channel: "app.info", payload: {} },
  ]) {
    const r = await dispatchIpc(raw, handlers);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.error.code, "invalid_request");
  }
});

test("canal inconnu ou piégé refusé (unknown_channel / invalid_request)", async () => {
  for (const channel of ["app.nope", "projects.delete"]) {
    const r = await dispatchIpc(env(channel), handlers);
    assert.equal(!r.ok && r.error.code, "unknown_channel", channel);
  }
  for (const channel of ["__proto__", "constructor", "app", "../x"]) {
    const r = await dispatchIpc(env(channel), handlers);
    assert.equal(r.ok, false, channel);
  }
});

test("charge utile invalide : champs signalés, valeurs jamais renvoyées", async () => {
  const secret = "valeur-sensible-123";
  const r = await dispatchIpc(env("projects.create", { name: "x", rootPath: secret }), {
    "projects.create": () => {
      throw new Error("ne doit pas être appelé");
    },
  });
  assert.equal(!r.ok && r.error.code, "invalid_request");
  assert.ok(!JSON.stringify(r).includes(secret));
  const extra = await dispatchIpc(env("app.info", { injected: true }), handlers);
  assert.equal(!extra.ok && extra.error.code, "invalid_request");
});

test("réponse non conforme du handler : bloquée (pas de fuite de champ)", async () => {
  const r = await dispatchIpc(env("app.info"), { "app.info": () => ({ ...info, apiKey: "sk-x" }) as never });
  assert.equal(!r.ok && r.error.code, "internal_error");
  assert.ok(!JSON.stringify(r).includes("sk-x"));
});

test("exception interne masquée ; erreur métier exposée avec son code", async () => {
  const boom = await dispatchIpc(env("app.info"), {
    "app.info": () => {
      throw new Error("/home/user/secret/path stack");
    },
  });
  assert.deepEqual(!boom.ok && boom.error, { code: "internal_error", message: "Internal error" });
  const denied = await dispatchIpc(env("app.info"), {
    "app.info": () => {
      throw new IpcHandlerError("policy_denied", "Refusé par la politique");
    },
  });
  assert.deepEqual(!denied.ok && denied.error, { code: "policy_denied", message: "Refusé par la politique" });
});

test("canal déclaré mais sans handler : unavailable", async () => {
  const r = await dispatchIpc(env("projects.list"), handlers);
  assert.equal(!r.ok && r.error.code, "unavailable");
});

test("journal : chaque requête produit une entrée sans charge utile", async () => {
  const entries: unknown[] = [];
  await dispatchIpc(env("app.info"), handlers, (e) => entries.push(e));
  await dispatchIpc(env("app.nope"), handlers, (e) => entries.push(e));
  assert.equal(entries.length, 2);
  assert.ok(entries.every((e) => !("payload" in (e as object))));
});
