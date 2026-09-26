-- Preserve any existing design references while moving from URL naming to storage-key naming.
ALTER TABLE "Design" RENAME COLUMN "imageUrl" TO "storageKey";

ALTER TABLE "Design"
ADD COLUMN "previewKey" TEXT,
ADD COLUMN "mimeType" TEXT NOT NULL DEFAULT 'application/octet-stream',
ADD COLUMN "originalName" TEXT,
ADD COLUMN "fileSize" INTEGER;

CREATE UNIQUE INDEX "Design_storageKey_key" ON "Design"("storageKey");
