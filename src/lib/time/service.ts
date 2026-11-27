/**
 * Time Tracking add-on: settings, the punch state machine, and the geofence check against the
 * company's work locations. Used by the employee clock (/me/clock); the kiosk reuses punch().
 */
import type { Prisma, PunchSource, TimeSettings } from "@prisma/client";
import { db } from "../db";
import { checkPunch, type Fix, type PreviousPunch } from "./geofence";
import { stateTimeZone } from "./clock";

export type PunchKind = "in" | "out" | "break_start" | "break_end";

export async function timeTrackingOn(companyId: string): Promise<boolean> {
  return Boolean(await db.companyModule.findUnique({ where: { companyId_addOn: { companyId, addOn: "TIME_TRACKING" } } }));
}

/** The company's Time Tracking settings, created with defaults (time zone from the company's state) on first use. */
export async function timeSettings(companyId: string): Promise<TimeSettings> {
  const found = await db.timeSettings.findUnique({ where: { companyId } });
  if (found) return found;
  const c = await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { state: true } });
  return db.timeSettings.upsert({ where: { companyId }, update: {}, create: { companyId, timeZone: stateTimeZone(c.state) } });
}

/** Where an employee is in the punch cycle right now. */
export async function clockStatus(employeeId: string) {
  const open = await db.timeEntry.findFirst({
    where: { employeeId, clockOutAt: null },
    orderBy: { clockInAt: "desc" },
    include: { breaks: { orderBy: { startAt: "asc" } }, location: true },
  });
  const onBreak = open?.breaks.find((b) => !b.endAt) ?? null;
  return { open, onBreak, state: !open ? "out" : onBreak ? "break" : "in" } as const;
}

export interface PunchRequest {
  employeeId: string;
  kind: PunchKind;
  fix: Fix | null;
  /** MEAL (unpaid) or REST (paid), for break_start. */
  breakKind?: string;
  /** data:image/jpeg;base64,... from the camera, when the company asks for photos. */
  photo?: string | null;
  source: PunchSource;
  device?: { ip?: string | null; userAgent?: string | null };
  now?: Date;
}

export type PunchResult = { ok: true; message: string; flags: string[] } | { ok: false; error: string };

const MAX_PHOTO_BYTES = 200_000;

export function decodePhoto(dataUrl: string | null | undefined): Uint8Array<ArrayBuffer> | null {
  if (!dataUrl) return null;
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  const buf = Buffer.from(m[2], "base64");
  return buf.length > 0 && buf.length <= MAX_PHOTO_BYTES ? new Uint8Array(buf) : null;
}

/** Last place this employee punched, for the travel-speed check. */
async function previousPunch(employeeId: string): Promise<PreviousPunch | null> {
  const last = await db.timeEntry.findFirst({ where: { employeeId }, orderBy: { clockInAt: "desc" } });
  if (!last) return null;
  const pick = (p: unknown, at: Date | null) => {
    const x = p as { latitude?: number; longitude?: number } | null;
    return x && typeof x.latitude === "number" && typeof x.longitude === "number" && at ? { at, latitude: x.latitude, longitude: x.longitude } : null;
  };
  return pick(last.outPunch, last.clockOutAt) ?? pick(last.inPunch, last.clockInAt);
}

/**
 * Record a punch. Checks the punch order (no double punch in), the geofence per the company's
 * setting (BLOCK refuses starting work away from every work location), and the photo requirement. Blocked attempts are written to the audit log so managers
 * can see who tried to punch from where.
 */
