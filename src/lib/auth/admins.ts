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
