-- Retirement plans and provider connections: plan setup, employee elections, per-pay-run provider files.
-- CreateTable
CREATE TABLE "RetirementPlan" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "planType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "planNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SETUP',
    "connectionMethod" TEXT NOT NULL DEFAULT 'file_upload',
    "connectedAt" TIMESTAMP(3),
    "allowsRoth" BOOLEAN NOT NULL DEFAULT false,
    "allowsCatchUp" BOOLEAN NOT NULL DEFAULT true,
    "simpleApplicable" BOOLEAN NOT NULL DEFAULT false,
    "employerFormula" JSONB NOT NULL DEFAULT '{"tiers":[],"nonelective":0}',
    "employerPreset" TEXT NOT NULL DEFAULT 'none',
    "autoEnrollRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "eligibilityDays" INTEGER NOT NULL DEFAULT 0,
    "eligibilityMinAge" INTEGER NOT NULL DEFAULT 18,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetirementPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetirementElection" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_ENROLLED',
    "pretaxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rothRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pretaxFlatCents" INTEGER NOT NULL DEFAULT 0,
    "rothFlatCents" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'employer',
    "sentToProvider" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetirementElection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetirementSubmission" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "payRunId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "files" JSONB NOT NULL,
    "employeeCents" INTEGER NOT NULL,
    "employerCents" INTEGER NOT NULL,
    "dueOn" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "sentById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetirementSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RetirementPlan_companyId_idx" ON "RetirementPlan"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "RetirementElection_planId_employeeId_key" ON "RetirementElection"("planId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "RetirementSubmission_planId_payRunId_key" ON "RetirementSubmission"("planId", "payRunId");

-- AddForeignKey
ALTER TABLE "RetirementPlan" ADD CONSTRAINT "RetirementPlan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetirementElection" ADD CONSTRAINT "RetirementElection_planId_fkey" FOREIGN KEY ("planId") REFERENCES "RetirementPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetirementElection" ADD CONSTRAINT "RetirementElection_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetirementSubmission" ADD CONSTRAINT "RetirementSubmission_planId_fkey" FOREIGN KEY ("planId") REFERENCES "RetirementPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetirementSubmission" ADD CONSTRAINT "RetirementSubmission_payRunId_fkey" FOREIGN KEY ("payRunId") REFERENCES "PayRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

