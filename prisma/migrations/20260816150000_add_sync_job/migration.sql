-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "pageToken" TEXT,
    "totalCreated" INTEGER NOT NULL DEFAULT 0,
    "totalProcessed" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncJob_active_idx" ON "SyncJob"("active");
