import type { Cents } from "../money";
import type { RetirementLine } from "./contributions";
import { totalEmployee } from "./contributions";
import type { ElectionStatus } from "./plans";

/**
 * Contribution and census files White Oak builds after each paid pay run.
 *
 * vestwell_180: Vestwell's "180 Integration Instructions for State Payroll Providers" (covers
 *   OregonSaves, MyCTSavings, MarylandSaves; nj.gov/treasury/securechoiceprogram/.../Vestwell_180Integration.pdf).
 *   Field order and file names follow that PDF. The PDF does not say whether a header row is
 *   expected; the OregonSaves upload screen detects or maps headers, so we include one.
 *   Program code in the file name is the state (OR, CT, NY): confirm with Vestwell.
 * white_oak_standard: our own census + contribution layout with the columns recordkeepers ask
 *   for (SSN, name, dates, pay, hours, each source of money). Upload it on the recordkeeper's site
 *   and map the columns once; when a partner spec arrives, add a writer next to this one.
 */

export interface ContributionRow {
  employeeId: string;
  firstName: string;
  lastName: string;
  middleInitial?: string;
  ssn: string;
  birthDate: string;
  hireDate: string;
  terminationDate?: string | null;
  address: { line1: string; city: string; state: string; zip: string };
  email?: string;
  gross: Cents;
  hours: number | null;
  ytdGross: Cents;
  retirement: RetirementLine;
  electionStatus: ElectionStatus;
}

export interface RunInfo {
  ein: string;
  payday: string;
  periodStart: string;
  periodEnd: string;
  /** Pay group / schedule name ("Division" in the Vestwell layout). */
  payGroup: string;
}

export interface BuiltFile {
  fileName: string;
  content: string;
  rows: number;
  employeeCents: Cents;
  employerCents: Cents;
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: (string | number)[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
const dollars = (c: Cents) => (c / 100).toFixed(2);
const digits = (s: string) => s.replace(/\D/g, "");
const mdy = (iso?: string | null) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : "");
const stamp = (d: Date) => d.toISOString().replace(/\D/g, "").slice(0, 14);

/** Vestwell 180 payroll contributions file: one row per person with a contribution this payday. */
export function vestwell180Contributions(program: string, run: RunInfo, rows: ContributionRow[], now = new Date()): BuiltFile {
  const ein = digits(run.ein);
  const paying = rows.filter((r) => totalEmployee(r.retirement) > 0);
  const body = paying.map((r) => [r.lastName, r.firstName, digits(r.ssn), dollars(totalEmployee(r.retirement)), r.employeeId, run.payGroup]);
  return {
    fileName: `${program}_${ein}_${run.payday}_${stamp(now)}.csv`,
    content: csv([["Last Name", "First Name", "Social Security Number", "Contribution amount", "UID", "Division"], ...body]),
    rows: paying.length,
    employeeCents: paying.reduce((s, r) => s + totalEmployee(r.retirement), 0),
    employerCents: 0,
  };
}

/** Vestwell 180 employee roster ("new employee") file, for people the program does not have yet. */
export function vestwell180Roster(program: string, ein: string, rows: ContributionRow[], now = new Date()): BuiltFile {
  const header = [
    "Social Security Number", "First Name", "Middle Initials", "Last Name", "Date of Birth",
    "Physical Address Line 1", "Physical Address Line 2", "Physical City", "Physical State", "Physical ZIP Code",
    "Primary Phone", "Email Address", "Mailing Address Line 1", "Mailing Address Line 2", "Mailing City", "Mailing State", "Mailing ZIP Code", "UID",
  ];
  const body = rows.map((r) => [
    digits(r.ssn), r.firstName, r.middleInitial ?? "", r.lastName, mdy(r.birthDate),
    r.address.line1.slice(0, 64), "", r.address.city.slice(0, 64), r.address.state, digits(r.address.zip),
    "", r.email ?? "", "", "", "", "", "", r.employeeId,
  ]);
  return { fileName: `${program}_${digits(ein)}_newemployee_${stamp(now)}.csv`, content: csv([header, ...body]), rows: rows.length, employeeCents: 0, employerCents: 0 };
}

/** White Oak's standard census and contribution file: everyone on the pay run, contributing or not. */
export function whiteOakStandardFile(providerKey: string, run: RunInfo, rows: ContributionRow[]): BuiltFile {
  const header = [
    "SSN", "First Name", "Last Name", "Date of Birth", "Hire Date", "Termination Date", "Address", "City", "State", "ZIP", "Email",
    "Pay Date", "Period Start", "Period End", "Gross Pay", "Plan Compensation", "Hours", "YTD Gross Pay",
    "Pre-tax Deferral", "Roth Deferral", "Pre-tax Catch-up", "Roth Catch-up", "Employer Match", "Employer Nonelective", "Loan Repayment", "Election Status",
  ];
  const body = rows.map((r) => {
    const x = r.retirement;
    return [
      digits(r.ssn), r.firstName, r.lastName, mdy(r.birthDate), mdy(r.hireDate), mdy(r.terminationDate), r.address.line1, r.address.city, r.address.state, r.address.zip, r.email ?? "",
      mdy(run.payday), mdy(run.periodStart), mdy(run.periodEnd), dollars(r.gross), dollars(x.planComp), r.hours ?? "", dollars(r.ytdGross),
      dollars(x.pretax), dollars(x.roth), dollars(x.catchUpPretax), dollars(x.catchUpRoth), dollars(x.employerMatch), dollars(x.employerNonelective), "0.00", r.electionStatus.toLowerCase(),
    ];
  });
  return {
    fileName: `whiteoak_${providerKey}_${digits(run.ein)}_${run.payday}.csv`,
    content: csv([header, ...body]),
    rows: rows.length,
    employeeCents: rows.reduce((s, r) => s + totalEmployee(r.retirement), 0),
    employerCents: rows.reduce((s, r) => s + r.retirement.employerMatch + r.retirement.employerNonelective, 0),
  };
}

/* ---------- Elections coming back from the provider ---------- */

export interface ImportedElection {
  ssn: string;
  status: ElectionStatus;
  pretaxRate: number;
  rothRate: number;
}

function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim())) out.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) out.push(row);
  return out;
}

