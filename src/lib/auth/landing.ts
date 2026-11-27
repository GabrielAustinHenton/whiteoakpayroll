import { adminAllowed, isStaffUser } from "./admins";
import { twoStepRequiredForStaff } from "./session";

interface LandingUser {
  email: string;
  isPlatformAdmin: boolean;
  totpEnabledAt: Date | null;
  memberships: { role: string }[];
  employee: unknown;
  staffStatus?: string | null;
}

/** Where a person lands right after signing in. */
export function landingFor(u: LandingUser): string {
  const staff = isStaffUser(u);
  const admin = u.isPlatformAdmin && adminAllowed(u.email);
  if ((staff || admin) && twoStepRequiredForStaff() && !u.totpEnabledAt) return "/account/two-step?required=1";
  if (staff) return "/ops";
  if (admin) return "/admin";
  if (u.memberships.length === 0 && u.employee) return "/me";
  // Asked to join as staff and not approved (yet): nothing else to show them.
  if (u.memberships.length === 0 && u.staffStatus) return "/staff/pending";
  return "/app";
}
