-- AlterTable
ALTER TABLE "BilagAttachment" ALTER COLUMN "data" DROP NOT NULL;
ALTER TABLE "BilagAttachment" ADD COLUMN "blobPathname" TEXT;
