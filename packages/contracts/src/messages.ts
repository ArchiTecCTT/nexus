// Enveloppe des messages inter-agents (cahier maître §10, UC-04).
import { z } from "zod";
import { Id, Timestamp } from "./common.ts";

export const MessageType = z.enum([
  "task_assigned",
  "question",
  "answer",
  "artifact_published",
  "review_requested",
  "review_result",
  "decision_proposed",
  "human_approval_requested",
  "error",
]);
export type MessageType = z.infer<typeof MessageType>;

export const AgentMessage = z.strictObject({
  messageId: Id,
  schemaVersion: z.literal(1),
  missionId: Id,
  taskId: Id.optional(),
  senderAgentId: Id,
  /** `undefined` = diffusion à l'équipe. */
  recipientAgentId: Id.optional(),
  type: MessageType,
  /** Corps court affichable ; le contenu volumineux est référencé par `payloadRef`. */
  body: z.string().max(20_000),
  payloadRef: z.string().max(500).optional(),
  timestamp: Timestamp,
  correlationId: Id,
  /** Message auquel celui-ci répond (question -> answer, review_requested -> review_result). */
  inReplyTo: Id.optional(),
});
export type AgentMessage = z.infer<typeof AgentMessage>;
