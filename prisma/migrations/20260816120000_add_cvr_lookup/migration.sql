-- CreateTable
CREATE TABLE "CvrLookup" (
    "id" TEXT NOT NULL,
    "cvr" TEXT NOT NULL,
    "name" TEXT,
    "lookedUpAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CvrLookup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CvrLookup_cvr_key" ON "CvrLookup"("cvr");
