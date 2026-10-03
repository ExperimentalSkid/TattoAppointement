BEGIN;

-- Google connection status is visible in Settings on every device. OAuth token
-- rotation and password metadata must not trigger unrelated workspace refreshes.
CREATE FUNCTION tinta_google_connection_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  previous_artist TEXT;
  next_artist TEXT;
BEGIN
  IF TG_OP = 'UPDATE'
    AND ROW(NEW."userId", NEW."providerId") IS NOT DISTINCT FROM ROW(OLD."userId", OLD."providerId") THEN
    RETURN NULL;
  END IF;

  IF TG_OP <> 'INSERT' AND OLD."providerId" = 'google' THEN
    previous_artist := OLD."userId";
    PERFORM tinta_bump_workspace_revision(previous_artist);
  END IF;

  IF TG_OP <> 'DELETE' AND NEW."providerId" = 'google' THEN
    next_artist := NEW."userId";
    IF next_artist IS DISTINCT FROM previous_artist THEN
      PERFORM tinta_bump_workspace_revision(next_artist);
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER "account_google_connection_changed"
AFTER INSERT OR UPDATE OR DELETE ON "account"
FOR EACH ROW EXECUTE FUNCTION tinta_google_connection_changed();

COMMIT;
