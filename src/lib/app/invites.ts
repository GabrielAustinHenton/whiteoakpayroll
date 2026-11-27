import { createHash, randomBytes } from "node:crypto";
import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { appUrl, buttonEmail, sendEmail } from "@/lib/email";

/**
 * Emailed invites. A new person gets a login with no password and a one-time link (only its
 * SHA-256 is stored) that lets them choose one. Someone who already has a White Oak login is just
 * given access and told by email.
 */

export const INVITE_DAYS = 14;
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const invitePending = (u: Pick<User, "passwordHash">) => !u.passwordHash;

export interface InviteOutcome {
  /** What happened, in a sentence for the person who added them. */
  message: string;
  /** False when the email could not be sent; message then carries the link to pass on. */
  emailed: boolean;
}

/** Issue a fresh invite link for a login that has no password yet, and email it. */
type Purpose = "team" | "staff" | "employee";

const INVITE_LINES: Record<Purpose, (first: string, companyName: string) => string[]> = {
  staff: (first) => [`Hi ${first},`, "Your White Oak Payroll staff login is ready. From the payroll desk you can work on every client company.", "Choose a password to finish setting up your login."],
  team: (first, companyName) => [`Hi ${first},`, `You've been given access to ${companyName}'s payroll on White Oak Payroll.`, "Choose a password to finish setting up your login."],
  employee: (first, companyName) => [
    `Hi ${first},`,
    `Welcome to ${companyName}! They use White Oak Payroll to pay you.`,
    "Choose a password, then take about 10 minutes to enter your details, tax forms (W-4 and your state's form) and the bank account for direct deposit. Have your Social Security number and a voided check or your bank's routing and account numbers ready.",
    "Afterwards you can see your paystubs and W-2s there anytime.",
  ],
};

async function emailInvite(user: Pick<User, "id" | "email" | "name">, companyName: string, purpose: Purpose): Promise<InviteOutcome> {
  const token = randomBytes(32).toString("base64url");
  await db.user.update({
    where: { id: user.id },
    data: { inviteTokenHash: sha256(token), inviteExpiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000), invitedAt: new Date() },
  });
  const url = `${appUrl()}/invite/${token}`;
  const first = user.name.split(" ")[0] || user.name;
  const res = await sendEmail(
    buttonEmail({
      to: user.email,
      subject: purpose === "staff" ? "Your White Oak Payroll staff login" : purpose === "employee" ? `Finish your new-hire paperwork for ${companyName}` : `You're invited to ${companyName} on White Oak Payroll`,
      lines: INVITE_LINES[purpose](first, companyName),
      button: purpose === "employee" ? "Get started" : "Set up my login",
      url,
      after: [`This link works once and expires in ${INVITE_DAYS} days. If you weren't expecting it, you can ignore this email.`],
    }),
  );
  if (res.sent) return { emailed: true, message: `Invite emailed to ${user.email}.` };
  return { emailed: false, message: `${res.reason} Send them this invite link yourself: ${url}` };
}

/** Tell an existing White Oak user they have new access. */
async function emailAccess(user: Pick<User, "email" | "name">, companyName: string, purpose: "team" | "staff"): Promise<InviteOutcome> {
  const url = `${appUrl()}/login`;
  const res = await sendEmail(
    buttonEmail({
      to: user.email,
      subject: `You now have access to ${companyName} on White Oak Payroll`,
      lines: [`Hi ${user.name.split(" ")[0] || user.name},`, `You've been given access to ${companyName}'s payroll reports. Sign in with your existing White Oak login.`],
      button: "Sign in",
      url,
    }),
  );
  return res.sent
    ? { emailed: true, message: `${user.email} already has a White Oak login, so they were emailed that they now have access.` }
    : { emailed: false, message: `${user.email} already has a White Oak login and now has access (they sign in with their existing password). ${res.reason}` };
}

/** Resend a pending invite with a new link (the old link stops working). */
export async function resendInvite(userId: string, companyName: string, purpose: Purpose) {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!invitePending(u)) return { emailed: false, message: `${u.email} has already set up their login.` } satisfies InviteOutcome;
  return emailInvite(u, companyName, purpose);
}

