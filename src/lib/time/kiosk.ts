/**
 * Shared tablet kiosks. A manager creates a kiosk and gets a one-time setup link; opening it on
 * the tablet swaps the code for a long-lived device cookie. Employees punch there by tapping their
 * name and typing a PIN. Only hashes of codes, device tokens and PINs are stored.
 */
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "../db";
import { hashPassword, verifyPassword } from "../auth/password";

export const KIOSK_COOKIE = "wo_kiosk";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const SETUP_HOURS = 24;
export const MAX_TRIES = 5;
const LOCK_MINUTES = 15;

/** New setup code for a kiosk (returned once, for the link). Revokes any device already using it. */
export async function issueSetupCode(kioskId: string): Promise<string> {
  const code = randomBytes(18).toString("base64url");
  await db.kiosk.update({
    where: { id: kioskId },
    data: { setupCodeHash: sha256(code), setupExpiresAt: new Date(Date.now() + SETUP_HOURS * 3_600_000), deviceTokenHash: null, revokedAt: null },
  });
  return code;
}

/** Swap a setup code for a device token. Returns the token to put in the cookie, or null. */
export async function redeemSetupCode(code: string): Promise<{ token: string; kioskId: string } | null> {
  const k = await db.kiosk.findUnique({ where: { setupCodeHash: sha256(code) } });
  if (!k || k.revokedAt || !k.setupExpiresAt || k.setupExpiresAt < new Date()) return null;
  const token = randomBytes(32).toString("base64url");
  await db.kiosk.update({ where: { id: k.id }, data: { setupCodeHash: null, setupExpiresAt: null, deviceTokenHash: sha256(token), lastSeenAt: new Date() } });
  return { token, kioskId: k.id };
}

/** The kiosk this device is set up as, if any. */
export async function currentKiosk() {
  const token = (await cookies()).get(KIOSK_COOKIE)?.value;
  if (!token) return null;
  const k = await db.kiosk.findUnique({ where: { deviceTokenHash: sha256(token) }, include: { company: true, location: true } });
  if (!k || k.revokedAt) return null;
  if (!k.lastSeenAt || Date.now() - k.lastSeenAt.getTime() > 10 * 60_000) await db.kiosk.update({ where: { id: k.id }, data: { lastSeenAt: new Date() } });
  return k;
}

export function pinProblem(pin: string): string | null {
  if (!/^\d{4,6}$/.test(pin)) return "A PIN is 4 to 6 digits.";
  if (/^(\d)\1+$/.test(pin) || "0123456789".includes(pin) || "9876543210".includes(pin)) return "Choose a PIN that isn't all one digit or a run like 1234.";
  return null;
}

export async function setPin(employeeId: string, pin: string) {
  const pinHash = hashPassword(pin);
  await db.kioskPin.upsert({ where: { employeeId }, update: { pinHash, failedTries: 0, lockedUntil: null }, create: { employeeId, pinHash } });
}

/** Check a PIN, counting wrong tries; locks the employee's PIN for 15 minutes after 5 misses. */
export async function checkPin(employeeId: string, pin: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const p = await db.kioskPin.findUnique({ where: { employeeId } });
  if (!p) return { ok: false, error: "No PIN set up yet. Ask your manager for a kiosk PIN." };
  if (p.lockedUntil && p.lockedUntil > new Date()) return { ok: false, error: "Too many wrong PINs. Try again in 15 minutes or ask your manager." };
  if (verifyPassword(pin, p.pinHash)) {
    if (p.failedTries) await db.kioskPin.update({ where: { employeeId }, data: { failedTries: 0, lockedUntil: null } });
    return { ok: true };
  }
  const tries = p.failedTries + 1;
  const lock = tries >= MAX_TRIES;
  await db.kioskPin.update({ where: { employeeId }, data: { failedTries: lock ? 0 : tries, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null } });
  return { ok: false, error: lock ? "Too many wrong PINs. Try again in 15 minutes or ask your manager." : `Wrong PIN. ${MAX_TRIES - tries} tr${MAX_TRIES - tries === 1 ? "y" : "ies"} left.` };
}
