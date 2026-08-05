-- CreateTable
CREATE TABLE "BilagAttachment" (
    "id" TEXT NOT NULL,
    "bilagId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BilagAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BilagAttachment_bilagId_idx" ON "BilagAttachment"("bilagId");

-- AddForeignKey
ALTER TABLE "BilagAttachment" ADD CONSTRAINT "BilagAttachment_bilagId_fkey" FOREIGN KEY ("bilagId") REFERENCES "Bilag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
