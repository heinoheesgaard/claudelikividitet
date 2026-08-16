-- AlterTable
ALTER TABLE "Bilag" ADD COLUMN "guessedCvr" TEXT;

-- CreateIndex
CREATE INDEX "Bilag_guessedCvr_idx" ON "Bilag"("guessedCvr");

-- AlterTable
ALTER TABLE "CvrLookup" ADD COLUMN "alias" TEXT;
