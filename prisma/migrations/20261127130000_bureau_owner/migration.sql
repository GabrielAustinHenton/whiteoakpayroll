-- Bureau owners approve and remove their own bureau's staff. Safe to run again (shared database).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bureauOwner" BOOLEAN NOT NULL DEFAULT false;