/** Send a White Oak staff member a login invite (no company membership: STAFF_EMAILS grants access). */
export async function inviteStaffLogin(email: string, name: string): Promise<InviteOutcome> {
  const existing = await db.user.findUnique({ where: { email } });
  if (existing && !invitePending(existing)) return { emailed: false, message: `${email} already has a login; they now sign in as staff.` };
  const u = existing ?? (await db.user.create({ data: { email, name, passwordHash: "" } }));
  return emailInvite(u, "White Oak Payroll", "staff");
}

/** Give a teammate access, creating and inviting a login if they don't have one. */
export async function inviteTeammateLogin(email: string, name: string, companyId: string, role: "CLIENT_OWNER" | "CLIENT_HR", companyName: string): Promise<InviteOutcome> {
  const existing = await db.user.findUnique({ where: { email } });
  const u = existing ?? (await db.user.create({ data: { email, name: name || email, passwordHash: "" } }));
  await db.membership.upsert({ where: { userId_companyId: { userId: u.id, companyId } }, create: { userId: u.id, companyId, role }, update: { role } });
  if (existing && !invitePending(existing)) return emailAccess(existing, companyName, "team");
  return emailInvite(u, companyName, "team");
}

/**
 * Invite an employee to the portal to fill in their own onboarding. Links (or creates) their login
 * and an EMPLOYEE membership. A login already tied to another employee record is refused.
 */
export async function inviteEmployeeLogin(employee: { id: string; email: string; firstName: string; lastName: string; companyId: string; userId: string | null }, companyName: string): Promise<InviteOutcome> {
  const email = employee.email.toLowerCase();
  const name = `${employee.firstName} ${employee.lastName}`;
  let u = employee.userId ? await db.user.findUnique({ where: { id: employee.userId }, include: { employee: true } }) : await db.user.findUnique({ where: { email }, include: { employee: true } });
  if (u?.employee && u.employee.id !== employee.id) return { emailed: false, message: `${email} is already the portal login of another employee record, so no invite was sent. Use a different email.` };
  if (!u) u = await db.user.create({ data: { email, name, passwordHash: "" }, include: { employee: true } });
  await db.employee.update({ where: { id: employee.id }, data: { userId: u.id, selfOnboardingInvitedAt: new Date() } });
  await db.membership.upsert({ where: { userId_companyId: { userId: u.id, companyId: employee.companyId } }, create: { userId: u.id, companyId: employee.companyId, role: "EMPLOYEE" }, update: {} });
  if (!invitePending(u)) {
    const res = await sendEmail(
      buttonEmail({ to: u.email, subject: `Finish your new-hire paperwork for ${companyName}`, lines: INVITE_LINES.employee(employee.firstName, companyName), button: "Sign in", url: `${appUrl()}/me/details` }),
    );
    return res.sent ? { emailed: true, message: `${email} already has a White Oak login; they were emailed to sign in and finish.` } : { emailed: false, message: `${email} already has a White Oak login; ask them to sign in and finish. ${res.reason}` };
  }
  return emailInvite(u, companyName, "employee");
}

/** The login an invite link belongs to, if the link is still good. */
export async function userForInvite(token: string) {
  if (!token || token.length < 20) return null;
  const u = await db.user.findUnique({ where: { inviteTokenHash: sha256(token) }, include: { memberships: true, employee: true } });
  if (!u || !u.inviteExpiresAt || u.inviteExpiresAt < new Date() || !invitePending(u)) return null;
  return u;
}

/** Portal or login status in a few words, for lists. */
export function loginStatus(u: Pick<User, "passwordHash" | "invitedAt" | "inviteExpiresAt"> | null | undefined): { label: string; pending: boolean } {
  if (!u) return { label: "No login", pending: false };
  if (!invitePending(u)) return { label: "Login set up", pending: false };
  const on = (d: Date) => d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  if (u.inviteExpiresAt && u.inviteExpiresAt < new Date()) return { label: `Invite expired ${on(u.inviteExpiresAt)}`, pending: true };
  return { label: u.invitedAt ? `Invite sent ${on(u.invitedAt)}` : "Invite sent", pending: true };
}
