-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "markupPercent" REAL NOT NULL DEFAULT 85,
    "feedUrl" TEXT NOT NULL DEFAULT '',
    "locationId" TEXT NOT NULL DEFAULT '',
    "outOfStockAction" TEXT NOT NULL DEFAULT 'draft',
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Frame" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "specs" TEXT NOT NULL DEFAULT '{}',
    "images" TEXT NOT NULL DEFAULT '[]',
    "sourcePrice" REAL NOT NULL,
    "sourceStock" INTEGER NOT NULL DEFAULT 0,
    "price" REAL NOT NULL,
    "priceLocked" BOOLEAN NOT NULL DEFAULT false,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "shopifyProductId" TEXT,
    "shopifyVariantId" TEXT,
    "shopifyInventoryItemId" TEXT,
    "shopifyStatus" TEXT,
    "contentHash" TEXT,
    "inSource" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "sku" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SyncLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SyncRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Frame_sku_key" ON "Frame"("sku");

-- CreateIndex
CREATE INDEX "SyncLog_runId_idx" ON "SyncLog"("runId");
