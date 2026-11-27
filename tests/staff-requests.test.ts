import { describe, expect, it } from "vitest";
import { isStaffUser } from "@/lib/auth/admins";
import { roleIn, staffCovers, type CurrentUser } from "@/lib/auth/session";
import { landingFor } from "@/lib/auth/landing";
import { adminRecipients, canDecide, canManageWorker } from "@/lib/app/staff-requests";

const user = (o: Partial<CurrentUser>): CurrentUser =>
  ({ id: "u", email: "w@example.com", isStaff: false, isPlatformAdmin: false, bureauCompanyIds: [], memberships: [], ...o }) as CurrentUser;

describe("staff access", () => {
  it("comes from STAFF_EMAILS or an approved request only", () => {
    const env = { STAFF_EMAILS: "olga@example.com" };
    expect(isStaffUser({ email: "OLGA@example.com" }, env)).toBe(true);
    expect(isStaffUser({ email: "new@example.com", staffStatus: "APPROVED" }, env)).toBe(true);
    for (const s of ["PENDING", "DENIED", "REMOVED", null]) expect(isStaffUser({ email: "new@example.com", staffStatus: s }, env)).toBe(false);
  });

  it("covers only the staff member's own bureau's companies", () => {
    const olga = user({ isStaff: true, bureauCompanyIds: ["jose-client"] });
    expect(staffCovers(olga, "jose-client")).toBe(true);
    expect(staffCovers(olga, "gabriel-client")).toBe(false);
    expect(roleIn(olga, "jose-client")).toBe("PAYROLL_OPERATOR");
    expect(roleIn(olga, "gabriel-client")).toBeNull();
  });

  it("gives staff with no bureau no company at all", () => {
    expect(roleIn(user({ isStaff: true }), "any")).toBeNull();
  });

  it("does not give a pending (not staff) worker anything", () => {
    expect(roleIn(user({ isStaff: false, bureauCompanyIds: ["jose-client"] }), "jose-client")).toBeNull();
  });

  it("keeps admins on every company", () => {
    expect(roleIn(user({ isPlatformAdmin: true }), "gabriel-client")).toBe("PLATFORM_ADMIN");
  });
});

describe("staff request decisions", () => {
  it("approves from waiting, denied or removed; denies only waiting; removes only approved", () => {
    expect(canDecide("PENDING", "APPROVED")).toBe(true);
    expect(canDecide("DENIED", "APPROVED")).toBe(true);
    expect(canDecide("REMOVED", "APPROVED")).toBe(true);
    expect(canDecide("APPROVED", "APPROVED")).toBe(false);
    expect(canDecide("PENDING", "DENIED")).toBe(true);
    expect(canDecide("APPROVED", "DENIED")).toBe(false);
    expect(canDecide("APPROVED", "REMOVED")).toBe(true);
    expect(canDecide("PENDING", "REMOVED")).toBe(false);
  });

  it("emails admins on the admin list, without duplicates", () => {
    const env = { ADMIN_EMAILS: "gabriel@example.com, jose@example.com" };
    expect(adminRecipients([{ email: "Gabriel@example.com" }, { email: "old@example.com" }], env).sort()).toEqual(["gabriel@example.com", "jose@example.com"]);
    expect(adminRecipients([{ email: "a@example.com" }], {})).toEqual(["a@example.com"]);
  });

  it("sends a waiting worker to the waiting page", () => {
    const base = { email: "new@example.com", isPlatformAdmin: false, totpEnabledAt: null, memberships: [], employee: null };
    expect(landingFor({ ...base, staffStatus: "PENDING" })).toBe("/staff/pending");
    expect(landingFor({ ...base, staffStatus: "DENIED" })).toBe("/staff/pending");
    expect(landingFor({ ...base, staffStatus: null })).toBe("/app");
  });
});

describe("bureau owners", () => {
  const jose = { id: "jose", isPlatformAdmin: false, isStaff: true, bureauOwner: true, bureauId: "savagge" };
  it("manage only their own bureau's staff, not themselves or another owner", () => {
    expect(canManageWorker(jose, { id: "w", bureauId: "savagge", bureauOwner: false })).toBe(true);
    expect(canManageWorker(jose, { id: "w", bureauId: "other", bureauOwner: false })).toBe(false);
    expect(canManageWorker(jose, { id: "w", bureauId: null, bureauOwner: false })).toBe(false);
    expect(canManageWorker(jose, { id: "jose", bureauId: "savagge", bureauOwner: true })).toBe(false);
    expect(canManageWorker(jose, { id: "o2", bureauId: "savagge", bureauOwner: true })).toBe(false);
  });
  it("lose the power when not approved staff, while admins keep it everywhere", () => {
    expect(canManageWorker({ ...jose, isStaff: false }, { id: "w", bureauId: "savagge", bureauOwner: false })).toBe(false);
    expect(canManageWorker({ ...jose, bureauOwner: false }, { id: "w", bureauId: "savagge", bureauOwner: false })).toBe(false);
    expect(canManageWorker({ id: "g", isPlatformAdmin: true, isStaff: false, bureauOwner: false, bureauId: null }, { id: "w", bureauId: "x", bureauOwner: true })).toBe(true);
  });
});
