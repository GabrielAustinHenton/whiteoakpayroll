import { db } from "../db";
import { adminAllowed, adminEmails } from "../auth/admins";
import { appUrl, buttonEmail, sendEmail, type SendResult } from "../email";

/**
 * Requests to join White Oak as payroll staff. Someone asks at /staff/join; an admin approves or
 * denies on /admin. Approved staff get the same access as STAFF_EMAILS (see isStaffUser).
 */

/** Who to tell about a new request: admin logins still on the admin list, plus ADMIN_EMAILS. */
export function adminRecipients(admins: { email: string }[], env: Record<string, string | undefined> = process.env): string[] {
  const out = new Set<string>();
  for (const a of admins) if (adminAllowed(a.email, env)) out.add(a.email.toLowerCase());
  for (const e of adminEmails(env) ?? []) out.add(e);
  return [...out];
}

/**
 * Email whoever can approve: every admin, plus the owners of the bureau they asked to join (who
 * get a link to their own team page). Best effort.
 */
export async function notifyOfRequest(worker: { name: string; email: string; note: string | null }, bureau: { id: string; name: string } | null): Promise<SendResult[]> {
  const [admins, owners] = await Promise.all([
    db.user.findMany({ where: { isPlatformAdmin: true }, select: { email: true } }),
    bureau ? db.user.findMany({ where: { bureauId: bureau.id, bureauOwner: true, staffStatus: "APPROVED" }, select: { email: true } }) : [],
  ]);
  const adminTo = adminRecipients(admins);
  const to = [
    ...adminTo.map((email) => ({ email, url: `${appUrl()}/admin#staff-requests` })),
    ...owners.filter((o) => !adminTo.includes(o.email.toLowerCase())).map((o) => ({ email: o.email, url: `${appUrl()}/ops/team` })),
  ];
  return Promise.all(
    to.map(({ email: to, url }) =>
      sendEmail(
        buttonEmail({
          to,
          subject: `${worker.name} asked to join ${bureau?.name ?? "White Oak"} as payroll staff`,
          lines: [
            `${worker.name} (${worker.email}) asked to join ${bureau ? bureau.name : "White Oak Payroll"} as payroll staff.`,
            ...(worker.note ? [`They wrote: "${worker.note}"`] : []),
            `If you approve, they can open ${bureau ? `${bureau.name}'s` : "their bureau's"} clients, enter employees and hours, and run payroll. Until then they have no access.`,
          ],
          button: "Review the request",
          url,
        }),
      ),
    ),
  );
}

/** Tell the worker an admin approved them. */
export function emailApproved(worker: { name: string; email: string }) {
  return sendEmail(
    buttonEmail({
      to: worker.email,
      subject: "You're approved as White Oak payroll staff",
      lines: [
        `Hi ${worker.name.split(" ")[0] || worker.name},`,
        "An administrator approved your request. You can now sign in and work from the payroll desk.",
        "The first time you sign in, you'll set up two-step sign-in with an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password or Authy). It takes about a minute.",
      ],
      button: "Sign in",
      url: `${appUrl()}/login`,
    }),
  );
}

/** Tell the worker their request was not approved. */
export function emailDenied(worker: { name: string; email: string }) {
  return sendEmail(
    buttonEmail({
      to: worker.email,
      subject: "Your White Oak payroll staff request",
      lines: [
        `Hi ${worker.name.split(" ")[0] || worker.name},`,
        "Your request to join White Oak Payroll as payroll staff was not approved. If you think this is a mistake, reply to the person at White Oak who asked you to sign up.",
      ],
      button: "White Oak Payroll",
      url: appUrl(),
    }),
  );
}

export const STAFF_STATUS_LABEL = {
  PENDING: "Waiting for approval",
  APPROVED: "Approved",
  DENIED: "Not approved",
  REMOVED: "Access removed",
} as const;

export type StaffStatus = keyof typeof STAFF_STATUS_LABEL;

/**
 * Which decisions an admin can make from each state: approve a waiting, denied or removed person;
 * deny only someone waiting; remove only someone approved.
 */
export function canDecide(from: StaffStatus, to: "APPROVED" | "DENIED" | "REMOVED"): boolean {
  if (to === "APPROVED") return from !== "APPROVED";
  if (to === "DENIED") return from === "PENDING";
  return from === "APPROVED";
}

/**
 * Whether a manager may decide on this person: admins on anyone; a bureau owner only on people in
 * (or asking to join) their own bureau, never on themselves or another owner.
 */
export function canManageWorker(
  manager: { id: string; isPlatformAdmin: boolean; isStaff: boolean; bureauOwner: boolean; bureauId: string | null },
  worker: { id: string; bureauId: string | null; bureauOwner: boolean },
): boolean {
  if (manager.isPlatformAdmin) return true;
  if (!manager.isStaff || !manager.bureauOwner || !manager.bureauId) return false;
  return worker.id !== manager.id && !worker.bureauOwner && worker.bureauId === manager.bureauId;
}
