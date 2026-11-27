import { db } from "@/lib/db";
import { canUse, requireArea } from "@/lib/auth/session";
import { Field, Notice, messages, prettyDate, usd } from "@/components/ui";
import type { LineDetail } from "@/lib/app/engine";
import { planConfig, submissionFiles } from "@/lib/app/retirement-service";
import {
  EMPLOYER_PRESETS,
  METHOD_LABEL,
  PLAN_TYPE_LABEL,
  PROVIDERS,
  eligibleFrom,
  provider,
  stateProgramFor,
  totalEmployee,
  totalEmployer,
  type ConnectionMethod,
  type PlanType,
} from "@/lib/retirement";
import { markSent, saveElection, savePlan, setPlanStatus, uploadElectionReport } from "./actions";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const pctStr = (r: number) => (r ? `${+(r * 100).toFixed(2)}` : "");
const STATUS_LABEL: Record<string, string> = { SETUP: "being set up", ACTIVE: "on pay runs", PAUSED: "paused", ENDED: "ended" };

export default async function Retirement({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { companyId } = await params;
  const { role, mode } = await requireArea(companyId, "reports");
  const canEdit = canUse(role, "settings", mode);
  const { error, ok } = await messages(searchParams);
  const [company, plans, employees] = await Promise.all([
    db.company.findUniqueOrThrow({ where: { id: companyId } }),
    db.retirementPlan.findMany({
      where: { companyId },
      include: { elections: true, submissions: { include: { payRun: true }, orderBy: { createdAt: "desc" }, take: 12 } },
      orderBy: { createdAt: "desc" },
    }),
    db.employee.findMany({ where: { companyId, status: { not: "TERMINATED" } }, orderBy: { lastName: "asc" } }),
  ]);
  const hidden = <input type="hidden" name="companyId" value={companyId} />;
  const current = plans.find((p) => p.status === "ACTIVE") ?? plans.find((p) => p.status === "SETUP") ?? null;
  const hasOwnPlan = plans.some((p) => p.status !== "ENDED" && p.planType !== "STATE_AUTO_IRA");

  // State auto-IRA mandates for the states people work in, if the company has no plan of its own.
  const workStates = [...new Set(employees.map((e) => e.workState))];
  const mandates = hasOwnPlan ? [] : workStates.map((s) => stateProgramFor(s)).filter((p) => !!p && !plans.some((x) => x.provider === p.key && x.status !== "ENDED"));

  // Year-to-date contributions per employee for the current plan.
  const year = new Date().getUTCFullYear();
  const ytd = new Map<string, { employee: number; employer: number; last: number }>();
  if (current) {
    const lines = await db.payRunLine.findMany({
      where: { payRun: { companyId, status: "PAID", payday: { gte: new Date(Date.UTC(year, 0, 1)) } } },
      select: { employeeId: true, detail: true, payRun: { select: { payday: true } } },
      orderBy: { payRun: { payday: "asc" } },
    });
    for (const l of lines) {
      const r = (l.detail as unknown as LineDetail | null)?.retirement;
      if (!r || r.planId !== current.id) continue;
      const t = ytd.get(l.employeeId) ?? { employee: 0, employer: 0, last: 0 };
      t.employee += totalEmployee(r);
      t.employer += totalEmployer(r);
      t.last = totalEmployee(r);
      ytd.set(l.employeeId, t);
    }
  }

  return (
    <>
      <h1>Retirement</h1>
      <p className="muted">
        Connect the company&apos;s 401(k), SIMPLE IRA or state retirement program. White Oak takes each person&apos;s savings out of every paycheck within the IRS limits,
        adds any employer match, and builds the file the provider needs after each payday.
      </p>
      <Notice error={error} ok={ok} />

      {mandates.length > 0 && (
        <div className="card">
          <p><b>State retirement programs that may apply</b></p>
          <ul className="small">
            {mandates.map((m) => (
              <li key={m!.key}><b>{m!.name}</b>: {m!.facts[0]}</li>
            ))}
            {workStates.includes("MA") && <li><b>Massachusetts</b> has no state program that private employers must join.</li>}
          </ul>
          <p className="small muted">A company that offers its own 401(k) or SIMPLE IRA is exempt; it usually has to certify that with the state program.</p>
        </div>
      )}

      {plans.length === 0 && <p>No retirement plan connected yet.</p>}

      {plans.map((p) => {
        const info = provider(p.provider);
        const method = p.connectionMethod as ConnectionMethod;
        const cfg = planConfig(p);
        return (
          <div className="card" key={p.id}>
            <p>
              <b>{p.name}</b> <span className="badge">{STATUS_LABEL[p.status] ?? p.status}</span>
              <br />
              <span className="small muted">
                {info.name} · {PLAN_TYPE_LABEL[p.planType as PlanType]}{p.planNumber ? ` · Plan / employer ID ${p.planNumber}` : ""}
              </span>
            </p>
            <h3>Connection</h3>
            <table>
              <tbody>
                <tr><th>How contributions get there</th><td>{METHOD_LABEL[method]}</td></tr>
                <tr><th>Status</th><td>{p.connectedAt ? `Working since ${prettyDate(p.connectedAt)} (first file uploaded)` : "Not confirmed yet: upload the first file after payday"}</td></tr>
                <tr><th>Automatic sending</th><td>{info.withPartnership.length ? `${info.withPartnership.map((m) => METHOD_LABEL[m]).join(" or ")}, once White Oak's partnership with ${info.name} is approved` : "Not offered"}</td></tr>
                {info.sponsorSite && <tr><th>Provider site</th><td><a href={info.sponsorSite} target="_blank" rel="noreferrer">{info.sponsorSite.replace(/^https:\/\//, "")}</a></td></tr>}
                <tr><th>Employer contribution</th><td>{p.planType === "STATE_AUTO_IRA" ? "None (state programs do not allow employer money)" : (EMPLOYER_PRESETS[p.employerPreset]?.label ?? "Custom") + (p.employerPreset === "custom" ? `: ${cfg.employer.tiers.map((t) => `${t.rate * 100}% of the next ${t.upTo * 100}%`).join(", ") || "no match"}${cfg.employer.nonelective ? ` + ${cfg.employer.nonelective * 100}% of pay` : ""}` : "")}</td></tr>
                <tr><th>Eligibility</th><td>{p.eligibilityDays ? `${p.eligibilityDays} days after hire` : "From hire"}, age {p.eligibilityMinAge}+{p.autoEnrollRate ? ` · auto-enrolls at ${pctStr(p.autoEnrollRate)}% unless someone opts out` : ""}</td></tr>
              </tbody>
            </table>
            <ul className="small muted">{info.facts.map((f) => <li key={f}>{f}</li>)}</ul>
            {canEdit && (
              <form action={setPlanStatus} className="actions">
                {hidden}
                <input type="hidden" name="planId" value={p.id} />
                {p.status !== "ACTIVE" && p.status !== "ENDED" && <button name="status" value="ACTIVE" type="submit">Turn on for pay runs</button>}
                {p.status === "ACTIVE" && <button name="status" value="PAUSED" type="submit" className="secondary">Pause</button>}
                {p.status !== "ENDED" && <button name="status" value="ENDED" type="submit" className="secondary">End this plan</button>}
              </form>
            )}
            {canEdit && p.status !== "ENDED" && (
              <details>
                <summary>Edit plan details</summary>
                <PlanForm companyId={companyId} plan={p} />
              </details>
            )}
          </div>
        );
      })}

      {canEdit && (
        <details className="card" open={plans.length === 0}>
          <summary><b>Connect a retirement plan</b></summary>
          <PlanForm companyId={companyId} />
        </details>
      )}

      {current && (
        <>
          <h2 id="elections">Who is saving, and how much</h2>
          <p className="small muted">
            {current.planType === "STATE_AUTO_IRA"
              ? "State programs keep each person's choice. Enter what the program shows, or upload its contribution rate report."
              : "Enter what each person chose on the provider's site, or upload the provider's deferral report to bring everyone's choices in at once."}
          </p>
          {canEdit && (
            <form action={uploadElectionReport} className="actions">
              {hidden}
              <input type="hidden" name="planId" value={current.id} />
              <input type="file" name="report" accept=".csv,text/csv" aria-label="Provider deferral report (CSV)" />
              <button type="submit" className="secondary">Import elections from the provider</button>
            </form>
          )}
          <table>
            <thead>
              <tr><th>Employee</th><th>Can save from</th><th>Choice</th><th className="num">Last check</th><th className="num">This year</th>{current.planType !== "STATE_AUTO_IRA" && <th className="num">Employer this year</th>}{canEdit && <th>Change</th>}</tr>
            </thead>
            <tbody>
              {employees.map((e) => {
                const el = current.elections.find((x) => x.employeeId === e.id);
                const from = eligibleFrom(planConfig(current), e.birthDate ? iso(e.birthDate) : "", iso(e.hireDate));
                const t = ytd.get(e.id);
                const choice = !el || el.status === "NOT_ENROLLED"
                  ? current.autoEnrollRate ? `Not chosen (default ${pctStr(current.autoEnrollRate)}%)` : "Not enrolled"
                  : el.status === "OPTED_OUT" ? "Opted out"
                  : [el.pretaxRate && `${pctStr(el.pretaxRate)}% pre-tax`, el.rothRate && `${pctStr(el.rothRate)}% Roth`, el.pretaxFlatCents && `${usd(el.pretaxFlatCents)} pre-tax`, el.rothFlatCents && `${usd(el.rothFlatCents)} Roth`].filter(Boolean).join(" + ") || "Enrolled, 0%";
                return (
                  <tr key={e.id}>
                    <td>{e.firstName} {e.lastName}</td>
                    <td>{from <= iso(new Date()) ? "Now" : from}</td>
                    <td>{choice}</td>
                    <td className="num">{t ? usd(t.last) : "—"}</td>
                    <td className="num">{t ? usd(t.employee) : "—"}</td>
                    {current.planType !== "STATE_AUTO_IRA" && <td className="num">{t ? usd(t.employer) : "—"}</td>}
                    {canEdit && (
                      <td>
                        <details>
                          <summary className="small">Edit</summary>
                          <form action={saveElection} className="form">
                            {hidden}
                            <input type="hidden" name="planId" value={current.id} />
                            <input type="hidden" name="employeeId" value={e.id} />
                            <Field label="Status">
                              <select name="status" defaultValue={el?.status ?? "ENROLLED"}>
                                <option value="ENROLLED">Enrolled</option>
                                <option value="OPTED_OUT">Opted out</option>
                                <option value="NOT_ENROLLED">Not chosen yet</option>
                              </select>
                            </Field>
                            <div className="row">
                              <Field label={current.planType === "STATE_AUTO_IRA" ? "Savings (% of pay)" : "Pre-tax (% of pay)"}><input name="pretaxPct" inputMode="decimal" defaultValue={pctStr(current.planType === "STATE_AUTO_IRA" ? el?.rothRate ?? 0 : el?.pretaxRate ?? 0)} /></Field>
                              {current.allowsRoth && current.planType !== "STATE_AUTO_IRA" && <Field label="Roth (% of pay)"><input name="rothPct" inputMode="decimal" defaultValue={pctStr(el?.rothRate ?? 0)} /></Field>}
                            </div>
                            <div className="row">
                              <Field label={current.planType === "STATE_AUTO_IRA" ? "Or flat $ per check" : "Pre-tax flat $ per check"}><input name="pretaxFlat" inputMode="decimal" defaultValue={el?.pretaxFlatCents ? (el.pretaxFlatCents / 100).toFixed(2) : ""} /></Field>
                              {current.allowsRoth && current.planType !== "STATE_AUTO_IRA" && <Field label="Roth flat $ per check"><input name="rothFlat" inputMode="decimal" defaultValue={el?.rothFlatCents ? (el.rothFlatCents / 100).toFixed(2) : ""} /></Field>}
                            </div>
                            <button type="submit">Save</button>
                          </form>
                        </details>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="small muted">
            IRS limits for {year} are applied automatically: $24,500 for 401(k) savings ($8,000 more at 50+, $11,250 at ages 60-63; catch-ups must be Roth for anyone paid over $150,000 here last year),
            $17,000 for SIMPLE IRAs, and $7,500 for state Roth IRAs ($1,100 more at 50+). Savings at another job are not visible to us.
          </p>
        </>
      )}

      {plans.some((p) => p.submissions.length > 0) && (
        <>
          <h2 id="files">Files for the provider</h2>
          <p className="small muted">
            Built automatically when a pay run is paid. Upload each file on the provider&apos;s site and send the money as they ask. Savings taken from paychecks must reach the plan quickly:
            the due date is 7 business days after payday (the Labor Department&apos;s safe harbor for small plans).
          </p>
          <table>
            <thead><tr><th>Payday</th><th>Plan</th><th className="num">Employee savings</th><th className="num">Employer</th><th>Due</th><th>Files</th><th>Status</th></tr></thead>
            <tbody>
              {plans.flatMap((p) => p.submissions.map((s) => (
                <tr key={s.id}>
                  <td>{prettyDate(s.payRun.payday)}</td>
                  <td>{provider(p.provider).name}</td>
                  <td className="num">{usd(s.employeeCents)}</td>
                  <td className="num">{usd(s.employerCents)}</td>
                  <td>{prettyDate(s.dueOn)}</td>
                  <td>{canEdit ? submissionFiles(s).map((f, i) => <div key={f.fileName}><a href={`/api/retirement/${s.id}/${i}`}>{f.fileName}</a> <span className="small muted">({f.rows} rows)</span></div>) : <span className="small muted">{submissionFiles(s).length} file(s)</span>}</td>
                  <td>
                    {s.status === "READY" ? (
                      canEdit ? (
                        <form action={markSent} className="actions">
                          {hidden}
                          <input type="hidden" name="submissionId" value={s.id} />
                          <input name="note" placeholder="Confirmation # (optional)" aria-label="Confirmation number" style={{ width: "10rem" }} />
                          <button type="submit" className="secondary">Mark uploaded</button>
                        </form>
                      ) : <span className="badge">waiting to upload</span>
                    ) : <span className="badge">{s.status.toLowerCase()}{s.sentAt ? ` ${prettyDate(s.sentAt)}` : ""}</span>}
                  </td>
                </tr>
              )))}
            </tbody>
          </table>
        </>
      )}
      <p className="small muted">{company.legalName} · Retirement contributions show on paystubs and on W-2 box 12 (code D, AA or S).</p>
    </>
  );
}

function PlanForm({ companyId, plan }: { companyId: string; plan?: { id: string; provider: string; planType: string; name: string; planNumber: string | null; allowsRoth: boolean; allowsCatchUp: boolean; simpleApplicable: boolean; employerPreset: string; employerFormula: unknown; autoEnrollRate: number; eligibilityDays: number; eligibilityMinAge: number } }) {
  const f = (plan?.employerFormula ?? {}) as { tiers?: { rate: number; upTo: number }[]; nonelective?: number };
  const t = f.tiers ?? [];
  return (
    <form action={savePlan} className="form">
      <input type="hidden" name="companyId" value={companyId} />
      {plan && <input type="hidden" name="planId" value={plan.id} />}
      <div className="row">
        <Field label="Provider">
          <select name="provider" defaultValue={plan?.provider ?? ""} required>
            <option value="" disabled>Choose</option>
            {PROVIDERS.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Plan type">
          <select name="planType" defaultValue={plan?.planType ?? "401K"}>
            {(Object.keys(PLAN_TYPE_LABEL) as PlanType[]).map((k) => <option key={k} value={k}>{PLAN_TYPE_LABEL[k]}</option>)}
          </select>
        </Field>
      </div>
      <div className="row">
        <Field label="Plan name" hint="As it appears on the provider's site"><input name="name" defaultValue={plan?.name ?? ""} /></Field>
        <Field label="Plan / contract number, or state employer ID"><input name="planNumber" defaultValue={plan?.planNumber ?? ""} /></Field>
      </div>
      <fieldset>
        <legend>Employee savings</legend>
        <label className="check"><input type="checkbox" name="allowsRoth" defaultChecked={plan?.allowsRoth ?? true} /> Plan allows Roth 401(k)</label>
        <label className="check"><input type="checkbox" name="allowsCatchUp" defaultChecked={plan?.allowsCatchUp ?? true} /> Plan allows catch-up savings at 50+</label>
        <label className="check"><input type="checkbox" name="simpleApplicable" defaultChecked={plan?.simpleApplicable ?? false} /> SIMPLE IRA: 25 or fewer employees (higher limits)</label>
        <div className="row">
          <Field label="Automatic enrollment (% of pay)" hint="Blank = none. OregonSaves 5%, MyCTSavings 3%."><input name="autoEnrollPct" inputMode="decimal" defaultValue={pctStr(plan?.autoEnrollRate ?? 0)} /></Field>
          <Field label="Wait after hire (days)" hint="State programs: 30-day opt-out window"><input name="eligibilityDays" type="number" min={0} defaultValue={plan?.eligibilityDays ?? 0} /></Field>
          <Field label="Minimum age"><input name="eligibilityMinAge" type="number" min={0} defaultValue={plan?.eligibilityMinAge ?? 18} /></Field>
        </div>
      </fieldset>
      <fieldset>
        <legend>Employer contribution (401(k) and SIMPLE only)</legend>
        <Field label="Formula">
          <select name="employerPreset" defaultValue={plan?.employerPreset ?? "none"}>
            {Object.entries(EMPLOYER_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Field>
        <p className="small muted">Custom match: for example 100% of the first 3% and 50% of the next 2%.</p>
        <div className="row">
          <Field label="Match %"><input name="matchRate1" inputMode="decimal" defaultValue={pctStr(t[0]?.rate ?? 0)} /></Field>
          <Field label="of the first % of pay"><input name="matchUpTo1" inputMode="decimal" defaultValue={pctStr(t[0]?.upTo ?? 0)} /></Field>
          <Field label="then match %"><input name="matchRate2" inputMode="decimal" defaultValue={pctStr(t[1]?.rate ?? 0)} /></Field>
          <Field label="of the next % of pay"><input name="matchUpTo2" inputMode="decimal" defaultValue={pctStr(t[1]?.upTo ?? 0)} /></Field>
          <Field label="Plus % of pay for everyone"><input name="nonelective" inputMode="decimal" defaultValue={pctStr(f.nonelective ?? 0)} /></Field>
        </div>
      </fieldset>
      <button type="submit">{plan ? "Save plan" : "Add plan"}</button>
    </form>
  );
}
