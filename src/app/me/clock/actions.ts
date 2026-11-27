"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { validFix } from "@/lib/time/geofence";
import { punch, timeSettings, type PunchKind, type PunchResult } from "@/lib/time/service";
import { shiftTimes } from "@/lib/time/timesheets";

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

/** Ask a manager to fix a missed punch: a forgotten punch out on an open shift, or a whole missed shift. */
export async function requestCorrection(form: FormData) {
  const user = await requireUser();
  const e = await db.employee.findUnique({ where: { userId: user.id } });
  const back = (q: string) => redirect(`/me/clock?${q}#fix`);
  if (!e) return back("error=" + encodeURIComponent("Your login isn't linked to an employee."));
  const s = await timeSettings(e.companyId);
  const date = String(form.get("date") ?? "");
  const t = shiftTimes(date, String(form.get("in") ?? ""), String(form.get("out") ?? ""), s.timeZone);
  const reason = String(form.get("reason") ?? "").trim().slice(0, 500);
  if (!t) return back("error=" + encodeURIComponent("Enter the day and both times."));
  if (t.clockOutAt > new Date(Date.now() + 5 * 60_000)) return back("error=" + encodeURIComponent("The punch out time can't be in the future."));
  if (!reason) return back("error=" + encodeURIComponent("Say briefly what happened, e.g. \"forgot to punch out\"."));
  const entryId = String(form.get("entryId") ?? "");
  const entry = entryId ? await db.timeEntry.findFirst({ where: { id: entryId, employeeId: e.id } }) : null;
  await db.timeCorrection.create({
    data: {
      companyId: e.companyId, employeeId: e.id, entryId: entry?.id ?? null, clockInAt: t.clockInAt, clockOutAt: t.clockOutAt,
      mealMinutes: Math.min(240, Math.max(0, Math.round(Number(form.get("mealMinutes")) || 0))), reason,
    },
  });
  await db.auditLog.create({ data: { actorId: user.id, companyId: e.companyId, action: "time.correction_requested", detail: { employeeId: e.id, entryId: entry?.id ?? null, date } } });
  return back("ok=" + encodeURIComponent("Sent to your manager. Your hours update once they approve it."));
}