export async function punch(req: PunchRequest, actorUserId: string | null): Promise<PunchResult> {
  const now = req.now ?? new Date();
  const employee = await db.employee.findUnique({ where: { id: req.employeeId } });
  if (!employee || employee.status === "TERMINATED") return { ok: false, error: "This employee can't punch in." };
  const companyId = employee.companyId;
  if (!(await timeTrackingOn(companyId))) return { ok: false, error: "Time Tracking isn't turned on for this company." };
  const settings = await timeSettings(companyId);
  const status = await clockStatus(employee.id);

  // Punch order.
  if (req.kind === "in" && status.open) return { ok: false, error: "You're already punched in." };
  if (req.kind !== "in" && !status.open) return { ok: false, error: "You're not punched in." };
  if (req.kind === "break_start" && status.onBreak) return { ok: false, error: "You're already on a break." };
  if (req.kind === "break_end" && !status.onBreak) return { ok: false, error: "You're not on a break." };
  const lastAt = status.onBreak?.startAt ?? status.open?.breaks.at(-1)?.endAt ?? status.open?.clockInAt;
  if (lastAt && now.getTime() - lastAt.getTime() < 20_000) return { ok: false, error: "You just punched. Wait a few seconds and try again." };

  const places = await db.workLocation.findMany({ where: { companyId, active: true } });
  const check = checkPunch({
    fix: req.fix,
    places,
    mode: settings.geofenceMode,
    maxAccuracyMeters: settings.maxAccuracyMeters,
    now,
    previous: await previousPunch(employee.id),
  });

  const record: Prisma.InputJsonObject = {
    latitude: req.fix?.latitude ?? null,
    longitude: req.fix?.longitude ?? null,
    accuracy: req.fix ? Math.round(req.fix.accuracy) : null,
    fixAt: req.fix ? new Date(req.fix.timestamp).toISOString() : null,
    locationId: check.locationId,
    locationName: check.locationName,
    distanceMeters: check.distanceMeters,
    inside: check.inside,
    flags: check.flags,
    source: req.source,
    ip: req.device?.ip?.slice(0, 64) ?? null,
    userAgent: req.device?.userAgent?.slice(0, 200) ?? null,
  };

  // Only starting work is blocked (punch in, back from break). Punching out or starting a break
  // away from work is allowed and flagged: blocking those would keep paid time running.
  if (check.blocked && (req.kind === "out" || req.kind === "break_start")) check.blocked = null;
  if (check.blocked) {
    await db.auditLog.create({ data: { actorId: actorUserId, companyId, action: "time.punch_blocked", detail: { employeeId: employee.id, kind: req.kind, ...record } } });
    return { ok: false, error: check.blocked };
  }

  const photo = decodePhoto(req.photo);
  if (settings.requirePhoto && (req.kind === "in" || req.kind === "out") && !photo) return { ok: false, error: "Take a photo to punch." };

  const name = check.locationName ? ` at ${check.locationName}` : "";
  if (req.kind === "in") {
    await db.timeEntry.create({
      data: {
        companyId, employeeId: employee.id, clockInAt: now, source: req.source, inPunch: record,
        locationId: check.locationId, flags: check.flags, inPhoto: photo ?? undefined,
      },
    });
    return { ok: true, message: `Punched in${name}.`, flags: check.flags };
  }
  const open = status.open!;
  const flags = [...new Set([...open.flags, ...check.flags])];
  if (req.kind === "out") {
    if (now.getTime() - open.clockInAt.getTime() > 16 * 3_600_000) flags.push("LONG_SHIFT");
    await db.$transaction([
      // Punching out ends a break that is still open.
      db.timeBreak.updateMany({ where: { entryId: open.id, endAt: null }, data: { endAt: now, endPunch: record } }),
      db.timeEntry.update({ where: { id: open.id }, data: { clockOutAt: now, outPunch: record, flags, outPhoto: photo ?? undefined } }),
    ]);
    return { ok: true, message: `Punched out${name}.`, flags: check.flags };
  }
  if (req.kind === "break_start") {
    const kind = req.breakKind === "REST" ? "REST" : "MEAL";
    await db.$transaction([
      db.timeBreak.create({ data: { entryId: open.id, kind, startAt: now, startPunch: record } }),
      db.timeEntry.update({ where: { id: open.id }, data: { flags } }),
    ]);
    return { ok: true, message: kind === "MEAL" ? "Meal break started (unpaid)." : "Rest break started (paid).", flags: check.flags };
  }
  await db.$transaction([
    db.timeBreak.update({ where: { id: status.onBreak!.id }, data: { endAt: now, endPunch: record } }),
    db.timeEntry.update({ where: { id: open.id }, data: { flags } }),
  ]);
  return { ok: true, message: "Back from break.", flags: check.flags };
}
