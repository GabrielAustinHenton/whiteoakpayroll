"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { requireStaffManager, startSession, type CurrentUser } from "@/lib/auth/session";
import { isStaffEmail } from "@/lib/auth/admins";
import { invitePending } from "@/lib/app/invites";
import { audit } from "@/lib/app/payroll-service";
import { canDecide, canManageWorker, emailApproved, emailDenied, notifyOfRequest } from "@/lib/app/staff-requests";
import { str } from "@/components/ui";

const back = (path: string, msg: { error?: string; ok?: string }): never =>
  redirect(`${path}?${msg.error ? `error=${encodeURIComponent(msg.error)}` : `ok=${encodeURIComponent(msg.ok ?? "")}`}`);

/**
 * Ask to join White Oak as payroll staff. Makes (or, after a password check, reuses) a login that
 * has no White Oak access until it is approved. With a bureau's join link (?bureau=<id>) the
 * request goes to that bureau, so its owner can approve it too; otherwise only admins see it.
 */
export async function requestStaffAccess(form: FormData) {
  const name = str(form.get("name"));
  const email = str(form.get("email")).toLowerCase();
  const password = String(form.get("password") ?? "");
  const note = str(form.get("note")).slice(0, 500) || null;
  const bureauParam = str(form.get("bureau"));
  const JOIN = bureauParam ? `/staff/join?bureau=${encodeURIComponent(bureauParam)}&` : "/staff/join?";
  const fail = (error: string): never => redirect(`${JOIN}error=${encodeURIComponent(error)}`);
  const bureau = bureauParam ? await db.bureau.findUnique({ where: { id: bureauParam } }) : null;
  if (bureauParam && !bureau) fail("That join link is not valid any more. Ask for a new one.");
  if (!email || !email.includes("@")) fail("Enter your email.");
  if (isStaffEmail(email)) fail("That email is already White Oak staff. Sign in instead.");

  let user = await db.user.findUnique({ where: { email } });
  const request = { staffStatus: "PENDING" as const, staffRequestedAt: new Date(), staffRequestNote: note, staffDecidedAt: null, staffDecidedById: null, bureauId: bureau?.id ?? null, bureauOwner: false };
  if (user) {
    if (invitePending(user)) fail("You've already been invited with that email. Use the link in your invite email to set your password first.");
    if (!verifyPassword(password, user.passwordHash)) fail("That email already has a White Oak login. Enter its current password to ask for staff access.");
    if (user!.staffStatus === "APPROVED") back("/login", { error: "You're already approved as staff. Sign in." });
    if (user!.staffStatus === "PENDING") fail("You've already asked. It will be reviewed soon.");
    user = await db.user.update({ where: { id: user!.id }, data: request });
  } else {
    if (!name) fail("Enter your name.");
    const pw = passwordProblem(password);
    if (pw) fail(pw);
    if (password !== String(form.get("confirm") ?? "")) fail("The two passwords don't match.");
    user = await db.user.create({ data: { email, name, passwordHash: hashPassword(password), ...request } });
  }
  await audit(user!.id, null, "staff.requested", { email, bureau: bureau?.name ?? null });
  const sent = await notifyOfRequest({ name: user!.name, email, note }, bureau);
  if (!sent.some((r) => r.sent)) console.warn(`Staff request from ${email}: nobody was emailed.`, sent);

  if (user!.totpEnabledAt) {
    await startSession(user!.id, { mfaPending: true });
    redirect("/login/two-step");
  }
  await startSession(user!.id);
  redirect("/staff/pending");
}

/** Admins decide on /admin; bureau owners on their own team page. */
const homeFor = (u: CurrentUser) => (u.isPlatformAdmin ? "/admin" : "/ops/team");

async function decide(form: FormData, status: "APPROVED" | "DENIED" | "REMOVED", extra: { bureauId?: string } = {}) {
  const manager = await requireStaffManager();
  const home = homeFor(manager);
  const id = str(form.get("userId"));
  const worker = await db.user.findUnique({ where: { id } });
  if (!worker || !worker.staffStatus) back(home, { error: "That request no longer exists." });
  if (!canManageWorker(manager, worker!)) back(home, { error: "That person isn't in your bureau." });
  // Only move from a state this decision allows, so two people clicking at once can't both act.
  const from = (["PENDING", "APPROVED", "DENIED", "REMOVED"] as const).filter((s) => canDecide(s, status));
  const done = await db.user.updateMany({
    where: { id, staffStatus: { in: [...from] }, ...(manager.isPlatformAdmin ? {} : { bureauId: manager.bureauId, bureauOwner: false }) },
    data: { staffStatus: status, staffDecidedAt: new Date(), staffDecidedById: manager.id, ...extra },
  });
  if (done.count === 0) back(home, { error: `${worker!.name}'s request was already handled. Reload the page.` });
  const action = { APPROVED: "staff.approved", DENIED: "staff.denied", REMOVED: "staff.removed" }[status];
  await audit(manager.id, null, manager.isPlatformAdmin ? `admin.${action}` : action, { email: worker!.email, by: manager.email, ...extra });
  return { manager, home, worker: worker! };
}

/**
 * Approve a staff request into one bureau: they get the payroll staff role in that bureau's
 * companies only, and are emailed. Admins choose the bureau; a bureau owner approves into theirs.
 */
export async function approveStaff(form: FormData) {
  const manager = await requireStaffManager();
  const bureauId = manager.isPlatformAdmin ? str(form.get("bureauId")) : manager.bureauId!;
  const bureau = bureauId ? await db.bureau.findUnique({ where: { id: bureauId } }) : null;
  if (!bureau) back(homeFor(manager), { error: "Choose the bureau they will work for. Create it under Bureaus first if it isn't listed." });
  const { worker, home } = await decide(form, "APPROVED", { bureauId: bureau!.id });
  const r = await emailApproved(worker);
  back(home, { ok: r.sent ? `${worker.name} is approved for ${bureau!.name} and was emailed to sign in.` : `${worker.name} is approved for ${bureau!.name}. ${r.reason} Tell them to sign in at /login.` });
}

export async function denyStaff(form: FormData) {
  const { worker, home } = await decide(form, "DENIED");
  const r = await emailDenied(worker);
  back(home, { ok: `${worker.name}'s request was denied${r.sent ? " and they were emailed" : ""}. They have no White Oak access.` });
}

/** Take staff access away. Takes effect on their next click. */
export async function removeStaff(form: FormData) {
  const { worker, home } = await decide(form, "REMOVED");
  back(home, { ok: `${worker.name} no longer has staff access.` });
}
