// Processus enfant pour le test de crash : écrit des événements + projections en boucle jusqu'à être tué.
import { randomUUID } from "node:crypto";
import { EventStore } from "../../src/index.ts";
import { projectsProjector } from "./projects-projector.ts";

const [filePath] = process.argv.slice(2);
const store = await EventStore.open({ filePath: filePath!, projectors: [projectsProjector] });
const ids = Array.from({ length: 4 }, () => randomUUID());
const versions = new Map(ids.map((id) => [id, 0]));
process.stdout.write("READY\n");
for (let i = 0; ; i++) {
  const id = ids[i % ids.length]!;
  const v = versions.get(id)! + 1;
  // Lot de 3 événements sur le même agrégat : doit être tout ou rien.
  await store.append(
    [0, 1, 2].map((k) => ({
      eventId: randomUUID(),
      aggregateType: "project" as const,
      aggregateId: id,
      aggregateVersion: v + k,
      eventType: "project.renamed",
      payloadSchemaVersion: 1,
      payload: { name: `n${i}-${k}`, rootPath: `/tmp/${id}` },
      occurredAt: new Date().toISOString(),
      correlationId: randomUUID(),
      actorType: "system" as const,
      actorId: "crash-writer",
    })),
  );
  versions.set(id, v + 2);
}
