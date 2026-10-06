ALTER TABLE "user"
  ADD COLUMN "diagnosticsConsent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "diagnosticsConsentUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "diagnosticsConsentNoticeVersion" TEXT,
  ADD COLUMN "diagnosticsPurgeRequestedAt" TIMESTAMP(3),
  ADD COLUMN "deletionRequestedAt" TIMESTAMP(3);

CREATE INDEX "user_deletionRequestedAt_idx" ON "user"("deletionRequestedAt") WHERE "deletionRequestedAt" IS NOT NULL;
