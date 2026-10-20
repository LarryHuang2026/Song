ALTER TABLE "GenerationJob" ADD COLUMN "providerSourceId" TEXT;
ALTER TABLE "GenerationJob" ADD COLUMN "providerTaskId" TEXT;
ALTER TABLE "GenerationJob" ADD COLUMN "nextPollAt" DATETIME;
ALTER TABLE "GenerationJob" ADD COLUMN "pollStartedAt" DATETIME;
ALTER TABLE "GenerationJob" ADD COLUMN "pollFailures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "JobOutput" ADD COLUMN "providerSongId" TEXT;
ALTER TABLE "JobOutput" ADD COLUMN "rawAssetPath" TEXT;
ALTER TABLE "JobOutput" ADD COLUMN "rawMimeType" TEXT;
