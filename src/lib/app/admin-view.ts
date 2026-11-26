import { db } from "../db";

const WINDOW_MS = 30 * 60_000;

/** Record that a White Oak admin looked at a client company, at most once per 30 minutes per admin and company. */
export async function logAdminView(actorId: string, companyId: string) {
  const recent = await db.auditLog.findFirst({
    where: { actorId, companyId, action: "admin.viewed", createdAt: { gte: new Date(Date.now() - WINDOW_MS) } },
    select: { id: true },
  });
  if (!recent) await db.auditLog.create({ data: { actorId, companyId, action: "admin.viewed" } });
}
