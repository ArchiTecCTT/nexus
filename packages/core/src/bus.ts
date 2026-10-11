// Bus de messages inter-agents et artefacts versionnés (FR-011, UC-04, AC-02, T-011).
// Le pair-à-pair ne donne jamais de permission ni d'accès fichier : un message est une donnée, jamais un ordre
// exécutable. Tout est journalisé et filtrable.
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AgentMessage, type MessageType } from "@nexus/contracts";
import type { EventStore, Projector } from "@nexus/event-store";
import { DomainError, domainEvent, type Actor, type Clock } from "./events.ts";

export const busProjector: Projector = {
  name: "bus",
  async apply(tx, e) {
    if (e.aggregateType !== "mission") return;
    const p = e.payload as Record<string, any>;
    if (e.eventType === "message.sent") {
      const m = p.message as AgentMessage;
      await tx.message.create({
        data: {
          id: m.messageId,
          missionId: m.missionId,
          taskId: m.taskId ?? null,
          senderAgentId: m.senderAgentId,
          recipientAgentId: m.recipientAgentId ?? null,
          type: m.type,
          body: m.body,
          payloadRef: m.payloadRef ?? null,
          correlationId: m.correlationId,
          inReplyTo: m.inReplyTo ?? null,
          timestamp: m.timestamp,
        },
      });
    } else if (e.eventType === "artifact.published") {
      await tx.artifact.create({
        data: {
          id: p.artifactId,
          missionId: e.aggregateId,
          taskId: p.taskId ?? null,
          name: p.name,
          version: p.version,
          mediaType: p.mediaType,
          contentRef: p.contentRef,
          sha256: p.sha256,
          publishedBy: p.publishedBy,
          createdAt: e.occurredAt,
        },
      });
    }
  },
  async reset(tx) {
    await tx.message.deleteMany({});
    await tx.artifact.deleteMany({});
  },
};

/** Paires question -> réponse attendues (une réponse doit référencer une demande du bon type). */
const REPLY_OF: Partial<Record<MessageType, MessageType>> = { answer: "question", review_result: "review_requested" };

export type ArtifactSummary = {
  artifactId: string;
  name: string;
  version: number;
  mediaType: string;
  sha256: string;
  publishedBy: string;
  createdAt: string;
};

export class MessageBus {
  readonly #store: EventStore;
  readonly #clock: Clock;
  readonly #artifactDir: string;
  constructor(store: EventStore, clock: Clock, artifactDir: string) {
    this.#store = store;
    this.#clock = clock;
    this.#artifactDir = artifactDir;
  }

