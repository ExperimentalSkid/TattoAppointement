-- Existing workspaces keep access at their original creation time. The auth
-- create hook explicitly overrides this default with NULL for pending signups.
ALTER TABLE "user" ADD COLUMN "activatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
                   ADD COLUMN "lastSignInAt" TIMESTAMP(3);
UPDATE "user" SET "activatedAt" = "createdAt";

CREATE TABLE "beta_invitation" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "redeemedAt" TIMESTAMP(3),
    "redeemedById" TEXT,
    CONSTRAINT "beta_invitation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "beta_invitation_codeHash_check" CHECK ("codeHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "beta_invitation_expiry_check" CHECK ("expiresAt" > "createdAt"),
    CONSTRAINT "beta_invitation_state_check" CHECK ("revokedAt" IS NULL OR "redeemedAt" IS NULL),
    CONSTRAINT "beta_invitation_redeemer_check" CHECK ("redeemedById" IS NULL OR "redeemedAt" IS NOT NULL)
);
CREATE UNIQUE INDEX "beta_invitation_codeHash_key" ON "beta_invitation"("codeHash");
CREATE INDEX "beta_invitation_createdAt_idx" ON "beta_invitation"("createdAt");
CREATE INDEX "beta_invitation_createdById_idx" ON "beta_invitation"("createdById");
CREATE INDEX "beta_invitation_redeemedById_idx" ON "beta_invitation"("redeemedById");
ALTER TABLE "beta_invitation" ADD CONSTRAINT "beta_invitation_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "beta_invitation" ADD CONSTRAINT "beta_invitation_redeemedById_fkey"
    FOREIGN KEY ("redeemedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One bounded account-level counter; no IP or device data. Account erasure
-- cascades this counter and removes personal links from invitation audit rows.
CREATE TABLE "invitation_attempt_window" (
    "userId" TEXT NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL,
    CONSTRAINT "invitation_attempt_window_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "invitation_attempt_window_attempts_check" CHECK ("attempts" BETWEEN 1 AND 5)
);
ALTER TABLE "invitation_attempt_window" ADD CONSTRAINT "invitation_attempt_window_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
