// Projets (FR-001, FR-002) : ouverture/création d'un projet sur un dossier local valide.
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ProjectSummary } from "@nexus/contracts";
import type { EventStore, Projector } from "@nexus/event-store";
import { DomainError, domainEvent, type Actor, type Clock } from "./events.ts";

type ProjectCreated = { name: string; rootPath: string; isGitRepository: boolean };

export const projectsProjector: Projector = {
  name: "projects",
  async apply(tx, e) {
    if (e.aggregateType !== "project") return;
    if (e.eventType === "project.created") {
      const p = e.payload as ProjectCreated;
      await tx.project.create({
        data: {
          id: e.aggregateId,
          name: p.name,
          rootPath: p.rootPath,
          isGitRepository: p.isGitRepository,
          createdAt: e.occurredAt,
          updatedAt: e.occurredAt,
          version: e.aggregateVersion,
        },
      });
    } else if (e.eventType === "project.env_protection_changed") {
      const p = e.payload as { protectEnvFiles: boolean };
      await tx.project.update({
        where: { id: e.aggregateId },
        data: { protectEnvFiles: p.protectEnvFiles, updatedAt: e.occurredAt, version: e.aggregateVersion },
      });
    }
  },
  async reset(tx) {
    await tx.project.deleteMany({});
  },
};

type ProjectRow = { id: string; name: string; rootPath: string; createdAt: string; isGitRepository: boolean };

const toSummary = (r: ProjectRow): ProjectSummary => ({
  projectId: r.id,
  name: r.name,
  rootPath: r.rootPath,
  createdAt: r.createdAt,
  isGitRepository: r.isGitRepository,
});

export class ProjectService {
  readonly #store: EventStore;
  readonly #clock: Clock;
  constructor(store: EventStore, clock: Clock) {
    this.#store = store;
    this.#clock = clock;
  }

  async create(input: { name: string; rootPath: string }, actor: Actor): Promise<ProjectSummary> {
    if (!existsSync(input.rootPath) || !statSync(input.rootPath).isDirectory()) {
      throw new DomainError("invalid_request", "Le chemin du projet doit être un dossier existant");
    }
    // Chemin canonique : deux chemins menant au même dossier (symlink) désignent le même projet.
    const rootPath = realpathSync(input.rootPath);
    const existing = await this.#store.prisma.project.findUnique({ where: { rootPath } });
    if (existing) throw new DomainError("conflict", "Un projet existe déjà pour ce dossier");
    const projectId = randomUUID();
    const isGitRepository = existsSync(join(rootPath, ".git"));
    await this.#store.append([
      domainEvent(
        "project",
        projectId,
        1,
        "project.created",
        { name: input.name, rootPath, isGitRepository },
        { actor, clock: this.#clock },
      ),
    ]);
    return this.get(projectId);
  }

  async list(): Promise<ProjectSummary[]> {
    const rows = await this.#store.prisma.project.findMany({ orderBy: { createdAt: "asc" } });
    return rows.map(toSummary);
  }

  async get(projectId: string): Promise<ProjectSummary> {
    const row = await this.#store.prisma.project.findUnique({ where: { id: projectId } });
    if (!row) throw new DomainError("not_found", "Projet introuvable");
    return toSummary(row);
  }

  /** Décision D-4 : protection des `.env*` désactivée par défaut, activable par projet. */
  async setEnvProtection(projectId: string, protectEnvFiles: boolean, actor: Actor): Promise<void> {
    const row = await this.#store.prisma.project.findUnique({ where: { id: projectId } });
    if (!row) throw new DomainError("not_found", "Projet introuvable");
    await this.#store.append([
      domainEvent(
        "project",
        projectId,
        row.version + 1,
        "project.env_protection_changed",
        { protectEnvFiles },
        { actor, clock: this.#clock },
      ),
    ]);
  }

  async isEnvProtected(projectId: string): Promise<boolean> {
    const row = await this.#store.prisma.project.findUnique({
      where: { id: projectId },
      select: { protectEnvFiles: true },
    });
    if (!row) throw new DomainError("not_found", "Projet introuvable");
    return row.protectEnvFiles;
  }
}
