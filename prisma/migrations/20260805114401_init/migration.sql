-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "BilagStatus" AS ENUM ('MANGLER_BELOEB', 'BOGFOERT', 'IGNORERET');

-- CreateTable
CREATE TABLE "BusinessArea" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "type" "TransactionType" NOT NULL,
    "description" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "categoryId" TEXT,
    "businessAreaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bilag" (
    "id" TEXT NOT NULL,
    "emailMessageId" TEXT NOT NULL,
    "emailThreadId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "senderEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "attachmentNames" TEXT NOT NULL,
    "snippet" TEXT,
    "guessedVendor" TEXT,
    "guessedAmount" DOUBLE PRECISION,
    "status" "BilagStatus" NOT NULL DEFAULT 'MANGLER_BELOEB',
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bilag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessArea_name_key" ON "BusinessArea"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_type_key" ON "Category"("name", "type");

-- CreateIndex
CREATE INDEX "Transaction_date_idx" ON "Transaction"("date");

-- CreateIndex
CREATE INDEX "Transaction_categoryId_idx" ON "Transaction"("categoryId");

-- CreateIndex
CREATE INDEX "Transaction_businessAreaId_idx" ON "Transaction"("businessAreaId");

-- CreateIndex
CREATE UNIQUE INDEX "Bilag_emailMessageId_key" ON "Bilag"("emailMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "Bilag_transactionId_key" ON "Bilag"("transactionId");

-- CreateIndex
CREATE INDEX "Bilag_status_idx" ON "Bilag"("status");

-- CreateIndex
CREATE INDEX "Bilag_receivedAt_idx" ON "Bilag"("receivedAt");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_businessAreaId_fkey" FOREIGN KEY ("businessAreaId") REFERENCES "BusinessArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bilag" ADD CONSTRAINT "Bilag_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
