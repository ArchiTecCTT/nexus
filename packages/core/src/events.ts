// Fabrique d'événements du domaine : un seul endroit construit les enveloppes (identifiants, horodatage, acteur).
import { randomUUID } from "node:crypto";
import type { AggregateType, NewDomainEvent } from "@nexus/contracts";

export type Actor = { actorType: "user" | "agent" | "system"; actorId: string };

export const OWNER: Actor = { actorType: "user", actorId: "owner" };
export const SYSTEM: Actor = { actorType: "system", actorId: "nexus" };

export type Clock = () => string;
export const systemClock: Clock = () => new Date().toISOString();

export function domainEvent(
  aggregateType: AggregateType,
  aggregateId: string,
  aggregateVersion: number,
  eventType: string,
  payload: Record<string, unknown>,
  ctx: { actor: Actor; clock: Clock; correlationId?: string; causationId?: string },
): NewDomainEvent {
  return {
    eventId: randomUUID(),
    aggregateType,
    aggregateId,
    aggregateVersion,
    eventType,
    payloadSchemaVersion: 1,
    payload,
    occurredAt: ctx.clock(),
    correlationId: ctx.correlationId ?? randomUUID(),
    ...(ctx.causationId && { causationId: ctx.causationId }),
    actorType: ctx.actor.actorType,
    actorId: ctx.actor.actorId,
  };
}

/** Erreur métier avec code stable, traduisible en IpcError par le main. */
export class DomainError extends Error {
  readonly code: "not_found" | "conflict" | "invalid_request" | "policy_denied" | "unavailable";
  constructor(code: DomainError["code"], message: string) {
    super(message);
    this.code = code;
  }
}
