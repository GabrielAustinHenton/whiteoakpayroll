-- Emailed portal and teammate invites.
ALTER TABLE "User" ADD COLUMN "inviteTokenHash" TEXT;
ALTER TABLE "User" ADD COLUMN "inviteExpiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "invitedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_inviteTokenHash_key" ON "User"("inviteTokenHash");
