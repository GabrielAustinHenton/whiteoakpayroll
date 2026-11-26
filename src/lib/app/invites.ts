import { createHash, randomBytes } from "node:crypto";
import type { Employee, User } from "@prisma/client";
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
async function emailInvite(user: Pick<User, "id" | "email" | "name">, companyName: string, purpose: "portal" | "team"): Promise<InviteOutcome> {
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
      subject: purpose === "portal" ? `${companyName} set up your payroll portal` : `You're invited to ${companyName} on White Oak Payroll`,
      lines:
        purpose === "portal"
          ? [`Hi ${first},`, `${companyName} pays you through White Oak Payroll. Your employee portal is ready: see your paystubs and W-2s there, and request a payday advance where your employer offers them.`, "Choose a password to finish setting up your login."]
          : [`Hi ${first},`, `You've been given access to ${companyName}'s payroll on White Oak Payroll.`, "Choose a password to finish setting up your login."],
      button: "Set up my login",
      url,
      after: [`This link works once and expires in ${INVITE_DAYS} days. If you weren't expecting it, you can ignore this email.`],
    }),
  );
  if (res.sent) return { emailed: true, message: `Invite emailed to ${user.email}.` };
  return { emailed: false, message: `${res.reason} Send them this invite link yourself: ${url}` };
}

/** Tell an existing White Oak user they have new access. */
async function emailAccess(user: Pick<User, "email" | "name">, companyName: string, purpose: "portal" | "team"): Promise<InviteOutcome> {
  const url = `${appUrl()}/login`;
  const res = await sendEmail(
    buttonEmail({
      to: user.email,
      subject: purpose === "portal" ? `${companyName} added you to its employee portal` : `You now have access to ${companyName} on White Oak Payroll`,
      lines: [
        `Hi ${user.name.split(" ")[0] || user.name},`,
        purpose === "portal"
          ? `${companyName} pays you through White Oak Payroll. Sign in with your existing White Oak login to see your paystubs and W-2s.`
          : `You've been given access to ${companyName}'s payroll. Sign in with your existing White Oak login.`,
      ],
      button: "Sign in",
      url,
    }),
  );
  return res.sent
    ? { emailed: true, message: `${user.email} already has a White Oak login, so they were emailed that they now have access.` }
    : { emailed: false, message: `${user.email} already has a White Oak login and now has access (they sign in with their existing password). ${res.reason}` };
}

/**
 * Make sure an employee has a portal login for their current email, inviting them if needed.
 * Called whenever an employee is added or saved. Returns null when nothing changed.
 */
export async function ensurePortalInvite(e: Pick<Employee, "id" | "companyId" | "email" | "firstName" | "lastName" | "userId">, companyName: string): Promise<InviteOutcome | { error: string } | null> {
  const email = e.email.trim().toLowerCase();
  const name = `${e.firstName} ${e.lastName}`;
  if (e.userId) {
    const u = await db.user.findUniqueOrThrow({ where: { id: e.userId }, include: { memberships: true } });
    if (u.email === email) return null;
    // Their email changed. Move the login over if it is only this portal login; otherwise they keep it.
    const portalOnly = !u.isPlatformAdmin && u.memberships.every((m) => m.role === "EMPLOYEE" && m.companyId === e.companyId);
    if (!portalOnly) return { error: `The portal login stays on ${u.email} because that login is also used for other access.` };
    if (await db.user.findUnique({ where: { email } })) return { error: `${email} already belongs to another White Oak login, so the portal login stays on ${u.email}.` };
    const moved = await db.user.update({ where: { id: u.id }, data: { email, name } });
    if (invitePending(moved)) return emailInvite(moved, companyName, "portal");
    await db.session.deleteMany({ where: { userId: u.id } });
    return { emailed: false, message: `Their portal login is now ${email} (same password).` };
  }
  const existing = await db.user.findUnique({ where: { email }, include: { employee: true } });
  if (existing) {
    if (existing.employee) return { error: `${email} is already the portal login of another employee record, so no portal invite was sent.` };
    await db.$transaction([
      db.membership.upsert({ where: { userId_companyId: { userId: existing.id, companyId: e.companyId } }, create: { userId: existing.id, companyId: e.companyId, role: "EMPLOYEE" }, update: {} }),
      db.employee.update({ where: { id: e.id }, data: { userId: existing.id } }),
    ]);
    if (invitePending(existing)) return emailInvite(existing, companyName, "portal");
    return emailAccess(existing, companyName, "portal");
  }
  const u = await db.user.create({ data: { email, name, passwordHash: "", memberships: { create: { companyId: e.companyId, role: "EMPLOYEE" } } } });
  await db.employee.update({ where: { id: e.id }, data: { userId: u.id } });
  return emailInvite(u, companyName, "portal");
}

/** Resend a pending invite with a new link (the old link stops working). */
export async function resendInvite(userId: string, companyName: string, purpose: "portal" | "team") {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!invitePending(u)) return { emailed: false, message: `${u.email} has already set up their login.` } satisfies InviteOutcome;
  return emailInvite(u, companyName, purpose);
}

/** Give a teammate access, creating and inviting a login if they don't have one. */
export async function inviteTeammateLogin(email: string, name: string, companyId: string, role: "CLIENT_OWNER" | "CLIENT_HR", companyName: string): Promise<InviteOutcome> {
  const existing = await db.user.findUnique({ where: { email } });
  const u = existing ?? (await db.user.create({ data: { email, name: name || email, passwordHash: "" } }));
  await db.membership.upsert({ where: { userId_companyId: { userId: u.id, companyId } }, create: { userId: u.id, companyId, role }, update: { role } });
  if (existing && !invitePending(existing)) return emailAccess(existing, companyName, "team");
  return emailInvite(u, companyName, "team");
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
