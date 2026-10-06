BEGIN;
LOCK TABLE "user" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM "user") > 1 THEN
    RAISE EXCEPTION 'This installation contains multiple artist accounts. Back up the database and prepare a separate single-owner installation before applying this migration. No accounts or records have been deleted.';
  END IF;
END $$;

ALTER TABLE "user" ADD COLUMN "ownerSlot" TEXT NOT NULL DEFAULT 'studio-owner';
ALTER TABLE "user" ADD CONSTRAINT "user_ownerSlot_singleton" CHECK ("ownerSlot" = 'studio-owner');
CREATE UNIQUE INDEX "user_ownerSlot_key" ON "user"("ownerSlot");
COMMIT;
