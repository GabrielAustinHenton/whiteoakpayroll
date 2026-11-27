-- CreateEnum
CREATE TYPE "GeofenceMode" AS ENUM ('BLOCK', 'FLAG', 'OFF');

-- CreateEnum
CREATE TYPE "PunchSource" AS ENUM ('PHONE', 'KIOSK', 'MANAGER');

-- CreateTable
CREATE TABLE "TimeSettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "geofenceMode" "GeofenceMode" NOT NULL DEFAULT 'BLOCK',
    "maxAccuracyMeters" INTEGER NOT NULL DEFAULT 100,
    "requirePhoto" BOOLEAN NOT NULL DEFAULT false,
    "timeZone" TEXT NOT NULL DEFAULT 'America/New_York',
    "weekStartsOn" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkLocation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radiusMeters" INTEGER NOT NULL DEFAULT 150,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "locationId" TEXT,
    "clockInAt" TIMESTAMP(3) NOT NULL,
    "clockOutAt" TIMESTAMP(3),
    "source" "PunchSource" NOT NULL DEFAULT 'PHONE',
    "inPunch" JSONB NOT NULL,
    "outPunch" JSONB,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "inPhoto" BYTEA,
    "outPhoto" BYTEA,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeBreak" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'MEAL',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "startPunch" JSONB,
    "endPunch" JSONB,

    CONSTRAINT "TimeBreak_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TimeSettings_companyId_key" ON "TimeSettings"("companyId");

-- CreateIndex
CREATE INDEX "WorkLocation_companyId_idx" ON "WorkLocation"("companyId");

-- CreateIndex
CREATE INDEX "TimeEntry_companyId_clockInAt_idx" ON "TimeEntry"("companyId", "clockInAt");

-- CreateIndex
CREATE INDEX "TimeEntry_employeeId_clockInAt_idx" ON "TimeEntry"("employeeId", "clockInAt");

-- AddForeignKey
ALTER TABLE "TimeSettings" ADD CONSTRAINT "TimeSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkLocation" ADD CONSTRAINT "WorkLocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WorkLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeBreak" ADD CONSTRAINT "TimeBreak_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "TimeEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

