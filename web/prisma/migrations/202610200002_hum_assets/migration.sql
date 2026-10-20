-- CreateTable
CREATE TABLE "HumAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "originalPath" TEXT NOT NULL,
    "originalSha256" TEXT NOT NULL,
    "originalMimeType" TEXT NOT NULL,
    "originalDurationSec" REAL NOT NULL,
    "assetPath" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "durationSec" REAL NOT NULL,
    "sampleRate" INTEGER NOT NULL,
    "channels" INTEGER NOT NULL,
    "peaks" TEXT NOT NULL,
    "analysisJson" TEXT NOT NULL,
    "processingJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HumAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "HumAsset_assetPath_key" ON "HumAsset"("assetPath");

-- CreateIndex
CREATE INDEX "HumAsset_projectId_createdAt_idx" ON "HumAsset"("projectId", "createdAt");
