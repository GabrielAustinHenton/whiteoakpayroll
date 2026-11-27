-- Requests to join as White Oak payroll staff, approved or denied by an admin.
-- Written to be safe to run again: preview deploys share the production database.

DO $$ BEGIN
  CREATE TYPE "StaffRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'REMOVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "staffStatus" "StaffRequestStatus";
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "staffRequestedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "staffRequestNote" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "staffDecidedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "staffDecidedById" TEXT;

-- Payroll bureaus: staff only see their own bureau's companies.
CREATE TABLE IF NOT EXISTS "Bureau" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Bureau_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Bureau_name_key" ON "Bureau"("name");

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bureauId" TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "bureauId" TEXT;

DO $$ BEGIN
  ALTER TABLE "User" ADD CONSTRAINT "User_bureauId_fkey" FOREIGN KEY ("bureauId") REFERENCES "Bureau"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "Company" ADD CONSTRAINT "Company_bureauId_fkey" FOREIGN KEY ("bureauId") REFERENCES "Bureau"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
