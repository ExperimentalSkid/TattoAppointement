-- Pausing access preserves invitation membership, sessions and saved records.
-- Existing accounts keep access; NULL is the unpaused state.
ALTER TABLE "user" ADD COLUMN "deactivatedAt" TIMESTAMP(3);
