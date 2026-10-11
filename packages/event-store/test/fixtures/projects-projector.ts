// Projecteur de test : matérialise les projets ; `version` doit toujours égaler la dernière version d'événement.
import type { Projector } from "../../src/index.ts";

export const projectsProjector: Projector = {
  name: "projects",
  async apply(tx, e) {
    if (e.aggregateType !== "project") return;
    const p = e.payload as { name?: string; rootPath?: string; fail?: boolean };
    if (p.fail) throw new Error("projection failure requested by test");
    await tx.project.upsert({
      where: { id: e.aggregateId },
      create: {
        id: e.aggregateId,
        name: p.name ?? "p",
        rootPath: p.rootPath ?? `/tmp/${e.aggregateId}`,
        isGitRepository: false,
        createdAt: e.occurredAt,
        updatedAt: e.occurredAt,
        version: e.aggregateVersion,
      },
      update: { ...(p.name && { name: p.name }), updatedAt: e.occurredAt, version: e.aggregateVersion },
    });
  },
  async reset(tx) {
    await tx.project.deleteMany({});
  },
};
