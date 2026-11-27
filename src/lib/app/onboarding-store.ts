import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { i9Dates, sameForm, stateRecord, w4Record, type W4Entry } from "./onboarding-records";

/**
 * Saving onboarding records: a new W-4 / state certificate version whenever the form changed
 * (the previous one is marked superseded, never overwritten), and the I-9 dates.
 */

export interface FormSource {
  /** "employee" (signed in the portal) or "client_hr" / "white_oak" (entered from a paper form). */
  source: string;
  enteredById: string;
  /** Typed signature when the employee signed in the portal. */
  signedName?: string;
}

export async function recordWithholdingForms(employeeId: string, w4: W4Entry, workState: string, stateW4: unknown, src: FormSource) {
  const now = new Date();
  const signed = src.signedName ? { signedName: src.signedName, signedAt: now } : {};
  const rec = w4Record(w4);
  const lastW4 = await db.w4Certificate.findFirst({ where: { employeeId, supersededAt: null }, orderBy: { createdAt: "desc" } });
  if (!lastW4 || !sameForm(lastW4.data, rec.data)) {
    if (lastW4) await db.w4Certificate.update({ where: { id: lastW4.id }, data: { supersededAt: now } });
    await db.w4Certificate.create({ data: { employeeId, ...rec, data: rec.data as unknown as Prisma.InputJsonValue, source: src.source, enteredById: src.enteredById, ...signed } });
  }
  const st = stateRecord(workState, stateW4);
  const lastSt = await db.stateWithholdingCertificate.findFirst({ where: { employeeId, state: st.state, supersededAt: null }, orderBy: { createdAt: "desc" } });
  if (!lastSt || !sameForm(lastSt.data, st.data)) {
    if (lastSt) await db.stateWithholdingCertificate.update({ where: { id: lastSt.id }, data: { supersededAt: now } });
    await db.stateWithholdingCertificate.create({ data: { employeeId, ...st, data: (stateW4 ?? {}) as Prisma.InputJsonValue, source: src.source, enteredById: src.enteredById, ...signed } });
  }
}

/**
 * Keep the I-9 record in step with the employee: dates from the first day of work (a later first
 * day set by a rehire is kept), and Section 1 / Section 2 completion when given.
 */
export async function syncI9(employeeId: string, firstDay: Date, done: { section1?: boolean; section2?: boolean; byUserId?: string } = {}, terminatedOn: Date | null = null) {
  const existing = await db.i9Record.findUnique({ where: { employeeId } });
  const now = new Date();
  const start = existing && existing.firstDayOfEmployment > firstDay ? existing.firstDayOfEmployment : firstDay;
  const data: Prisma.I9RecordUncheckedUpdateInput = { ...i9Dates(start, terminatedOn) };
  if (done.section1 !== undefined) data.section1CompletedAt = done.section1 ? (existing?.section1CompletedAt ?? now) : null;
  if (done.section2 !== undefined) {
    data.section2CompletedAt = done.section2 ? (existing?.section2CompletedAt ?? now) : null;
    data.section2ById = done.section2 ? (existing?.section2ById ?? done.byUserId ?? null) : null;
  }
  const dates = i9Dates(start, terminatedOn);
  await db.i9Record.upsert({
    where: { employeeId },
    create: { employeeId, ...dates, section1CompletedAt: done.section1 ? now : null, section2CompletedAt: done.section2 ? now : null, section2ById: done.section2 ? (done.byUserId ?? null) : null },
    update: data,
  });
}