  async #mission(missionId: string) {
    const m = await this.#store.prisma.mission.findUnique({ where: { id: missionId } });
    if (!m) throw new DomainError("not_found", "Mission introuvable");
    return m;
  }

  async #assertMember(teamId: string, agentId: string, label: string): Promise<void> {
    const a = await this.#store.prisma.agentProfile.findUnique({ where: { id: agentId } });
    if (!a || a.teamId !== teamId) throw new DomainError("policy_denied", `${label} hors de l'équipe de la mission`);
  }

  async send(
    input: Omit<AgentMessage, "messageId" | "schemaVersion" | "timestamp" | "correlationId"> & {
      correlationId?: string;
    },
    actor: Actor,
  ): Promise<AgentMessage> {
    const mission = await this.#mission(input.missionId);
    await this.#assertMember(mission.teamId, input.senderAgentId, "Expéditeur");
    if (input.recipientAgentId) await this.#assertMember(mission.teamId, input.recipientAgentId, "Destinataire");
    const expected = REPLY_OF[input.type];
    let correlationId = input.correlationId ?? randomUUID();
    if (expected) {
      if (!input.inReplyTo)
        throw new DomainError("invalid_request", `Un message ${input.type} doit répondre à un ${expected}`);
      const original = await this.#store.prisma.message.findUnique({ where: { id: input.inReplyTo } });
      if (!original || original.missionId !== input.missionId || original.type !== expected) {
        throw new DomainError("invalid_request", `inReplyTo doit désigner un ${expected} de la même mission`);
      }
      correlationId = original.correlationId;
    }
    const message = AgentMessage.parse({
      ...input,
      messageId: randomUUID(),
      schemaVersion: 1,
      timestamp: this.#clock(),
      correlationId,
    });
    await this.#store.append([
      domainEvent(
        "mission",
        mission.id,
        mission.version + 1,
        "message.sent",
        { message },
        { actor, clock: this.#clock, correlationId },
      ),
    ]);
    return message;
  }

  async list(
    missionId: string,
    filter: { type?: MessageType; agentId?: string; correlationId?: string } = {},
  ): Promise<AgentMessage[]> {
    const rows = await this.#store.prisma.message.findMany({
      where: {
        missionId,
        ...(filter.type && { type: filter.type }),
        ...(filter.correlationId && { correlationId: filter.correlationId }),
        ...(filter.agentId && { OR: [{ senderAgentId: filter.agentId }, { recipientAgentId: filter.agentId }] }),
      },
      orderBy: { timestamp: "asc" },
    });
    return rows.map((r) =>
      AgentMessage.parse({
        messageId: r.id,
        schemaVersion: 1,
        missionId: r.missionId,
        ...(r.taskId && { taskId: r.taskId }),
        senderAgentId: r.senderAgentId,
        ...(r.recipientAgentId && { recipientAgentId: r.recipientAgentId }),
        type: r.type,
        body: r.body,
        ...(r.payloadRef && { payloadRef: r.payloadRef }),
        timestamp: r.timestamp,
        correlationId: r.correlationId,
        ...(r.inReplyTo && { inReplyTo: r.inReplyTo }),
      }),
    );
  }

  /** Publie un artefact versionné (v1, v2…) ; le contenu est stocké hors base, référencé et haché. */
  async publishArtifact(
    input: {
      missionId: string;
      taskId?: string;
      name: string;
      mediaType: string;
      content: string;
      publishedBy: string;
    },
    actor: Actor,
  ): Promise<ArtifactSummary> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(input.name))
      throw new DomainError("invalid_request", "Nom d'artefact invalide");
    const mission = await this.#mission(input.missionId);
    await this.#assertMember(mission.teamId, input.publishedBy, "Auteur");
    const last = await this.#store.prisma.artifact.findFirst({
      where: { missionId: mission.id, name: input.name },
      orderBy: { version: "desc" },
    });
    const version = (last?.version ?? 0) + 1;
    const sha256 = createHash("sha256").update(input.content).digest("hex");
    const contentRef = join(mission.id, input.name, `v${version}`);
    const dir = join(this.#artifactDir, mission.id, input.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `v${version}`), input.content, { flag: "wx" });
    const artifactId = randomUUID();
    await this.#store.append([
      domainEvent(
        "mission",
        mission.id,
        mission.version + 1,
        "artifact.published",
        {
          artifactId,
          name: input.name,
          version,
          mediaType: input.mediaType,
          contentRef,
          sha256,
          publishedBy: input.publishedBy,
          ...(input.taskId && { taskId: input.taskId }),
        },
        { actor, clock: this.#clock },
      ),
    ]);
    return {
      artifactId,
      name: input.name,
      version,
      mediaType: input.mediaType,
      sha256,
      publishedBy: input.publishedBy,
      createdAt: this.#clock(),
    };
  }

  /** Lit un artefact et vérifie son intégrité (le contenu sur disque doit correspondre à l'empreinte journalisée). */
  async readArtifact(
    missionId: string,
    name: string,
    version?: number,
  ): Promise<{ summary: ArtifactSummary; content: string }> {
    const a = await this.#store.prisma.artifact.findFirst({
      where: { missionId, name, ...(version !== undefined && { version }) },
      orderBy: { version: "desc" },
    });
    if (!a) throw new DomainError("not_found", "Artefact introuvable");
    const content = readFileSync(join(this.#artifactDir, a.contentRef), "utf8");
    if (createHash("sha256").update(content).digest("hex") !== a.sha256)
      throw new DomainError("conflict", "Intégrité de l'artefact compromise");
    return {
      summary: {
        artifactId: a.id,
        name: a.name,
        version: a.version,
        mediaType: a.mediaType,
        sha256: a.sha256,
        publishedBy: a.publishedBy,
        createdAt: a.createdAt,
      },
      content,
    };
  }
}
