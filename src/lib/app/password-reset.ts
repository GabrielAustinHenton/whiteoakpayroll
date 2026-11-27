import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { appUrl, buttonEmail, sendEmail } from "@/lib/email";
import { invitePending, resendInvite, sha256 } from "./invites";

/**
 * "Forgot password": a one-time link, emailed to the address on the account, valid for one hour.
 * Only the link's SHA-256 is stored. The caller always shows the same message, so the page never
 * reveals whether an email has an account.
 */

export const RESET_MINUTES = 60;
/** Ignore repeat requests for the same account within this window (stops email floods). */
const RESEND_AFTER_MS = 2 * 60_000;

export async function requestPasswordReset(rawEmail: string): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  if (!email) return;
  const user = await db.user.findUnique({ where: { email } });
  if (!user) return;
  // Someone who never finished their invite gets a fresh invite link instead.
  if (invitePending(user)) {
    if (user.invitedAt && Date.now() - user.invitedAt.getTime() < RESEND_AFTER_MS) return;
    await resendInvite(user.id, "White Oak Payroll", "team");
    return;
  }
  const issuedAt = user.resetExpiresAt ? user.resetExpiresAt.getTime() - RESET_MINUTES * 60_000 : 0;
  if (Date.now() - issuedAt < RESEND_AFTER_MS) return;
  const token = randomBytes(32).toString("base64url");
  await db.user.update({ where: { id: user.id }, data: { resetTokenHash: sha256(token), resetExpiresAt: new Date(Date.now() + RESET_MINUTES * 60_000) } });
  const url = `${appUrl()}/reset/${token}`;
  const res = await sendEmail(
    buttonEmail({
      to: user.email,
      subject: "Reset your White Oak Payroll password",
      lines: [`Hi ${user.name.split(" ")[0] || user.name},`, "Someone asked to reset the password for your White Oak Payroll login. Choose a new password with the button below."],
      button: "Choose a new password",
      url,
      after: [`The link works once and expires in ${RESET_MINUTES} minutes. If you didn't ask for this, ignore this email: your password stays the same.`],
    }),
  );
  if (!res.sent) console.warn(`[password-reset] not emailed to user ${user.id}: ${res.reason}`);
}

/** The login a reset link belongs to, if the link is still good. */
export async function userForReset(token: string) {
  if (!token || token.length < 20) return null;
  const u = await db.user.findUnique({ where: { resetTokenHash: sha256(token) } });
  if (!u || !u.resetExpiresAt || u.resetExpiresAt < new Date()) return null;
  return u;
}
