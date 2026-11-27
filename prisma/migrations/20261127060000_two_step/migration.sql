-- Two-step sign-in (authenticator app) for White Oak admins and staff, optional for everyone else.
ALTER TABLE "User" ADD COLUMN "totpSecret" TEXT;
ALTER TABLE "User" ADD COLUMN "totpEnabledAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "totpLastStep" INTEGER;
ALTER TABLE "User" ADD COLUMN "recoveryCodeHashes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Session" ADD COLUMN "mfaPending" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Session" ADD COLUMN "mfaAttempts" INTEGER NOT NULL DEFAULT 0;
