import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, newRecoveryCodes, newTotpSecret, otpauthUri, redeemRecoveryCode, timeStep, totpAt, verifyTotp } from "@/lib/auth/totp";
import { twoStepRequiredForStaff } from "@/lib/auth/session";

// RFC 6238 appendix B, SHA-1 seed "12345678901234567890" (last 6 of the 8-digit vectors).
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("authenticator codes", () => {
  it("round-trips base32", () => {
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode(RFC_SECRET).toString()).toBe("12345678901234567890");
  });

  it("matches the RFC 6238 test vectors", () => {
    expect(totpAt(RFC_SECRET, timeStep(59_000))).toBe("287082");
    expect(totpAt(RFC_SECRET, timeStep(1_111_111_109_000))).toBe("081804");
    expect(totpAt(RFC_SECRET, timeStep(1_234_567_890_000))).toBe("005924");
    expect(totpAt(RFC_SECRET, timeStep(2_000_000_000_000))).toBe("279037");
  });

  it("accepts one step of clock drift and refuses reuse", () => {
    const now = 1_800_000_000_000;
    const secret = newTotpSecret();
    const prev = totpAt(secret, timeStep(now) - 1);
    const step = verifyTotp(secret, prev, null, now);
    expect(step).toBe(timeStep(now) - 1);
    expect(verifyTotp(secret, prev, step, now)).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, timeStep(now) - 3), null, now)).toBeNull();
    expect(verifyTotp(secret, "12345", null, now)).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, timeStep(now)).replace(/(\d{3})/, "$1 "), null, now)).toBe(timeStep(now));
  });

  it("builds an otpauth link", () => {
    expect(otpauthUri("ABC", "olga@example.com")).toBe("otpauth://totp/White%20Oak%20Payroll%3Aolga%40example.com?secret=ABC&issuer=White%20Oak%20Payroll&algorithm=SHA1&digits=6&period=30");
  });
});

describe("recovery codes", () => {
  it("each code works once, ignoring case and dashes", () => {
    const { codes, hashes } = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(hashes.join()).not.toContain(codes[0]);
    const left = redeemRecoveryCode(hashes, codes[3].toUpperCase().replace("-", " "));
    expect(left).toHaveLength(9);
    expect(redeemRecoveryCode(left!, codes[3])).toBeNull();
    expect(redeemRecoveryCode(hashes, "")).toBeNull();
  });
});

describe("staff requirement", () => {
  it("is on unless switched off", () => {
    expect(twoStepRequiredForStaff({})).toBe(true);
    expect(twoStepRequiredForStaff({ TWO_STEP_FOR_STAFF: "off" })).toBe(false);
    expect(twoStepRequiredForStaff({ TWO_STEP_FOR_STAFF: "on" })).toBe(true);
  });
});
