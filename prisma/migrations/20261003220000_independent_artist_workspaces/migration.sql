BEGIN;

-- Each existing user ID already owns its own artist-scoped records. Retire only
-- the installation-wide singleton restriction; preserve all accounts and data.
ALTER TABLE "user" DROP CONSTRAINT "user_ownerSlot_singleton";
DROP INDEX "user_ownerSlot_key";
ALTER TABLE "user" DROP COLUMN "ownerSlot";

COMMIT;
