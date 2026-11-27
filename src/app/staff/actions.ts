"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { requireAdmin, startSession } from "@/lib/auth/session";
import { isStaffEmail } from "@/lib/auth/admins";
import { invitePending } from "@/lib/app/invites";
import { audit } from "@/lib/app/payroll-service";
import { canDecide, emailApproved, emailDenied, notifyAdminsOfRequest } from "@/lib/app/staff-requests";
import { str } from "@/components/ui";

const back = (path: string, msg: { error?: string; ok?: string }): never =>
  redirect(`${path}?${msg.error ? `error=${encodeURIComponent(msg.error)}` : `ok=${encodeURIComponent(msg.ok ?? "")}`}`);

const JOIN = "/staff/join";

/**
 * Ask to join White Oak as payroll staff. Makes (or, after a password check, reuses) a login that
 * has no White Oak access until an admin approves it on /admin.
 */
export async function requestStaffAccess(form: FormData) {
  const name = str(form.get("name"));
  const email = str(form.get("email")).toLowerCase();
  const password = String(form.get("password") ?? "");
  const note = str(form.get("note")).slice(0, 500) || null;
  if (!email || !email.includes("@")) back(JOIN, { error: "Enter your email." });
  if (isStaffEmail(email)) back(JOIN, { error: "That email is already White Oak staff. Sign in instead." });

  let user = await db.user.findUnique({ where: { email } });
  if (user) {
    if (invitePending(user)) back(JOIN, { error: "You've already been invited with that email. Use the link in your invite email to set your password first." });
    if (!verifyPassword(password, user.passwordHash)) back(JOIN, { error: "That email already has a White Oak login. Enter its current password to ask for staff access." });
    if (user!.staffStatus === "APPROVED") back("/login", { error: "You're already approved as staff. Sign in." });
    if (user!.staffStatus === "PENDING") back(JOIN, { error: "You've already asked. An administrator will review it soon." });
    user = await db.user.update({
      where: { id: user!.id },
      data: { staffStatus: "PENDING", staffRequestedAt: new Date(), staffRequestNote: note, staffDecidedAt: null, staffDecidedById: null },
    });
  } else {
    if (!name) back(JOIN, { error: "Enter your name." });
    const pw = passwordProblem(password);
    if (pw) back(JOIN, { error: pw });
    if (password !== String(form.get("confirm") ?? "")) back(JOIN, { error: "The two passwords don't match." });
    user = await db.user.create({
      data: { email, name, passwordHash: hashPassword(password), staffStatus: "PENDING", staffRequestedAt: new Date(), staffRequestNote: note },
    });
  }
  await audit(user!.id, null, "staff.requested", { email });
  const sent = await notifyAdminsOfRequest({ name: user!.name, email, note });
  if (!sent.some((r) => r.sent)) console.warn(`Staff request from ${email}: no admin was emailed.`, sent);

  if (user!.totpEnabledAt) {
    await startSession(user!.id, { mfaPending: true });
    redirect("/login/two-step");
  }
  await startSession(user!.id);
  redirect("/staff/pending");
}

const ADMIN = "/admin";

async function decide(form: FormData, status: "APPROVED" | "DENIED" | "REMOVED", extra: { bureauId?: string } = {}) {
  const admin = await requireAdmin();
  const id = str(form.get("userId"));
  const worker = await db.user.findUnique({ where: { id } });
  if (!worker || !worker.staffStatus) back(ADMIN, { error: "That request no longer exists." });
  // Only move from a state this decision allows, so two admins clicking at once can't both act.
  const from = (["PENDING", "APPROVED", "DENIED", "REMOVED"] as const).filter((s) => canDecide(s, status));
  const done = await db.user.updateMany({
    where: { id, staffStatus: { in: [...from] } },
    data: { staffStatus: status, staffDecidedAt: new Date(), staffDecidedById: admin.id, ...extra },
  });
  if (done.count === 0) back(ADMIN, { error: `${worker!.name}'s request was already handled. Reload the page.` });
  const action = { APPROVED: "admin.staff_approved", DENIED: "admin.staff_denied", REMOVED: "admin.staff_removed" }[status];
  await audit(admin.id, null, action, { email: worker!.email, by: admin.email, ...extra });
  return { admin, worker: worker! };
}

/**
 * Approve a staff request into one bureau: they get the payroll staff role in that bureau's
 * companies only (the same access Olga has in hers), and are emailed.
 */
export async function approveStaff(form: FormData) {
  const bureauId = str(form.get("bureauId"));
  const bureau = bureauId ? await db.bureau.findUnique({ where: { id: bureauId } }) : null;
  if (!bureau) back(ADMIN, { error: "Choose the bureau they will work for. Create it under Bureaus first if it isn't listed." });
  const { worker } = await decide(form, "APPROVED", { bureauId: bureau!.id });
  const r = await emailApproved(worker);
  back(ADMIN, { ok: r.sent ? `${worker.name} is approved for ${bureau!.name} and was emailed to sign in.` : `${worker.name} is approved for ${bureau!.name}. ${r.reason} Tell them to sign in at /login.` });
}

export async function denyStaff(form: FormData) {
  const { worker } = await decide(form, "DENIED");
  const r = await emailDenied(worker);
  back(ADMIN, { ok: `${worker.name}'s request was denied${r.sent ? " and they were emailed" : ""}. They have no White Oak access.` });
}

/** Take staff access away from someone an admin approved earlier. Takes effect on their next click. */
export async function removeStaff(form: FormData) {
  const { worker } = await decide(form, "REMOVED");
  back(ADMIN, { ok: `${worker.name} no longer has staff access.` });
}
