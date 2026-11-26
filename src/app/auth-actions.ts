"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { endSession, startSession, requireUser } from "@/lib/auth/session";
import { normalizeEin } from "@/lib/app/ids";
import { audit } from "@/lib/app/payroll-service";
import { invitePending, userForInvite } from "@/lib/app/invites";
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
  redirect(`/app/${company.id}`);
}

export async function login(form: FormData) {
  const email = str(form.get("email")).toLowerCase();
  const password = String(form.get("password") ?? "");
  const user = await db.user.findUnique({ where: { email }, include: { memberships: true, employee: true } });
  if (user && invitePending(user)) back("/login", "Finish setting up your login with the link in your invite email first.");
  if (!user || !verifyPassword(password, user.passwordHash)) back("/login", "Email or password is wrong.");
  await startSession(user!.id);
  if (user!.isPlatformAdmin) redirect("/admin");
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
  if (user!.memberships.some((m) => m.role !== "EMPLOYEE")) redirect("/app");
  redirect(user!.employee ? "/me" : "/app");
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

/** Turns the signed-in account into a White Oak platform admin, with the one-time setup code. */
export async function claimAdmin(form: FormData) {
  const user = await requireUser();
  const token = process.env.ADMIN_SETUP_TOKEN;
  if (!token || token.length < 12) back("/admin/claim", "ADMIN_SETUP_TOKEN is not set on the server (needs 12+ characters).");
  if (str(form.get("token")) !== token) back("/admin/claim", "That code is not right.");
  await db.user.update({ where: { id: user.id }, data: { isPlatformAdmin: true } });
  await audit(user.id, null, "admin.claimed");
  redirect("/admin");
}
