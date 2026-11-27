import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { db } from "../db";
import { adminAllowed, isStaffEmail } from "./admins";

const COOKIE = "wo_session";
const DAYS = 14;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const cookieOpts = (expires: Date) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  expires,
});

/**
 * Start a session: random token in an httpOnly cookie, only its hash in the database. With
 * `mfaPending` the password was right but a two-step code is still owed: the session lasts 10
 * minutes and signs nobody in until `completeTwoStep` runs.
 */
export async function startSession(userId: string, opts: { mfaPending?: boolean } = {}) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + (opts.mfaPending ? 10 * 60_000 : DAYS * 86_400_000));
  await db.session.create({ data: { userId, tokenHash: sha256(token), expiresAt, mfaPending: !!opts.mfaPending } });
  (await cookies()).set(COOKIE, token, cookieOpts(expiresAt));
}

/** The half-finished sign-in waiting for a two-step code, if any. */
export async function pendingTwoStep() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const s = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!s || !s.mfaPending || s.expiresAt < new Date()) return null;
  return s;
}

/** The two-step code was right: turn the pending session into a full one. */
export async function completeTwoStep(sessionId: string) {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  const expiresAt = new Date(Date.now() + DAYS * 86_400_000);
  await db.session.update({ where: { id: sessionId }, data: { mfaPending: false, mfaAttempts: 0, expiresAt } });
  if (token) jar.set(COOKIE, token, cookieOpts(expiresAt));
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(COOKIE);
}

export async function currentUser() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const s = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { include: { memberships: true } } } });
  if (!s || s.mfaPending || s.expiresAt < new Date()) return null;
  // ADMIN_EMAILS, when set, is the allowlist: removing an email there revokes admin access at once.
  // STAFF_EMAILS lists White Oak payroll staff (operators); a login with a password is required.
  const admin = s.user.isPlatformAdmin && adminAllowed(s.user.email);
  const staff = Boolean(s.user.passwordHash) && isStaffEmail(s.user.email);
  // White Oak admins and staff can reach every client's SSNs and bank details, so until they turn
  // on two-step sign-in they get no White Oak access at all (only their own company, if any).
  const needsTwoStep = (admin || staff) && twoStepRequiredForStaff() && !s.user.totpEnabledAt;
  return {
    ...s.user,
    isPlatformAdmin: admin && !needsTwoStep,
    isStaff: staff && !needsTwoStep,
    needsTwoStep,
  };
}

/** On unless TWO_STEP_FOR_STAFF=off (e.g. a local dev database). */
export function twoStepRequiredForStaff(env: Record<string, string | undefined> = process.env): boolean {
  return (env.TWO_STEP_FOR_STAFF ?? "").trim().toLowerCase() !== "off";
}

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

export async function requireUser(): Promise<CurrentUser> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}

/**
 * Areas of a company account. White Oak runs payroll for its clients as a service bureau: staff
 * (payroll operators) enter everything; client owners and HR see reports and add employees.
 *   reports     view pay runs, paystubs, checks, tax filings and the White Oak bill
 *   add_people  see the people list and add a new employee
 * The rest are data entry and payroll work, for White Oak staff.
 */
export type Area = "dashboard" | "reports" | "add_people" | "people" | "payroll" | "filings" | "settings" | "billing" | "team" | "advances";

/** A membership role, or White Oak staff working across every client. */
export type AppRole = Role | "PAYROLL_OPERATOR";

const ALL: Area[] = ["dashboard", "reports", "add_people", "people", "payroll", "filings", "settings", "billing", "team", "advances"];
const AREAS: Record<Exclude<AppRole, "PLATFORM_ADMIN">, Area[]> = {
  PAYROLL_OPERATOR: ALL,
  CLIENT_OWNER: ["dashboard", "reports", "add_people"],
  CLIENT_HR: ["dashboard", "reports", "add_people"],
  EMPLOYEE: [],
};

export const ROLE_LABEL: Record<AppRole, string> = {
  PLATFORM_ADMIN: "White Oak admin",
  PAYROLL_OPERATOR: "White Oak payroll staff",
  CLIENT_OWNER: "Owner",
  CLIENT_HR: "HR",
  EMPLOYEE: "Employee",
};

/**
 * The caller's role in a company. An owner or HR membership wins (someone who also runs a company
 * uses it as its client); then White Oak payroll staff; then admins; else the membership role.
 */
export function roleIn(user: CurrentUser, companyId: string): AppRole | null {
  const m = user.memberships.find((x) => x.companyId === companyId)?.role ?? null;
  if (m === "CLIENT_OWNER" || m === "CLIENT_HR") return m;
  if (user.isStaff) return "PAYROLL_OPERATOR";
  if (user.isPlatformAdmin) return "PLATFORM_ADMIN";
  return m;
}

export function canUse(role: AppRole | null, area: Area): boolean {
  if (!role) return false;
  if (role === "PLATFORM_ADMIN") return true;
  return AREAS[role].includes(area);
}

/** White Oak staff or admin: works across every client company. */
export const isWhiteOak = (role: AppRole | null) => role === "PAYROLL_OPERATOR" || role === "PLATFORM_ADMIN";

/** Gate a White Oak payroll staff page (admins can look too). */
export async function requireStaff(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.needsTwoStep) redirect("/account/two-step?required=1");
  if (!user.isStaff && !user.isPlatformAdmin) redirect("/app");
  return user;
}

export async function requireArea(companyId: string, area: Area) {
  const user = await requireUser();
  const role = roleIn(user, companyId);
  if (!canUse(role, area)) redirect(role ? `/app/${companyId}` : "/app");
  return { user, role: role! };
}

const EDIT_COOKIE = "wo_admin_edit";

/** The company a White Oak admin has unlocked for changes this session, if any. */
export async function adminEditingCompany(): Promise<string | null> {
  return (await cookies()).get(EDIT_COOKIE)?.value ?? null;
}

/** Unlock (companyId) or relock (null) changes for an admin, for one hour at most. */
export async function setAdminEditing(companyId: string | null) {
  const jar = await cookies();
  if (!companyId) return jar.delete(EDIT_COOKIE);
  jar.set(EDIT_COOKIE, companyId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 3600,
  });
}

/** The page the request came from, when it is inside this company's app; else its overview. */
export async function sameCompanyReferer(companyId: string): Promise<string> {
  const fallback = `/app/${companyId}`;
  try {
    const path = new URL((await headers()).get("referer") ?? "").pathname;
    return path.startsWith(`${fallback}/`) || path === fallback ? path : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Gate an action that changes a company. Same as requireArea, except White Oak admins are
 * read-only unless they unlocked changes for this company (audited) from the admin banner.
 */
export async function requireWrite(companyId: string, area: Area) {
  const r = await requireArea(companyId, area);
  if (r.role === "PLATFORM_ADMIN" && (await adminEditingCompany()) !== companyId) {
    const back = await sameCompanyReferer(companyId);
    redirect(`${back}?error=${encodeURIComponent("You are viewing this company read-only. Turn on edit mode in the admin bar to make changes.")}`);
  }
  return r;
}

/** Gate a White Oak admin page. */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.needsTwoStep) redirect("/account/two-step?required=1");
  if (!user.isPlatformAdmin) redirect("/admin/claim");
  return user;
}
