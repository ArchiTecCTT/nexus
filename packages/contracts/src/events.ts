// Enveloppe des événements du journal (cahier maître §11, contrats_ipc_evenements.md).
import { z } from "zod";
import { Id, Timestamp } from "./common.ts";

export const ActorType = z.enum(["user", "agent", "system"]);

export const AggregateType = z.enum([
  "project",
  "team",
  "agent_profile",
  "session",
  "mission",
  "task",
  "approval",
  "worktree",
  "deployment",
  "decision",
  "agent_run",
  "voice_transcript",
]);
export type AggregateType = z.infer<typeof AggregateType>;

/** Événement à écrire : l'event store attribue `globalSequence`. */
export const NewDomainEvent = z.strictObject({
  eventId: Id,
  aggregateType: AggregateType,
  aggregateId: Id,
  /** Version attendue de l'agrégat après cet événement (contrôle de concurrence optimiste). */
  aggregateVersion: z.number().int().positive(),
  eventType: z.string().regex(/^[a-z][a-z0-9_.]{1,80}$/),
  payloadSchemaVersion: z.number().int().positive(),
  /** Charge utile déjà expurgée : aucun secret ne doit atteindre le journal (NFR-008). */
  payload: z.record(z.string(), z.unknown()),
  occurredAt: Timestamp,
  correlationId: Id,
  causationId: Id.optional(),
  actorType: ActorType,
  actorId: z.string().min(1).max(100),
});
export type NewDomainEvent = z.infer<typeof NewDomainEvent>;

export const DomainEvent = NewDomainEvent.extend({ globalSequence: z.number().int().positive() });
export type DomainEvent = z.infer<typeof DomainEvent>;
