import type { Company } from "@prisma/client";
import { canUse, type AppRole } from "../auth/session";

/**
 * Whether a role manages Time Tracking (locations, settings, punch fixes) in this company: whoever
 * runs payroll there. In a managed (service bureau) company that is White Oak staff; in a
 * self-serve company it is also the owner. Changes are gated by requireWrite(companyId, "payroll").
 */
export function managesTime(role: AppRole | null, company: Pick<Company, "serviceMode">): boolean {
  return canUse(role, "payroll", company.serviceMode);
}
