import type { Company } from "@prisma/client";
import { canUse, type AppRole } from "../auth/session";

/**
 * Whether a role manages Time Tracking (locations, settings, punch fixes) in this company: whoever
 * runs payroll there. In a managed (service bureau) company that is White Oak staff; in a
 * self-serve company (Company.serviceMode, when present) it is also the owner.
 * Changes are still gated by requireWrite(companyId, "payroll").
 */
export function managesTime(role: AppRole | null, company: Pick<Company, "id">): boolean {
  if (canUse(role, "payroll")) return true;
  const mode = (company as { serviceMode?: string }).serviceMode;
  return mode === "SELF_SERVE" && role === "CLIENT_OWNER";
}
