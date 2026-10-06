BEGIN;

CREATE TABLE "WorkspaceRevision" (
    "artistId" TEXT NOT NULL,
    "revision" BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT "WorkspaceRevision_pkey" PRIMARY KEY ("artistId"),
    CONSTRAINT "WorkspaceRevision_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- The row lock taken by UPSERT serializes simultaneous changes. This executes
-- in the original mutation's transaction, so rollbacks cannot publish a change.
CREATE FUNCTION tinta_bump_workspace_revision(artist_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  -- A deleted artist is absent during cascading child deletes. Do not recreate
  -- its revision row or let a cascade fail its foreign-key constraint.
  INSERT INTO "WorkspaceRevision" ("artistId", "revision")
  SELECT "id", 1 FROM "user" WHERE "id" = artist_id
  ON CONFLICT ("artistId") DO UPDATE
    SET "revision" = "WorkspaceRevision"."revision" + 1;
END;
$$;

CREATE FUNCTION tinta_owned_record_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM tinta_bump_workspace_revision(OLD."artistId");
  ELSIF TG_OP = 'INSERT' THEN
    PERFORM tinta_bump_workspace_revision(NEW."artistId");
  ELSIF NEW IS DISTINCT FROM OLD THEN
    IF OLD."artistId" IS DISTINCT FROM NEW."artistId" THEN
      PERFORM tinta_bump_workspace_revision(OLD."artistId");
    END IF;
    PERFORM tinta_bump_workspace_revision(NEW."artistId");
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "Client_workspace_changed"
AFTER INSERT OR UPDATE OR DELETE ON "Client"
FOR EACH ROW EXECUTE FUNCTION tinta_owned_record_changed();

CREATE TRIGGER "Design_workspace_changed"
AFTER INSERT OR UPDATE OR DELETE ON "Design"
FOR EACH ROW EXECUTE FUNCTION tinta_owned_record_changed();

CREATE TRIGGER "Appointment_workspace_changed"
AFTER INSERT OR UPDATE OR DELETE ON "Appointment"
FOR EACH ROW EXECUTE FUNCTION tinta_owned_record_changed();

CREATE TRIGGER "Payment_workspace_changed"
AFTER INSERT OR UPDATE OR DELETE ON "Payment"
FOR EACH ROW EXECUTE FUNCTION tinta_owned_record_changed();

CREATE FUNCTION tinta_appointment_design_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  previous_artist TEXT;
  next_artist TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NULL;
  END IF;

  IF TG_OP <> 'INSERT' THEN
    SELECT "artistId" INTO previous_artist
    FROM "Appointment" WHERE "id" = OLD."appointmentId";
    PERFORM tinta_bump_workspace_revision(previous_artist);
  END IF;

  IF TG_OP <> 'DELETE' THEN
    SELECT "artistId" INTO next_artist
    FROM "Appointment" WHERE "id" = NEW."appointmentId";
    IF next_artist IS DISTINCT FROM previous_artist THEN
      PERFORM tinta_bump_workspace_revision(next_artist);
    END IF;
  END IF;

  -- When the parent appointment has been deleted, its own trigger already
  -- invalidates the workspace even though this lookup has no remaining row.
  RETURN NULL;
END;
$$;

CREATE TRIGGER "AppointmentDesign_workspace_changed"
AFTER INSERT OR UPDATE OR DELETE ON "AppointmentDesign"
FOR EACH ROW EXECUTE FUNCTION tinta_appointment_design_changed();

CREATE FUNCTION tinta_artist_workspace_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "WorkspaceRevision" ("artistId", "revision")
    VALUES (NEW."id", 0)
    ON CONFLICT ("artistId") DO NOTHING;
  ELSIF ROW(NEW."name", NEW."studioName", NEW."whatsappReminderTemplate", NEW."language")
    IS DISTINCT FROM ROW(OLD."name", OLD."studioName", OLD."whatsappReminderTemplate", OLD."language") THEN
    PERFORM tinta_bump_workspace_revision(NEW."id");
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "user_workspace_changed"
AFTER INSERT OR UPDATE ON "user"
FOR EACH ROW EXECUTE FUNCTION tinta_artist_workspace_changed();

INSERT INTO "WorkspaceRevision" ("artistId", "revision")
SELECT "id", 0 FROM "user";

COMMIT;
