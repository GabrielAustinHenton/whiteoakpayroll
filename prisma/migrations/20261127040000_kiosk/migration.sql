-- CreateTable
CREATE TABLE "Kiosk" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationId" TEXT,
    "checkLocation" BOOLEAN NOT NULL DEFAULT false,
    "setupCodeHash" TEXT,
    "setupExpiresAt" TIMESTAMP(3),
    "deviceTokenHash" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Kiosk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KioskPin" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "failedTries" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KioskPin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Kiosk_setupCodeHash_key" ON "Kiosk"("setupCodeHash");

-- CreateIndex
CREATE UNIQUE INDEX "Kiosk_deviceTokenHash_key" ON "Kiosk"("deviceTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "KioskPin_employeeId_key" ON "KioskPin"("employeeId");

-- AddForeignKey
ALTER TABLE "Kiosk" ADD CONSTRAINT "Kiosk_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Kiosk" ADD CONSTRAINT "Kiosk_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WorkLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskPin" ADD CONSTRAINT "KioskPin_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

