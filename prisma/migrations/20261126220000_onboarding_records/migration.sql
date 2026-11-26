-- Encrypted SSNs and onboarding form history (W-4, state certificates, I-9 dates).

ALTER TABLE "Employee" ALTER COLUMN "ssn" DROP NOT NULL;
ALTER TABLE "Employee" ADD COLUMN "ssnEncrypted" TEXT;
ALTER TABLE "Employee" ADD COLUMN "ssnLast4" TEXT;
ALTER TABLE "Employee" ADD COLUMN "offerAcceptedAt" TIMESTAMP(3);

CREATE TABLE "W4Certificate" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "formYear" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "exempt" BOOLEAN NOT NULL DEFAULT false,
    "exemptExpiresOn" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "enteredById" TEXT,
    "signedName" TEXT,
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),
    CONSTRAINT "W4Certificate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StateWithholdingCertificate" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "formName" TEXT NOT NULL,
    "formRevision" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "enteredById" TEXT,
    "signedName" TEXT,
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),
    "sentToStateAt" TIMESTAMP(3),
    CONSTRAINT "StateWithholdingCertificate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "I9Record" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "edition" TEXT NOT NULL DEFAULT '01/20/25',
    "firstDayOfEmployment" TIMESTAMP(3) NOT NULL,
    "section1CompletedAt" TIMESTAMP(3),
    "section2DueOn" TIMESTAMP(3) NOT NULL,
    "section2CompletedAt" TIMESTAMP(3),
    "section2ById" TEXT,
    "reverifyBy" TIMESTAMP(3),
    "retainUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "I9Record_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "W4Certificate_employeeId_createdAt_idx" ON "W4Certificate"("employeeId", "createdAt");
CREATE INDEX "StateWithholdingCertificate_employeeId_state_createdAt_idx" ON "StateWithholdingCertificate"("employeeId", "state", "createdAt");
CREATE UNIQUE INDEX "I9Record_employeeId_key" ON "I9Record"("employeeId");

ALTER TABLE "W4Certificate" ADD CONSTRAINT "W4Certificate_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StateWithholdingCertificate" ADD CONSTRAINT "StateWithholdingCertificate_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "I9Record" ADD CONSTRAINT "I9Record_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
