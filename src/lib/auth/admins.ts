/**
 * White Oak admin allowlist. Set ADMIN_EMAILS in the server environment to a comma-separated list
 * of staff emails (kept out of the repository). When it is set, only those emails can become or
 * stay admins. When it is unset, the older behavior applies: anyone with ADMIN_SETUP_TOKEN can.
 */
export function adminEmails(env: Record<string, string | undefined> = process.env): string[] | null {
  const raw = env.ADMIN_EMAILS?.trim();
  if (!raw) return null;
  return raw.split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function adminAllowed(email: string, env: Record<string, string | undefined> = process.env): boolean {
  const list = adminEmails(env);
  return list === null || list.includes(email.trim().toLowerCase());
}

/**
 * White Oak payroll staff (payroll operators, e.g. the person who enters every client's data and
 * runs payroll). Set STAFF_EMAILS to a comma-separated list; staff can work in every client
 * company but are not admins. Unset means no staff. Removing an email revokes access at once.
 */
export function staffEmails(env: Record<string, string | undefined> = process.env): string[] {
  const raw = env.STAFF_EMAILS?.trim();
  if (!raw) return [];
  return raw.split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function isStaffEmail(email: string, env: Record<string, string | undefined> = process.env): boolean {
  return staffEmails(env).includes(email.trim().toLowerCase());
}
