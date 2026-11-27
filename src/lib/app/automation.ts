import { db } from "@/lib/db";
import { appUrl, sendEmail } from "@/lib/email";
import { featuresFor } from "./features";
import { audit, createPayRun } from "./payroll-service";
import { buildTodos, runsToPrepare, type Todo, type TodoFacts } from "./todos";
import type { Frequency } from "./periods";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Load what buildTodos needs for one company. */
export async function todoFacts(companyId: string, today = iso(new Date())): Promise<TodoFacts> {
  const [schedules, openRuns, employees, paid, filed] = await Promise.all([
    db.paySchedule.findMany({
      where: { companyId },
      include: { payRuns: { where: { offCycle: false, status: { not: "VOIDED" } }, orderBy: { payday: "desc" }, take: 1 } },
    }),
    db.payRun.findMany({ where: { companyId, status: { in: ["DRAFT", "APPROVED"] } } }),
    db.employee.findMany({ where: { companyId, status: "ONBOARDING" } }),
    db.payRun.findMany({ where: { companyId, status: "PAID" }, select: { payday: true }, distinct: ["payday"] }),
    db.filing.findMany({ where: { companyId, form: "941", status: "filed" }, select: { period: true } }),
  ]);
  return {
    today,
    schedules: schedules.map((s) => ({
      id: s.id,
      name: s.name,
      frequency: s.frequency as Frequency,
      anchorPayday: iso(s.anchorPayday),
      payLagDays: s.payLagDays,
      lastRegularPayday: s.payRuns[0] ? iso(s.payRuns[0].payday) : null,
    })),
    openRuns: openRuns.map((r) => ({ id: r.id, payScheduleId: r.payScheduleId, payday: iso(r.payday), status: r.status as "DRAFT" | "APPROVED", offCycle: r.offCycle })),
    employees: employees.map((e) => ({
      id: e.id,
      name: `${e.firstName} ${e.lastName}`,
      status: e.status,
      hireDate: iso(e.hireDate),
      selfOnboardingInvited: !!e.selfOnboardingInvitedAt,
      selfOnboardingDone: !!e.selfOnboardingDoneAt,
      i9Done: !!e.i9CompletedAt,
    })),
    paidQuarters: [...new Set(paid.map((r) => `${r.payday.getUTCFullYear()}-Q${Math.floor(r.payday.getUTCMonth() / 3) + 1}`))],
    filed941: filed.map((f) => f.period),
  };
}

export async function companyTodos(companyId: string, today?: string): Promise<Todo[]> {
  return buildTodos(await todoFacts(companyId, today));
}

/**
 * The daily job (GET /api/cron/daily). For self-serve companies:
 *  1. prepares a draft pay run a week before each regular payday (autoDraftPayroll), with
 *     salaried pay and hourly staff's usual hours filled in, ready for review;
 *  2. emails the owners one digest of reminders that just became due (payrollReminders),
 *     each reminder once (Reminder table).
 * Nothing is ever approved or paid automatically.
 */
export async function runDailyAutomation(now = new Date()) {
  const today = iso(now);
  const companies = await db.company.findMany({
    where: { serviceMode: "SELF_SERVE" },
    include: { memberships: { where: { role: "CLIENT_OWNER" }, include: { user: true } } },
  });
  const report = { companies: companies.length, drafted: 0, emailed: 0, errors: [] as string[] };
  for (const c of companies) {
    try {
      const f = featuresFor(c);
      let facts = await todoFacts(c.id, today);
      if (f.autoDraftPayroll && c.bankLast4) {
        for (const p of runsToPrepare(facts)) {
          const payable = await db.employee.count({ where: { companyId: c.id, payScheduleId: p.scheduleId, status: { in: ["ACTIVE", "ONBOARDING"] }, ssn: { not: "" } } });
          if (!payable) continue;
          const run = await createPayRun(c.id, p.scheduleId);
          await audit(null, c.id, "payrun.auto_drafted", { runId: run.id, payday: p.payday });
          report.drafted++;
        }
        facts = await todoFacts(c.id, today);
      }
      if (!f.payrollReminders) continue;
      const due = buildTodos(facts).filter((t) => t.remind);
      if (!due.length) continue;
      const sent = new Set((await db.reminder.findMany({ where: { companyId: c.id, key: { in: due.map((t) => t.key) } } })).map((r) => r.key));
      const fresh = due.filter((t) => !sent.has(t.key));
      if (!fresh.length) continue;
      const name = c.tradeName || c.legalName;
      let delivered = false;
      for (const m of c.memberships) {
        const r = await sendEmail(reminderEmail(m.user.email, m.user.name, name, c.id, fresh));
        delivered ||= r.sent;
      }
      if (delivered) {
        await db.reminder.createMany({ data: fresh.map((t) => ({ companyId: c.id, key: t.key })), skipDuplicates: true });
        report.emailed++;
      }
    } catch (e) {
      report.errors.push(`${c.id}: ${(e as Error).message}`);
    }
  }
  return report;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

export function reminderEmail(to: string, person: string, companyName: string, companyId: string, todos: Todo[]) {
  const base = `${appUrl()}/app/${companyId}`;
  const first = person.split(" ")[0] || person;
  const subject = todos.some((t) => t.urgent) ? `Action needed today for ${companyName} payroll` : `${companyName} payroll: ${todos.length === 1 ? todos[0].title : `${todos.length} things to do`}`;
  const text = [`Hi ${first},`, "", ...todos.flatMap((t) => [`- ${t.title}${t.detail ? `. ${t.detail}` : ""}`, `  ${base}${t.href}`]), "", "You get these because email reminders are on in Company settings."].join("\n");
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#1f2a24;max-width:560px">
<p style="margin:0 0 18px;font-weight:700;color:#2f5d3a">White Oak Payroll</p>
<p>Hi ${esc(first)},</p>
${todos.map((t) => `<p style="margin:0 0 14px"><a href="${esc(base + t.href)}" style="color:#2f5d3a;font-weight:600">${esc(t.title)}</a>${t.detail ? `<br>${esc(t.detail)}` : ""}</p>`).join("\n")}
<p style="margin:18px 0 0;font-size:12px;color:#6b756f">You get these because email reminders are on in Company settings.</p>
</div>`;
  return { to, subject, text, html };
}
