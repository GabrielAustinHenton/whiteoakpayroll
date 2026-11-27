-- The company Activity page lists a company's audit log newest first.
CREATE INDEX "AuditLog_companyId_createdAt_idx" ON "AuditLog"("companyId", "createdAt");
