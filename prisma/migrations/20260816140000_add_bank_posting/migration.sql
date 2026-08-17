-- CreateEnum
CREATE TYPE "BankPostingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'NO_BILAG_NEEDED');

-- CreateTable
CREATE TABLE "BankPosting" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "text" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "BankPostingStatus" NOT NULL DEFAULT 'PENDING',
    "matchedBilagId" TEXT,
    "rejectedBilagIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankPosting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankPosting_matchedBilagId_key" ON "BankPosting"("matchedBilagId");

-- CreateIndex
CREATE INDEX "BankPosting_status_idx" ON "BankPosting"("status");

-- CreateIndex
CREATE INDEX "BankPosting_date_idx" ON "BankPosting"("date");

-- CreateIndex
CREATE UNIQUE INDEX "BankPosting_date_text_amount_key" ON "BankPosting"("date", "text", "amount");

-- AddForeignKey
ALTER TABLE "BankPosting" ADD CONSTRAINT "BankPosting_matchedBilagId_fkey" FOREIGN KEY ("matchedBilagId") REFERENCES "Bilag"("id") ON DELETE SET NULL ON UPDATE CASCADE;
