-- CreateTable
CREATE TABLE "events" (
    "globalSequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "eventId" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "aggregateVersion" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadSchemaVersion" INTEGER NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "occurredAt" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "causationId" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "recordedAt" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "rootPath" TEXT NOT NULL,
    "isGitRepository" BOOLEAN NOT NULL,
    "protectEnvFiles" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    "version" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "governanceMode" TEXT NOT NULL,
    "supervisorId" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    CONSTRAINT "teams_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "agent_profiles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "providerAccountId" TEXT,
    "permissionMode" TEXT NOT NULL,
    "capabilitiesJson" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    CONSTRAINT "agent_profiles_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "provider_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "authMode" TEXT NOT NULL,
    "secretRef" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "missions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    CONSTRAINT "missions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "missionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "assignedAgentId" TEXT,
    "allowedPathsJson" TEXT NOT NULL,
    "acceptanceJson" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    CONSTRAINT "tasks_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "missions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "task_dependencies" (
    "taskId" TEXT NOT NULL,
    "dependsOnId" TEXT NOT NULL,

    PRIMARY KEY ("taskId", "dependsOnId")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "connectorVersion" TEXT,
    "nativeSessionId" TEXT,
    "pid" INTEGER,
    "runnerInstanceId" TEXT,
    "status" TEXT NOT NULL,
    "startedAt" TEXT NOT NULL,
    "endedAt" TEXT,
    "lastSequence" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "missionId" TEXT NOT NULL,
    "taskId" TEXT,
    "senderAgentId" TEXT NOT NULL,
    "recipientAgentId" TEXT,
    "type" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "payloadRef" TEXT,
    "correlationId" TEXT NOT NULL,
    "inReplyTo" TEXT,
    "timestamp" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "artifacts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "missionId" TEXT NOT NULL,
    "taskId" TEXT,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "mediaType" TEXT NOT NULL,
    "contentRef" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "publishedBy" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT,
    "summary" TEXT NOT NULL,
    "planFingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requestedAt" TEXT NOT NULL,
    "expiresAt" TEXT NOT NULL,
    "decidedAt" TEXT
);

-- CreateTable
CREATE TABLE "worktrees" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "baseRef" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "removedAt" TEXT
);

-- CreateTable
CREATE TABLE "decisions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "version" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "memory_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "version" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "usage_snapshots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectorId" TEXT NOT NULL,
    "accountId" TEXT,
    "observedAt" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "remaining" REAL,
    "consumed" REAL,
    "unit" TEXT,
    "windowEnd" TEXT,
    "caveat" TEXT
);

-- CreateTable
CREATE TABLE "deployment_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "url" TEXT,
    "approvalId" TEXT,
    "logRef" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "voice_transcripts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "editedText" TEXT,
    "sentAt" TEXT,
    "audioKept" BOOLEAN NOT NULL,
    "createdAt" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "permission_policies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "rulesJson" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "events_eventId_key" ON "events"("eventId");

-- CreateIndex
CREATE INDEX "events_aggregateType_aggregateId_idx" ON "events"("aggregateType", "aggregateId");

-- CreateIndex
CREATE INDEX "events_correlationId_idx" ON "events"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "events_aggregateId_aggregateVersion_key" ON "events"("aggregateId", "aggregateVersion");

-- CreateIndex
CREATE UNIQUE INDEX "projects_rootPath_key" ON "projects"("rootPath");

-- CreateIndex
CREATE UNIQUE INDEX "teams_projectId_name_key" ON "teams"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "provider_accounts_providerId_label_key" ON "provider_accounts"("providerId", "label");

-- CreateIndex
CREATE INDEX "missions_projectId_idx" ON "missions"("projectId");

-- CreateIndex
CREATE INDEX "tasks_missionId_status_idx" ON "tasks"("missionId", "status");

-- CreateIndex
CREATE INDEX "sessions_projectId_idx" ON "sessions"("projectId");

-- CreateIndex
CREATE INDEX "agent_runs_taskId_idx" ON "agent_runs"("taskId");

-- CreateIndex
CREATE INDEX "agent_runs_status_idx" ON "agent_runs"("status");

-- CreateIndex
CREATE INDEX "messages_missionId_timestamp_idx" ON "messages"("missionId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "artifacts_missionId_name_version_key" ON "artifacts"("missionId", "name", "version");

-- CreateIndex
CREATE INDEX "approvals_status_idx" ON "approvals"("status");

-- CreateIndex
CREATE UNIQUE INDEX "worktrees_taskId_key" ON "worktrees"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "worktrees_path_key" ON "worktrees"("path");

-- CreateIndex
CREATE INDEX "memory_entries_projectId_kind_idx" ON "memory_entries"("projectId", "kind");

-- CreateIndex
CREATE INDEX "usage_snapshots_connectorId_observedAt_idx" ON "usage_snapshots"("connectorId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "permission_policies_name_key" ON "permission_policies"("name");


-- Ajout manuel (non généré par Prisma) : le journal est en ajout seul au niveau du moteur SQLite,
-- y compris face à un bug applicatif ou à une requête brute (cahier maître ADR-004, §11).
CREATE TRIGGER "events_no_update" BEFORE UPDATE ON "events"
BEGIN
    SELECT RAISE(ABORT, 'events table is append-only');
END;

CREATE TRIGGER "events_no_delete" BEFORE DELETE ON "events"
BEGIN
    SELECT RAISE(ABORT, 'events table is append-only');
END;
