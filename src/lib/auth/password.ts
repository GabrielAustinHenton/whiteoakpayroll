import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** scrypt password hashing (Node built-in, no native dependency). Stored as "salt:hash" in hex. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(expected, actual);
}

export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  return null;
}

/** A readable one-time password for invited users (shown once to whoever invites them). */
export function temporaryPassword(): string {
  return randomBytes(9).toString("base64url");
}