const pct = (s: string | undefined) => {
  if (!s) return 0;
  const raw = s.trim();
  const n = Number(raw.replace(/[%\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return 0;
  // "5", "5%" and "1" are percents; only a decimal under 1 without a % sign ("0.05") is a fraction.
  const fraction = !raw.includes("%") && raw.includes(".") && n < 1;
  return fraction ? n : Math.min(n, 100) / 100;
};

/**
 * Read a deferral / election report exported from the provider's site (CSV). Column names vary,
 * so we look for an SSN column and columns whose names mention pre-tax / Roth / status.
 */
export function readElectionReport(text: string): { elections: ImportedElection[]; problems: string[] } {
  const rows = parseCsv(text);
  const problems: string[] = [];
  if (rows.length < 2) return { elections: [], problems: ["The file has no data rows."] };
  const head = rows[0].map((h) => h.toLowerCase().replace(/[^a-z0-9%]/g, ""));
  const find = (...keys: string[]) => head.findIndex((h) => keys.some((k) => h.includes(k)));
  const iSsn = find("ssn", "socialsecurity", "taxid");
  const iRoth = find("roth");
  const iPre = head.findIndex((h, i) => i !== iRoth && (h.includes("pretax") || h.includes("beforetax") || h.includes("traditional") || h === "deferral" || h.includes("deferral%") || h.includes("deferralpercent") || h.includes("contributionrate") || h.includes("savingsrate")));
  const iStatus = find("status", "optout", "enroll");
  if (iSsn < 0) return { elections: [], problems: ["No SSN column found."] };
  if (iPre < 0 && iRoth < 0) problems.push("No pre-tax or Roth percent column found; only statuses were read.");
  const elections: ImportedElection[] = [];
  for (const [n, r] of rows.slice(1).entries()) {
    const ssn = (r[iSsn] ?? "").replace(/\D/g, "");
    if (ssn.length !== 9) { problems.push(`Row ${n + 2}: SSN is not 9 digits.`); continue; }
    const pretaxRate = iPre >= 0 ? pct(r[iPre]) : 0;
    const rothRate = iRoth >= 0 ? pct(r[iRoth]) : 0;
    const st = (r[iStatus] ?? "").toLowerCase();
    const status: ElectionStatus = /opt|declin|waiv/.test(st) ? "OPTED_OUT" : pretaxRate + rothRate > 0 || /enroll|active|yes/.test(st) ? "ENROLLED" : "NOT_ENROLLED";
    elections.push({ ssn, status, pretaxRate, rothRate });
  }
  return { elections, problems };
}
