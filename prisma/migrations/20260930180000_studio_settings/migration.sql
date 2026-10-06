-- Existing language preferences are preserved; new artists default to Spanish.
ALTER TABLE "user" ADD COLUMN "studioName" TEXT;
ALTER TABLE "user" ALTER COLUMN "language" SET DEFAULT 'es';
