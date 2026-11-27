"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { validFix } from "@/lib/time/geofence";
import { punch, type PunchKind, type PunchResult } from "@/lib/time/service";

const KINDS: PunchKind[] = ["in", "out", "break_start", "break_end"];

/** Punch from the employee's own phone. Called from the clock page with the browser's location fix. */
export async function punchFromPhone(kind: string, fix: unknown, photo: string | null, breakKind?: string): Promise<PunchResult> {
  const user = await requireUser();
  const e = await db.employee.findUnique({ where: { userId: user.id } });
  if (!e) return { ok: false, error: "Your login isn't linked to an employee." };
  if (!KINDS.includes(kind as PunchKind)) return { ok: false, error: "Unknown punch." };
  const h = await headers();
  const result = await punch(
    {
      employeeId: e.id,
      kind: kind as PunchKind,
      fix: validFix(fix) ? fix : null,
      photo,
      breakKind,
      source: "PHONE",
      device: { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, userAgent: h.get("user-agent") },
    },
    user.id,
  );
  revalidatePath("/me/clock");
  return result;
}

/** The employee read the location notice (kept in the audit log as their acknowledgment). */
export async function acknowledgeLocationNotice(): Promise<void> {
  const user = await requireUser();
  const e = await db.employee.findUnique({ where: { userId: user.id } });
  if (!e) return;
  await db.auditLog.create({ data: { actorId: user.id, companyId: e.companyId, action: "time.location_notice_ack", detail: { employeeId: e.id } } });
  revalidatePath("/me/clock");
}
