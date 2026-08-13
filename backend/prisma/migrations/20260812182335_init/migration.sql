-- CreateTable
CREATE TABLE "Telecaller" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "callId" TEXT NOT NULL,
    "telecallerId" TEXT NOT NULL,
    "leadName" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "transcript" TEXT NOT NULL,
    "transcriptHash" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'seed',
    "searchText" TEXT NOT NULL,
    "unitConfiguration" TEXT NOT NULL,
    "budgetMinLakhs" REAL,
    "budgetMaxLakhs" REAL,
    "budgetDiscussed" BOOLEAN NOT NULL DEFAULT false,
    "timeline" TEXT NOT NULL,
    "siteVisitOutcome" TEXT NOT NULL,
    "discoveryScore" INTEGER NOT NULL,
    "discoveryReason" TEXT NOT NULL,
    "pitchScore" INTEGER NOT NULL,
    "pitchReason" TEXT NOT NULL,
    "objectionHandlingScore" INTEGER NOT NULL,
    "objectionHandlingReason" TEXT NOT NULL,
    "nextStepScore" INTEGER NOT NULL,
    "nextStepReason" TEXT NOT NULL,
    "overallScore" REAL NOT NULL,
    "lastStageReached" TEXT NOT NULL,
    "recommendedNextAction" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" REAL NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "validationStatus" TEXT NOT NULL DEFAULT 'valid',
    "repairNotes" TEXT,
    "warnings" TEXT,
    "analyzedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Call_telecallerId_fkey" FOREIGN KEY ("telecallerId") REFERENCES "Telecaller" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PreferredLocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "callId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "PreferredLocation_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnalysisCache" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "transcriptHash" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "analysisJson" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" REAL NOT NULL DEFAULT 0,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHitAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "Telecaller_name_key" ON "Telecaller"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Call_callId_key" ON "Call"("callId");

-- CreateIndex
CREATE INDEX "Call_telecallerId_idx" ON "Call"("telecallerId");

-- CreateIndex
CREATE INDEX "Call_searchText_idx" ON "Call"("searchText");

-- CreateIndex
CREATE INDEX "Call_lastStageReached_idx" ON "Call"("lastStageReached");

-- CreateIndex
CREATE INDEX "Call_overallScore_idx" ON "Call"("overallScore");

-- CreateIndex
CREATE INDEX "Call_occurredAt_idx" ON "Call"("occurredAt");

-- CreateIndex
CREATE INDEX "Call_transcriptHash_idx" ON "Call"("transcriptHash");

-- CreateIndex
CREATE INDEX "Call_validationStatus_idx" ON "Call"("validationStatus");

-- CreateIndex
CREATE INDEX "PreferredLocation_name_idx" ON "PreferredLocation"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PreferredLocation_callId_name_key" ON "PreferredLocation"("callId", "name");

-- CreateIndex
CREATE INDEX "AnalysisCache_transcriptHash_idx" ON "AnalysisCache"("transcriptHash");
