import { adminAllowed, isStaffEmail } from "./admins";
import { twoStepRequiredForStaff } from "./session";

interface LandingUser {
  email: string;
  isPlatformAdmin: boolean;
  totpEnabledAt: Date | null;
  memberships: { role: string }[];
  employee: unknown;
}

/** Where a person lands right after signing in. */
export function landingFor(u: LandingUser): string {
  const staff = isStaffEmail(u.email);
  const admin = u.isPlatformAdmin && adminAllowed(u.email);
  if ((staff || admin) && twoStepRequiredForStaff() && !u.totpEnabledAt) return "/account/two-step?required=1";
  if (staff) return "/ops";
  if (admin) return "/admin";
  if (u.memberships.length === 0 && u.employee) return "/me";
  return "/app";
}
