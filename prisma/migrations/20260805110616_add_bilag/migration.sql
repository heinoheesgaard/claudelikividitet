-- CreateTable
CREATE TABLE "Bilag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "emailMessageId" TEXT NOT NULL,
    "emailThreadId" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL,
    "senderEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "attachmentNames" TEXT NOT NULL,
    "snippet" TEXT,
    "guessedVendor" TEXT,
    "guessedAmount" REAL,
    "status" TEXT NOT NULL DEFAULT 'MANGLER_BELOEB',
    "transactionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Bilag_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Bilag_emailMessageId_key" ON "Bilag"("emailMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "Bilag_transactionId_key" ON "Bilag"("transactionId");

-- CreateIndex
CREATE INDEX "Bilag_status_idx" ON "Bilag"("status");

-- CreateIndex
CREATE INDEX "Bilag_receivedAt_idx" ON "Bilag"("receivedAt");
