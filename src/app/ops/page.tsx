import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth/session";
import { Field, Notice, StateSelect, messages, prettyDate } from "@/components/ui";
import { FREQUENCY_LABEL, nextPeriod, type Frequency } from "@/lib/app/periods";
import { testIdsOnly } from "@/lib/app/ids";
import { startPayRun } from "../app/[companyId]/actions";
import { addClientCompany } from "./actions";

export const metadata = { title: "Payroll desk · White Oak Payroll" };
export const dynamic = "force-dynamic";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const DAY = 86_400_000;

/** White Oak staff home: every client, what is due next, and one click into the hours grid. */
export default async function PayrollDesk({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireStaff();
  const { error, ok } = await messages(searchParams);
  const q = ((await searchParams).q ?? "").toString().trim().toLowerCase();
  const companies = await db.company.findMany({
    // Self-serve companies run their own payroll; the desk lists the clients White Oak runs.
    where: { serviceMode: "MANAGED" },
    orderBy: { legalName: "asc" },
    include: {
      paySchedules: { include: { payRuns: { where: { offCycle: false, status: { not: "VOIDED" } }, orderBy: { payday: "desc" }, take: 1 } } },
      payRuns: { where: { status: { in: ["DRAFT", "APPROVED"] } }, orderBy: { payday: "asc" } },
      _count: { select: { employees: { where: { status: { not: "TERMINATED" } } } } },
    },
  });
  type C = (typeof companies)[number];
  type Row = { c: C; name: string; schedule: C["paySchedules"][number] | null; next: ReturnType<typeof nextPeriod> | null; open: C["payRuns"][number] | null; due: number };
  const today = new Date(`${iso(new Date())}T00:00:00Z`).getTime();
  const rows = companies
    .filter((c) => !q || `${c.legalName} ${c.tradeName ?? ""}`.toLowerCase().includes(q))
    .flatMap((c): Row[] => {
      const name = c.tradeName || c.legalName;
      if (c.paySchedules.length === 0) return [{ c, name, schedule: null, next: null, open: null, due: Infinity }];
      return c.paySchedules.map((s) => {
        const open = c.payRuns.find((r) => r.payScheduleId === s.id) ?? null;
        const next = nextPeriod(s.frequency as Frequency, iso(s.anchorPayday), s.payLagDays, s.payRuns[0] ? iso(s.payRuns[0].payday) : null);
        const payday = open ? open.payday.getTime() : new Date(`${next.payday}T00:00:00Z`).getTime();
        return { c, name, schedule: s, next, open, due: Math.round((payday - today) / DAY) };
      });
    })
    .sort((a, b) => a.due - b.due || a.name.localeCompare(b.name));

  return (
    <>
      <h1>Payroll desk</h1>
      <p className="muted">Signed in as {user.name}. Every client, soonest payday first. Open a client to enter hours, approve, and print checks and paystubs.</p>
      <Notice error={error} ok={ok} />
      <form className="actions" method="get">
        <input name="q" defaultValue={q} placeholder="Find a client" aria-label="Find a client" style={{ width: "16rem" }} />
        <button type="submit" className="secondary">Search</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Client</th><th className="num">Employees</th><th>Schedule</th><th>Next payday</th><th>Pay run</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.c.id}-${r.schedule?.id ?? "none"}`}>
                <td><a href={`/app/${r.c.id}`}><b>{r.name}</b></a> <span className="small muted">{r.c.state}</span></td>
                <td className="num">{r.c._count.employees}</td>
                <td className="small">{r.schedule ? `${r.schedule.name} · ${FREQUENCY_LABEL[r.schedule.frequency as Frequency]}` : <a href={`/app/${r.c.id}/settings#schedules`}>Set up a pay schedule</a>}</td>
                <td>
                  {r.open ? prettyDate(r.open.payday) : r.next ? prettyDate(new Date(`${r.next.payday}T00:00:00Z`)) : ""}
                  {Number.isFinite(r.due) && (
                    <span className="small" style={{ color: r.due < 0 ? "var(--danger)" : undefined }}> {r.due < 0 ? `${-r.due} days late` : r.due === 0 ? "today" : `in ${r.due} days`}</span>
                  )}
                </td>
                <td>
                  {r.open ? (
                    <a href={`/app/${r.c.id}/payroll/${r.open.id}`}>{r.open.status === "DRAFT" ? "Continue hours" : "Approved, open"}</a>
                  ) : r.schedule ? (
                    <form action={startPayRun} className="inline">
                      <input type="hidden" name="companyId" value={r.c.id} />
                      <input type="hidden" name="payScheduleId" value={r.schedule.id} />
                      <button type="submit" className="secondary">Enter hours</button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="muted">{q ? "No client matches." : "No clients yet. Add the first one below."}</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Add a client company</h2>
      <p className="small muted">
        The client doesn&apos;t need to log in. After this you set up the bank account, state tax accounts and pay schedule, then enter the employees from their W-4 and I-9.
        To give the owner a login for reports, use Team access in the company.
      </p>
      {testIdsOnly() && <p className="notice">Preview: EINs must start with 00 (for example 00-1234567).</p>}
      <form action={addClientCompany} className="form">
        <div className="row">
          <Field label="Legal name"><input name="legalName" required /></Field>
          <Field label="Doing business as (optional)"><input name="tradeName" /></Field>
          <Field label="EIN"><input name="ein" required placeholder="00-1234567" /></Field>
        </div>
        <div className="row">
          <Field label="Street address"><input name="addressLine1" required /></Field>
          <Field label="City"><input name="city" required /></Field>
          <Field label="State"><StateSelect name="state" /></Field>
          <Field label="ZIP"><input name="zip" required pattern="\d{5}" /></Field>
        </div>
        <button type="submit">Add client</button>
      </form>
    </>
  );
}
