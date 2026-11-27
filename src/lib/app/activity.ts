import { formatUSD } from "../money";

/**
 * Plain-English activity log for a company, from AuditLog rows. Pure, so it's easy to test and
 * new audit actions only need a line in ACTIONS.
 */

export type ActivityCategory = "payroll" | "people" | "filings" | "settings" | "access";

export const CATEGORY_LABEL: Record<ActivityCategory, string> = {
  payroll: "Payroll",
  people: "People",
  filings: "Tax filings",
  settings: "Company settings",
  access: "Logins and White Oak access",
};

type Detail = Record<string, unknown>;
type Names = { employees: Map<string, string>; contractors: Map<string, string> };

const s = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const money = (v: unknown) => (typeof v === "number" ? formatUSD(v) : typeof v === "string" && v ? formatUSD(Math.round(Number(v) * 100)) : "");
const emp = (d: Detail, n: Names) => n.employees.get(s(d.employeeId)) ?? "an employee";

const ROLE_NAME: Record<string, string> = { CLIENT_OWNER: "an owner", CLIENT_HR: "HR", EMPLOYEE: "an employee" };

/** "Approved a pay run" → "approved a pay run", to follow a name. Leaves "OR", "W-2" alone. */
export const afterName = (text: string) => (/^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text);

const ACTIONS: Record<string, { category: ActivityCategory; text: (d: Detail, n: Names) => string }> = {
  "company.signup": { category: "settings", text: () => "Created the company account" },
  "company.created_by_staff": { category: "settings", text: () => "White Oak set up the company account" },
  "company.updated": { category: "settings", text: () => "Updated company details" },
  "company.bank_updated": { category: "settings", text: (d) => `Changed the payroll bank account${d.last4 ? ` (now ending ${s(d.last4)})` : ""}` },
  "company.state_account": { category: "settings", text: (d) => `Saved the ${s(d.state)} tax account` },
  "company.schedule_created": { category: "settings", text: (d) => `Created a ${s(d.frequency).toLowerCase().replace("_", "-")} pay schedule` },
  "addon.enabled": { category: "settings", text: (d) => `Turned on add-on ${s(d.addOn).toLowerCase().replace(/_/g, " ")}` },
  "addon.disabled": { category: "settings", text: (d) => `Turned off add-on ${s(d.addOn).toLowerCase().replace(/_/g, " ")}` },
  "employee.created": { category: "people", text: (d, n) => `Added ${emp(d, n)}` },
  "employee.updated": { category: "people", text: (d, n) => `Updated ${emp(d, n)}` },
  "employee.terminated": { category: "people", text: (d, n) => `Ended employment for ${emp(d, n)}${d.date ? ` on ${s(d.date)}` : ""}` },
  "contractor.created": { category: "people", text: (d, n) => `Added contractor ${n.contractors.get(s(d.contractorId)) ?? ""}`.trim() },
  "payrun.hours_imported": { category: "payroll", text: (d) => `Imported hours from ${s(d.file) || "a file"}${typeof d.filled === "number" ? ` (${d.filled} people)` : ""}` },
  "payrun.approved": { category: "payroll", text: (d) => `Approved a pay run${d.cashNeededCents != null ? ` (${money(d.cashNeededCents)} total)` : ""}` },
  "check.voided": { category: "payroll", text: (d) => `Voided check ${s(d.number)}${d.reason ? `: ${s(d.reason)}` : ""}` },
  "check.reissued": { category: "payroll", text: (d) => `Reissued check ${s(d.number)}${d.reason ? `: ${s(d.reason)}` : ""}` },
  "advance.requested": { category: "payroll", text: (d) => `Requested a payday advance${d.amount ? ` of ${money(d.amount)}` : ""}` },
  "advance.recorded": { category: "payroll", text: (d, n) => `Recorded an advance for ${emp(d, n)}${d.amount ? ` (${money(d.amount)})` : ""}` },
  "advance.approved": { category: "payroll", text: () => "Approved a payday advance" },
  "advance.declined": { category: "payroll", text: () => "Declined a payday advance" },
  "filings.generated": { category: "filings", text: (d) => `Prepared ${Array.isArray(d.forms) ? (d.forms as unknown[]).map(s).join(", ") : "tax forms"}${d.period ? ` for ${s(d.period)}` : ""}` },
  "filing.marked_filed": { category: "filings", text: () => "Marked a tax form as filed" },
  "report.downloaded": { category: "filings", text: (d) => `Downloaded the ${s(d.kind).replace(/-/g, " ")} report${d.period ? ` for ${s(d.period)}` : ""}` },
  "team.invited": { category: "access", text: (d) => `Invited ${s(d.email)}${d.role ? ` as ${ROLE_NAME[s(d.role)] ?? s(d.role).toLowerCase()}` : ""}` },
  "invite.accepted": { category: "access", text: () => "Accepted an invite and set a password" },
  "admin.viewed": { category: "access", text: () => "Viewed this account as a White Oak admin (read-only)" },
  "admin.edit_started": { category: "access", text: (d) => `Turned on White Oak admin edit mode${d.reason ? `: "${s(d.reason)}"` : ""}` },
  "admin.edit_stopped": { category: "access", text: () => "Turned off White Oak admin edit mode" },
};

export interface ActivityRow {
  id: string;
  createdAt: Date;
  actorName: string;
  category: ActivityCategory;
  text: string;
}

export function describeActivity(
  e: { id: string; createdAt: Date; action: string; detail: unknown; actorId: string | null },
  actors: Map<string, string>,
  names: Names,
): ActivityRow {
  const a = ACTIONS[e.action];
  const d = (e.detail && typeof e.detail === "object" ? e.detail : {}) as Detail;
  return {
    id: e.id,
    createdAt: e.createdAt,
    actorName: e.actorId ? actors.get(e.actorId) ?? "Someone (login removed)" : "White Oak (automatic)",
    category: a?.category ?? "settings",
    text: a ? a.text(d, names) : e.action.replace(/[._]/g, " "),
  };
}

/** The audit actions in a category, for filtering in the database. */
export function actionsIn(category: ActivityCategory): string[] {
  return Object.entries(ACTIONS).filter(([, v]) => v.category === category).map(([k]) => k);
}

export const isCategory = (v: string | undefined): v is ActivityCategory => !!v && v in CATEGORY_LABEL;
