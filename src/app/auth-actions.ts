"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { endSession, startSession, requireUser } from "@/lib/auth/session";
import { adminAllowed, isStaffEmail } from "@/lib/auth/admins";
import { createHash, timingSafeEqual } from "node:crypto";
import { normalizeEin } from "@/lib/app/ids";
import { audit } from "@/lib/app/payroll-service";
import { invitePending, userForInvite } from "@/lib/app/invites";
import { requestPasswordReset, userForReset } from "@/lib/app/password-reset";
import { str } from "@/components/ui";

const back = (path: string, error: string) => redirect(`${path}?error=${encodeURIComponent(error)}`);

/** Self-serve signup: the owner's login and their company in one step. */
export async function signup(form: FormData) {
  const name = str(form.get("name"));
  const email = str(form.get("email")).toLowerCase();
  const password = String(form.get("password") ?? "");
  const legalName = str(form.get("legalName"));
  const ein = normalizeEin(str(form.get("ein")));
  const state = str(form.get("state"));
  if (!name || !email || !legalName) back("/signup", "Fill in every field.");
  const pw = passwordProblem(password);
  if (pw) back("/signup", pw);
  if (ein.error) back("/signup", ein.error);
  const taken = await db.user.findUnique({ where: { email } });
  if (taken) back("/signup", invitePending(taken) ? "You've already been invited with that email. Use the link in your invite email to set your password." : "That email already has an account. Sign in instead.");

  const user = await db.user.create({ data: { email, name, passwordHash: hashPassword(password) } });
  const company = await db.company.create({
    data: {
      legalName,
      tradeName: str(form.get("tradeName")) || null,
      ein: ein.value!,
      addressLine1: str(form.get("addressLine1")),
      city: str(form.get("city")),
      state,
      zip: str(form.get("zip")),
      memberships: { create: { userId: user.id, role: "CLIENT_OWNER" } },
    },
  });
  await audit(user.id, company.id, "company.signup", { legalName });
  await startSession(user.id);
  redirect(`/app/${company.id}/setup`);
}

export async function login(form: FormData) {
  const email = str(form.get("email")).toLowerCase();
  const password = String(form.get("password") ?? "");
  const user = await db.user.findUnique({ where: { email }, include: { memberships: true, employee: true } });
  if (user && invitePending(user)) back("/login", "Finish setting up your login with the link in your invite email first.");
  if (!user || !verifyPassword(password, user.passwordHash)) back("/login", "Email or password is wrong.");
  await startSession(user!.id);
  if (isStaffEmail(user!.email)) redirect("/ops");
  if (user!.isPlatformAdmin && adminAllowed(user!.email)) redirect("/admin");
  if (user!.memberships.length === 0 && user!.employee) redirect("/me");
  redirect("/app");
}

/** Accept an emailed invite: choose a password, then go straight in. */
export async function acceptInvite(form: FormData) {
  const token = str(form.get("token"));
  const here = `/invite/${encodeURIComponent(token)}`;
  const password = String(form.get("password") ?? "");
  const user = await userForInvite(token);
  if (!user) back(here, "This invite link has expired or was already used. Ask your employer to resend it.");
  const pw = passwordProblem(password);
  if (pw) back(here, pw);
  if (password !== String(form.get("confirm") ?? "")) back(here, "The two passwords don't match.");
  await db.user.update({ where: { id: user!.id }, data: { passwordHash: hashPassword(password), inviteTokenHash: null, inviteExpiresAt: null } });
  await audit(user!.id, user!.memberships[0]?.companyId ?? null, "invite.accepted");
  await startSession(user!.id);
  if (isStaffEmail(user!.email)) redirect("/ops");
  if (user!.memberships.some((m) => m.role !== "EMPLOYEE")) redirect("/app");
  redirect(user!.employee ? "/me" : "/app");
}

