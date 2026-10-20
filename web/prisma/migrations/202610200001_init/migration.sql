-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "lyricsDraft" TEXT NOT NULL DEFAULT '',
    "promptDraft" TEXT NOT NULL DEFAULT '{}',
    "selectedVersionId" TEXT,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GenerationJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "requestParams" TEXT NOT NULL,
    "sourceJobId" TEXT,
    "parentVersionId" TEXT,
    "errorMessage" TEXT,
    "requestId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "GenerationJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobOutput" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "remoteUrl" TEXT,
    "assetPath" TEXT,
    "receivedBytes" INTEGER NOT NULL DEFAULT 0,
    "totalBytes" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    CONSTRAINT "JobOutput_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "GenerationJob" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Version" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "outputId" TEXT,
    "parentVersionId" TEXT,
    "label" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "implementation" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "paramsSnapshot" TEXT NOT NULL,
    "assetPath" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "durationSec" REAL NOT NULL,
    "sampleRate" INTEGER NOT NULL,
    "channels" INTEGER NOT NULL,
    "peaks" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Version_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Version_outputId_fkey" FOREIGN KEY ("outputId") REFERENCES "JobOutput" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkerState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner" TEXT NOT NULL,
    "heartbeatAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "GenerationJob_status_createdAt_idx" ON "GenerationJob"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobOutput_jobId_index_key" ON "JobOutput"("jobId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "Version_outputId_key" ON "Version"("outputId");

-- CreateIndex
CREATE UNIQUE INDEX "Version_assetPath_key" ON "Version"("assetPath");

-- CreateIndex
CREATE INDEX "Version_projectId_createdAt_idx" ON "Version"("projectId", "createdAt");
