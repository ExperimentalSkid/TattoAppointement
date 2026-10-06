CREATE OR REPLACE FUNCTION tinta_artist_workspace_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "WorkspaceRevision" ("artistId", "revision")
    VALUES (NEW."id", 0) ON CONFLICT ("artistId") DO NOTHING;
  ELSIF ROW(NEW."name", NEW."studioName", NEW."whatsappReminderTemplate", NEW."language", NEW."diagnosticsConsent")
    IS DISTINCT FROM ROW(OLD."name", OLD."studioName", OLD."whatsappReminderTemplate", OLD."language", OLD."diagnosticsConsent") THEN
    PERFORM tinta_bump_workspace_revision(NEW."id");
  END IF;
  RETURN NULL;
END;
$$;
