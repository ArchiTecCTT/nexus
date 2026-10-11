-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_agent_profiles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "providerAccountId" TEXT,
    "permissionMode" TEXT NOT NULL,
    "authMode" TEXT NOT NULL DEFAULT 'vendor-login',
    "capabilitiesJson" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    CONSTRAINT "agent_profiles_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_agent_profiles" ("capabilitiesJson", "connectorId", "createdAt", "displayName", "id", "permissionMode", "providerAccountId", "role", "teamId", "updatedAt", "version") SELECT "capabilitiesJson", "connectorId", "createdAt", "displayName", "id", "permissionMode", "providerAccountId", "role", "teamId", "updatedAt", "version" FROM "agent_profiles";
DROP TABLE "agent_profiles";
ALTER TABLE "new_agent_profiles" RENAME TO "agent_profiles";
CREATE TABLE "new_tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "missionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "assignedAgentId" TEXT,
    "allowedPathsJson" TEXT NOT NULL,
    "acceptanceJson" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 2,
    "lastFailureCode" TEXT,
    "planKey" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    CONSTRAINT "tasks_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "missions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_tasks" ("acceptanceJson", "allowedPathsJson", "assignedAgentId", "attempt", "createdAt", "description", "id", "missionId", "status", "title", "updatedAt", "version") SELECT "acceptanceJson", "allowedPathsJson", "assignedAgentId", "attempt", "createdAt", "description", "id", "missionId", "status", "title", "updatedAt", "version" FROM "tasks";
DROP TABLE "tasks";
ALTER TABLE "new_tasks" RENAME TO "tasks";
CREATE INDEX "tasks_missionId_status_idx" ON "tasks"("missionId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

