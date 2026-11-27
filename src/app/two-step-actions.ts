"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { completeTwoStep, endSession, pendingTwoStep, requireUser } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { landingFor } from "@/lib/auth/landing";
import { newRecoveryCodes, newTotpSecret, redeemRecoveryCode, verifyTotp } from "@/lib/auth/totp";
import { audit } from "@/lib/app/payroll-service";
import { str } from "@/components/ui";

const MAX_ATTEMPTS = 5;
const back = (path: string, error: string) => redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(error)}`);

/** Second step of sign-in: a code from the authenticator app, or a one-time recovery code. */
export async function verifyTwoStepLogin(form: FormData) {
  const pending = await pendingTwoStep();
  if (!pending) back("/login", "Your sign-in timed out. Enter your email and password again.");
  const s = pending!;
  const u = s.user;
  const code = str(form.get("code"));
  const recovery = str(form.get("recovery"));
  let ok = false;
  if (recovery) {
    const left = redeemRecoveryCode(u.recoveryCodeHashes, recovery);
    if (left) {
      await db.user.update({ where: { id: u.id }, data: { recoveryCodeHashes: left } });
      await audit(u.id, null, "two_step.recovery_code_used", { remaining: left.length });
      ok = true;
    }
  } else if (u.totpSecret) {
    const step = verifyTotp(u.totpSecret, code, u.totpLastStep);
    if (step !== null) {
      await db.user.update({ where: { id: u.id }, data: { totpLastStep: step } });
      ok = true;
    }
  }
  if (!ok) {
    const attempts = s.mfaAttempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await audit(u.id, null, "two_step.locked_out", { attempts });
      await endSession();
      back("/login", "Too many wrong codes. Sign in again.");
    }
    await db.session.update({ where: { id: s.id }, data: { mfaAttempts: attempts } });
    back("/login/two-step", recovery ? "That recovery code isn't right or was already used." : "That code isn't right. Check your authenticator app and try the newest code.");
  }
  await completeTwoStep(s.id);
  const full = await db.user.findUniqueOrThrow({ where: { id: u.id }, include: { memberships: true, employee: true } });
  redirect(landingFor(full));
}

/** Step 1 of turning on two-step sign-in: make a secret (not active until a code confirms it). */
export async function startTwoStepSetup() {
  const user = await requireUser();
  if (user.totpEnabledAt) redirect("/account/two-step");
  await db.user.update({ where: { id: user.id }, data: { totpSecret: newTotpSecret() } });
  redirect(`/account/two-step${user.needsTwoStep ? "?required=1" : ""}`);
}

export type CodesState = { error?: string; codes?: string[] };

/** Step 2: the first code from the app proves it's set up. Returns recovery codes, shown once. */
export async function confirmTwoStepSetup(_prev: CodesState, form: FormData): Promise<CodesState> {
  const user = await requireUser();
  if (user.totpEnabledAt) return { error: "Two-step sign-in is already on." };
  if (!user.totpSecret) return { error: "Start setup again." };
  const step = verifyTotp(user.totpSecret, str(form.get("code")));
  if (step === null) return { error: "That code isn't right. Make sure your phone's clock is set automatically, then try the newest code." };
  const { codes, hashes } = newRecoveryCodes();
  await db.user.update({ where: { id: user.id }, data: { totpEnabledAt: new Date(), totpLastStep: step, recoveryCodeHashes: hashes } });
  await audit(user.id, null, "two_step.enabled");
  return { codes };
}

/** New recovery codes (the old ones stop working). Needs a current code from the app. */
export async function regenerateRecoveryCodes(_prev: CodesState, form: FormData): Promise<CodesState> {
  const user = await requireUser();
  if (!user.totpEnabledAt || !user.totpSecret) return { error: "Turn on two-step sign-in first." };
  const step = verifyTotp(user.totpSecret, str(form.get("code")), user.totpLastStep);
  if (step === null) return { error: "That code isn't right." };
  const { codes, hashes } = newRecoveryCodes();
  await db.user.update({ where: { id: user.id }, data: { totpLastStep: step, recoveryCodeHashes: hashes } });
  await audit(user.id, null, "two_step.recovery_codes_replaced");
  return { codes };
}

/** Turn two-step sign-in off: needs the password and a current code. Not allowed for White Oak staff. */
export async function disableTwoStep(form: FormData) {
  const user = await requireUser();
  const fresh = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  if (user.isPlatformAdmin || user.isStaff) back("/account/two-step", "White Oak admins and staff must keep two-step sign-in on. To move it to a new phone, turn it on again from the new phone after an admin resets it.");
  if (!verifyPassword(String(form.get("password") ?? ""), fresh.passwordHash)) back("/account/two-step", "Password is wrong.");
  if (!fresh.totpSecret || verifyTotp(fresh.totpSecret, str(form.get("code")), fresh.totpLastStep) === null) back("/account/two-step", "That code isn't right.");
  await db.user.update({ where: { id: user.id }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodeHashes: [] } });
  await audit(user.id, null, "two_step.disabled");
  redirect("/account/two-step?ok=Two-step+sign-in+is+off");
}