/** "Forgot password": always the same answer, whether or not the email has an account. */
export async function forgotPassword(form: FormData) {
  await requestPasswordReset(str(form.get("email")));
  redirect("/forgot?sent=1");
}

/** Choose a new password from an emailed reset link. Signs out every other session. */
export async function resetPassword(form: FormData) {
  const token = str(form.get("token"));
  const here = `/reset/${encodeURIComponent(token)}`;
  const password = String(form.get("password") ?? "");
  const user = await userForReset(token);
  if (!user) back(here, "This reset link has expired or was already used. Ask for a new one.");
  const pw = passwordProblem(password);
  if (pw) back(here, pw);
  if (password !== String(form.get("confirm") ?? "")) back(here, "The two passwords don't match.");
  await db.$transaction([
    db.user.update({ where: { id: user!.id }, data: { passwordHash: hashPassword(password), resetTokenHash: null, resetExpiresAt: null } }),
    db.session.deleteMany({ where: { userId: user!.id } }),
  ]);
  await audit(user!.id, null, "password.reset");
  await startSession(user!.id);
  redirect("/app?ok=Password+changed");
}

export async function logout() {
  await endSession();
  redirect("/login");
}

export async function changePassword(form: FormData) {
  const user = await requireUser();
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  if (!verifyPassword(current, user.passwordHash)) back("/account", "Current password is wrong.");
  const pw = passwordProblem(next);
  if (pw) back("/account", pw);
  await db.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(next) } });
  redirect("/account?ok=Password+changed");
}

/** True when the typed code matches ADMIN_SETUP_TOKEN (constant-time compare). */
function setupCodeOk(typed: string): boolean {
  const token = process.env.ADMIN_SETUP_TOKEN ?? "";
  const h = (x: string) => createHash("sha256").update(x).digest();
  return token.length >= 12 && timingSafeEqual(h(typed), h(token));
}

function setupProblem(email: string, code: string): string | null {
  const token = process.env.ADMIN_SETUP_TOKEN;
  if (!token || token.length < 12) return "ADMIN_SETUP_TOKEN is not set on the server (needs 12+ characters).";
  if (!adminAllowed(email)) return "That email is not on the White Oak admin list (ADMIN_EMAILS).";
  if (!setupCodeOk(code)) return "That setup code is not right.";
  return null;
}

/** Turns the signed-in account into a White Oak platform admin, with the one-time setup code. */
export async function claimAdmin(form: FormData) {
  const user = await requireUser();
  const problem = setupProblem(user.email, str(form.get("token")));
  if (problem) back("/admin/claim", problem);
  await db.user.update({ where: { id: user.id }, data: { isPlatformAdmin: true } });
  await audit(user.id, null, "admin.claimed");
  redirect("/admin");
}

/**
 * White Oak staff login without a client company. Needs the setup code, and when ADMIN_EMAILS is
 * set, an email on that list. An existing account (e.g. one that also owns a company) is upgraded
 * after its password is checked.
 */
export async function setupAdmin(form: FormData) {
  const name = str(form.get("name"));
  const email = str(form.get("email")).toLowerCase();
  const password = String(form.get("password") ?? "");
  const problem = setupProblem(email, str(form.get("token")));
  if (problem) back("/admin/setup", problem);
  let user = await db.user.findUnique({ where: { email } });
  if (user) {
    if (!verifyPassword(password, user.passwordHash)) back("/admin/setup", "That email already has a login. Enter its current password to make it an admin.");
    user = await db.user.update({ where: { id: user.id }, data: { isPlatformAdmin: true } });
  } else {
    if (!name) back("/admin/setup", "Enter your name.");
    const pw = passwordProblem(password);
    if (pw) back("/admin/setup", pw);
    user = await db.user.create({ data: { email, name, passwordHash: hashPassword(password), isPlatformAdmin: true } });
  }
  await audit(user!.id, null, "admin.claimed", { via: "setup" });
  await startSession(user!.id);
  redirect("/admin");
}
