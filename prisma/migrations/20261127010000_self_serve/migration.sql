-- Self-serve mode alongside the managed (payroll desk) mode.
CREATE TYPE "ServiceMode" AS ENUM ('SELF_SERVE', 'MANAGED');

-- Every company that exists today is run by White Oak staff, so it starts MANAGED; new signups default to SELF_SERVE.
ALTER TABLE "Company" ADD COLUMN "serviceMode" "ServiceMode" NOT NULL DEFAULT 'MANAGED';
ALTER TABLE "Company" ALTER COLUMN "serviceMode" SET DEFAULT 'SELF_SERVE';
ALTER TABLE "Company" ADD COLUMN "features" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Company" ADD COLUMN "setupCompletedAt" TIMESTAMP(3);

ALTER TABLE "Employee" ALTER COLUMN "birthDate" DROP NOT NULL;
ALTER TABLE "Employee" ADD COLUMN "selfOnboardingInvitedAt" TIMESTAMP(3);
ALTER TABLE "Employee" ADD COLUMN "selfOnboardingDoneAt" TIMESTAMP(3);
ALTER TABLE "Employee" ADD COLUMN "i9Section1" JSONB;

CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Reminder_companyId_key_key" ON "Reminder"("companyId", "key");
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
