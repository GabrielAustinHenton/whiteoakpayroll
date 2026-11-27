"use server";

import { headers } from "next/headers";
import { db } from "@/lib/db";
import { validFix } from "@/lib/time/geofence";
import { checkPin, currentKiosk } from "@/lib/time/kiosk";
import { clockStatus, punch, type PunchKind, type PunchResult } from "@/lib/time/service";

async function verified(employeeId: string, pin: string) {
  const k = await currentKiosk();
  if (!k) return { error: "This device isn't set up as a kiosk any more." } as const;
  const e = await db.employee.findFirst({ where: { id: employeeId, companyId: k.companyId, status: { not: "TERMINATED" } } });
  if (!e) return { error: "Employee not found." } as const;
  const p = await checkPin(e.id, String(pin));
  if (!p.ok) return { error: p.error } as const;
  return { k, e } as const;
}

/** After name and PIN: where the employee is in their shift. */
export async function kioskStatus(employeeId: string, pin: string): Promise<{ ok: true; name: string; state: "out" | "in" | "break"; since: string | null } | { ok: false; error: string }> {
  const v = await verified(employeeId, pin);
  if ("error" in v) return { ok: false, error: v.error! };
  const s = await clockStatus(v.e.id);
  return { ok: true, name: v.e.firstName, state: s.state, since: (s.onBreak?.startAt ?? s.open?.clockInAt)?.toISOString() ?? null };
}

export async function kioskPunch(employeeId: string, pin: string, kind: string, fix: unknown, photo: string | null, breakKind?: string): Promise<PunchResult> {
  const v = await verified(employeeId, pin);
  if ("error" in v) return { ok: false, error: v.error! };
  if (!["in", "out", "break_start", "break_end"].includes(kind)) return { ok: false, error: "Unknown punch." };
  const h = await headers();
  return punch(
    {
      employeeId: v.e.id,
      kind: kind as PunchKind,
      fix: validFix(fix) ? fix : null,
      photo,
      breakKind,
      source: "KIOSK",
      trustedLocation: !v.k.checkLocation && v.k.location ? { id: v.k.location.id, name: v.k.location.name } : null,
      device: { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, userAgent: `kiosk:${v.k.name} ${h.get("user-agent") ?? ""}` },
    },
    null,
  );
}
