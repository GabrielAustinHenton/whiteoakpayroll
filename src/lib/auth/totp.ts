import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Two-step sign-in with an authenticator app (Google Authenticator, 1Password, Authy, Microsoft
 * Authenticator): RFC 6238 time-based codes, SHA-1, 6 digits, 30 second steps. We accept the
 * step before and after the current one for clock drift, and never the same step twice.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("Not base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random secret (160 bits), base32 for authenticator apps. */
export const newTotpSecret = () => base32Encode(randomBytes(20));

export const timeStep = (nowMs = Date.now()) => Math.floor(nowMs / 1000 / STEP_SECONDS);

/** The code for one time step (RFC 4226 HOTP with the step as the counter). */
export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * The time step a typed code matches, or null. Steps at or before `lastStep` are refused so a
 * code seen over someone's shoulder can't be reused.
 */
export function verifyTotp(secret: string, typed: string, lastStep: number | null = null, nowMs = Date.now()): number | null {
  const code = typed.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return null;
  const now = timeStep(nowMs);
  for (const step of [now - 1, now, now + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(totpAt(secret, step)), Buffer.from(code))) return step;
  }
  return null;
}

/** otpauth:// link that authenticator apps read from the QR code. */
export function otpauthUri(secret: string, email: string, issuer = "White Oak Payroll"): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

/** Group a secret in fours so it's easier to type into an app by hand. */
export const groupSecret = (s: string) => s.replace(/(.{4})/g, "$1 ").trim();

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const normalizeRecovery = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Ten one-time recovery codes like "k7qm-2xfp", for when the phone is lost. Store only the hashes. */
export function newRecoveryCodes(n = 10): { codes: string[]; hashes: string[] } {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const codes = Array.from({ length: n }, () => {
    const b = randomBytes(8);
    const s = Array.from(b, (x) => alphabet[x % alphabet.length]).join("");
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
  return { codes, hashes: codes.map((c) => sha256(normalizeRecovery(c))) };
}

/** The remaining hashes after using a recovery code, or null if the code is not one of them. */
export function redeemRecoveryCode(hashes: string[], typed: string): string[] | null {
  const h = sha256(normalizeRecovery(typed));
  if (!normalizeRecovery(typed) || !hashes.includes(h)) return null;
  return hashes.filter((x) => x !== h);
}
