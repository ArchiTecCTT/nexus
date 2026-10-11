// Export / import local d'un projet (FR-025, §11 « Sauvegarde ») : archive versionnée contenant le journal
// d'événements du projet (déjà expurgé), avec empreinte d'intégrité. Les secrets n'y figurent jamais : ils ne sont pas
// dans la base (coffre séparé) et l'expurgation est réappliquée à l'export. L'import rejoue les événements.
import { createHash } from "node:crypto";
import { DomainEvent } from "@nexus/contracts";
import type { EventStore, PayloadRedactor } from "@nexus/event-store";
import { DomainError } from "./events.ts";

export const ARCHIVE_FORMAT = "nexus-project-archive";
export const ARCHIVE_VERSION = 1;

export type ProjectArchive = {
  format: typeof ARCHIVE_FORMAT;
  version: typeof ARCHIVE_VERSION;
  exportedAt: string;
  projectId: string;
  events: DomainEvent[];
  /** SHA-256 du JSON des événements : toute altération est détectée à l'import. */
  sha256: string;
};

const digest = (events: readonly DomainEvent[]) => createHash("sha256").update(JSON.stringify(events)).digest("hex");

/** Agrégats appartenant au projet : projet, équipes, missions, tâches, runs et approbations liés. */
async function projectAggregateIds(store: EventStore, projectId: string): Promise<Set<string>> {
  const p = store.prisma;
  const ids = new Set<string>([projectId]);
  for (const t of await p.team.findMany({ where: { projectId }, select: { id: true } })) ids.add(t.id);
  const missions = await p.mission.findMany({ where: { projectId }, select: { id: true } });
  for (const m of missions) ids.add(m.id);
  const tasks = await p.task.findMany({
    where: { missionId: { in: missions.map((m) => m.id) } },
    select: { id: true },
  });
  for (const t of tasks) ids.add(t.id);
  for (const r of await p.agentRun.findMany({
    where: { taskId: { in: tasks.map((t) => t.id) } },
    select: { id: true },
  }))
    ids.add(r.id);
  for (const a of await p.approval.findMany({ where: { projectId }, select: { id: true } })) ids.add(a.id);
  return ids;
}

export async function exportProject(
  store: EventStore,
  projectId: string,
  redact: PayloadRedactor,
  now: () => string,
): Promise<ProjectArchive> {
  if (!(await store.prisma.project.findUnique({ where: { id: projectId } })))
    throw new DomainError("not_found", "Projet introuvable");
  const ids = await projectAggregateIds(store, projectId);
  const events: DomainEvent[] = [];
  for (let after = 0; ;) {
    const batch = await store.readFrom(after, 5000);
    if (batch.length === 0) break;
    for (const e of batch) if (ids.has(e.aggregateId)) events.push({ ...e, payload: redact(e.payload) });
    after = batch.at(-1)!.globalSequence;
  }
  return {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    exportedAt: now(),
    projectId,
    events,
    sha256: digest(events),
  };
}

/**
 * Importe une archive dans une base où le projet n'existe pas encore. Vérifie format, version, empreinte et
 * validité de chaque événement, puis rejoue les événements dans l'ordre (projections reconstruites).
 */
export async function importProject(store: EventStore, raw: unknown): Promise<{ projectId: string; events: number }> {
  const a = raw as Partial<ProjectArchive>;
  if (
    a?.format !== ARCHIVE_FORMAT ||
    a.version !== ARCHIVE_VERSION ||
    !Array.isArray(a.events) ||
    typeof a.sha256 !== "string"
  ) {
    throw new DomainError("invalid_request", "Archive invalide ou version non prise en charge");
  }
  if (digest(a.events) !== a.sha256)
    throw new DomainError("invalid_request", "Intégrité de l'archive compromise (empreinte différente)");
  const events = a.events.map((e) => DomainEvent.parse(e)).sort((x, y) => x.globalSequence - y.globalSequence);
  if (await store.prisma.project.findUnique({ where: { id: a.projectId! } }))
    throw new DomainError("conflict", "Ce projet existe déjà dans cette base");
  const clash = await store.prisma.event.findFirst({ where: { eventId: { in: events.map((e) => e.eventId) } } });
  if (clash) throw new DomainError("conflict", "Événements déjà présents dans cette base");
  // Rejeu par lots ; globalSequence est réattribué par la base locale.
  for (let i = 0; i < events.length; i += 200) {
    await store.append(events.slice(i, i + 200).map(({ globalSequence: _g, ...e }) => e));
  }
  return { projectId: a.projectId!, events: events.length };
}
