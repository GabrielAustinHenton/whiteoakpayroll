"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/session";
import { hashPassword, temporaryPassword } from "@/lib/auth/password";
import { normalizeEin, normalizeSsn } from "@/lib/app/ids";
import { checkPayFrequency, type LaunchState } from "@/lib/payroll/schedules";
import { canOfferAdvance } from "@/lib/payroll/advances";
import { approveAndPay, audit, voidCheck, createPayRun, generateFilings, recalculate, refreshInvoice } from "@/lib/app/payroll-service";
import { DEFAULT_HOURS, type Frequency } from "@/lib/app/periods";
import { cents, str } from "@/components/ui";

const go = (path: string, msg: { error?: string; ok?: string } = {}): never => {
  const q = msg.error ? `?error=${encodeURIComponent(msg.error)}` : msg.ok ? `?ok=${encodeURIComponent(msg.ok)}` : "";
  redirect(path + q);
};
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const id = (form: FormData) => str(form.get("companyId"));
const LAUNCH = ["CT", "MA", "OR", "NY"];

/* ---------- Company settings ---------- */

export async function updateCompany(form: FormData) {
  const companyId = id(form);
  const { user } = await requireArea(companyId, "settings");
  const ein = normalizeEin(str(form.get("ein")));
  if (ein.error) go(`/app/${companyId}/settings`, { error: ein.error });
  await db.company.update({
    where: { id: companyId },
    data: {
      legalName: str(form.get("legalName")),
      tradeName: str(form.get("tradeName")) || null,
      ein: ein.value!,
      addressLine1: str(form.get("addressLine1")),
      city: str(form.get("city")),
      state: str(form.get("state")),
      zip: str(form.get("zip")),
      depositSchedule: str(form.get("depositSchedule")) === "SEMIWEEKLY" ? "SEMIWEEKLY" : "MONTHLY",
    },
  });
  await audit(user.id, companyId, "company.updated");
  go(`/app/${companyId}/settings`, { ok: "Company details saved." });
}

export async function updateBank(form: FormData) {
  const companyId = id(form);
  const { user } = await requireArea(companyId, "settings");
  const routing = str(form.get("routing")).replace(/\D/g, "");
  const account = str(form.get("account")).replace(/\D/g, "");
  if (routing.length !== 9 || account.length < 4) go(`/app/${companyId}/settings`, { error: "Routing number is 9 digits; account number at least 4." });
  // Only the last 4 are stored until TD Bank holds the account (money movement is simulated).
  await db.company.update({ where: { id: companyId }, data: { bankName: str(form.get("bankName")) || "Bank", bankLast4: account.slice(-4) } });
  await audit(user.id, companyId, "company.bank_updated", { last4: account.slice(-4) });
  go(`/app/${companyId}/settings`, { ok: "Bank account saved (last 4 only; transfers are simulated)." });
}

export async function upsertStateAccount(form: FormData) {
  const companyId = id(form);
  const { user } = await requireArea(companyId, "settings");
  const state = str(form.get("state"));
  if (!LAUNCH.includes(state)) go(`/app/${companyId}/settings`, { error: "Choose CT, MA, OR or NY." });
  const ratePct = Number(str(form.get("suiRatePct")));
  if (!Number.isFinite(ratePct) || ratePct < 0 || ratePct > 15) go(`/app/${companyId}/settings`, { error: "Unemployment rate is a percent, for example 2.4." });
  const data = {
    withholdingAccount: str(form.get("withholdingAccount")) || null,
    unemploymentAccount: str(form.get("unemploymentAccount")) || null,
    suiRate: ratePct / 100,
    suiWageBaseCents: 0, // the engine uses each state's official wage base
    lessFrequentPayApproval: form.get("lessFrequentPayApproval") === "on",
    orTransitDistrict: state === "OR" ? str(form.get("orTransitDistrict")) || null : null,
  };
  await db.stateAccount.upsert({ where: { companyId_state: { companyId, state } }, create: { companyId, state, ...data }, update: data });
  await audit(user.id, companyId, "company.state_account", { state });
  go(`/app/${companyId}/settings`, { ok: `${state} account saved.` });
}

export async function createSchedule(form: FormData) {
  const companyId = id(form);
  const { user } = await requireArea(companyId, "settings");
  const frequency = str(form.get("frequency")) as Frequency;
  const anchor = str(form.get("anchorPayday"));
  if (!["WEEKLY", "BIWEEKLY", "SEMIMONTHLY", "MONTHLY"].includes(frequency) || !/^\d{4}-\d{2}-\d{2}$/.test(anchor))
    go(`/app/${companyId}/settings`, { error: "Choose how often you pay and the first payday." });
  await db.paySchedule.create({
    data: { companyId, name: str(form.get("name")) || "Regular", frequency, anchorPayday: day(anchor), payLagDays: Number(str(form.get("payLagDays")) || 5) },
  });
  await audit(user.id, companyId, "company.schedule_created", { frequency });
  go(`/app/${companyId}/settings`, { ok: "Pay schedule created." });
}

/* ---------- People ---------- */

function stateW4From(form: FormData, state: string): Prisma.InputJsonValue {
  const k = state.toLowerCase();
  const g = (name: string) => str(form.get(`s_${k}_${name}`));
  const on = (name: string) => form.get(`s_${k}_${name}`) === "on";
  const money = (name: string) => cents(form.get(`s_${k}_${name}`));
  switch (state) {
    case "CT": return on("exempt") ? { code: "E" } : g("code") ? { code: g("code"), additional: money("additional") } : {};
    case "MA": return { exemptions: Number(g("exemptions") || 0), headOfHousehold: on("headOfHousehold"), additional: money("additional"), exempt: on("exempt") };
    case "OR": return g("filingStatus") === "none" ? {} : { filingStatus: g("filingStatus") || "single", allowances: Number(g("allowances") || 0), additional: money("additional"), exempt: on("exempt") };
    case "NY": return { status: g("status") === "married" ? "married" : "single", allowances: Number(g("allowances") || 0), additionalState: money("additionalState"), nycResident: on("nycResident"), yonkersResident: on("yonkersResident"), exempt: on("exempt") };
    default: return {};
  }
}

function employeeFields(form: FormData) {
  const workState = str(form.get("workState"));
  const payBasis = str(form.get("payBasis")) === "SALARIED" ? "SALARIED" : "HOURLY";
  return {
    firstName: str(form.get("firstName")),
    lastName: str(form.get("lastName")),
    email: str(form.get("email")).toLowerCase(),
    birthDate: day(str(form.get("birthDate"))),
    hireDate: day(str(form.get("hireDate"))),
    addressLine1: str(form.get("addressLine1")),
    city: str(form.get("city")),
    state: str(form.get("homeState")),
    zip: str(form.get("zip")),
    workState,
    payBasis: payBasis as "SALARIED" | "HOURLY",
    payRateCents: cents(form.get("payRate")),
    nyManualWorker: form.get("nyManualWorker") === "on",
    w4FilingStatus: str(form.get("w4FilingStatus")) || "single",
    w4MultipleJobs: form.get("w4MultipleJobs") === "on",
    w4DependentsCents: cents(form.get("w4Dependents")),
    w4OtherIncomeCents: cents(form.get("w4OtherIncome")),
    w4DeductionsCents: cents(form.get("w4Deductions")),
    w4ExtraCents: cents(form.get("w4Extra")),
    w4Exempt: form.get("w4Exempt") === "on",
    stateW4: stateW4From(form, workState),
    i9CompletedAt: form.get("i9Done") === "on" ? new Date() : null,
    bankLast4: str(form.get("bankAccount")).replace(/\D/g, "").slice(-4) || null,
    paymentMethod: str(form.get("paymentMethod")) === "CHECK" ? "CHECK" : "DIRECT_DEPOSIT",
    retirementPretaxRate: Math.min(1, Math.max(0, Number(str(form.get("retirementPct")) || 0) / 100)),
    healthPremiumCents: cents(form.get("healthPremium")),
  };
}

async function validateEmployee(companyId: string, f: ReturnType<typeof employeeFields>, scheduleId: string, back: string) {
  if (!f.firstName || !f.lastName) go(back, { error: "First and last name are required." });
  if (!LAUNCH.includes(f.workState)) go(back, { error: "Work state must be CT, MA, OR or NY." });
  if (Number.isNaN(f.birthDate.getTime()) || Number.isNaN(f.hireDate.getTime())) go(back, { error: "Enter the birth date and hire date." });
  if (f.payRateCents <= 0) go(back, { error: "Enter the pay rate." });
  const schedule = await db.paySchedule.findFirst({ where: { id: scheduleId, companyId } });
  if (!schedule) go(back, { error: "Create a pay schedule first (Company settings)." });
  const acct = await db.stateAccount.findUnique({ where: { companyId_state: { companyId, state: f.workState } } });
  const freq = schedule!.frequency.toLowerCase() as "weekly";
  const check = checkPayFrequency(freq, {
    state: f.workState as LaunchState,
    payBasis: f.payBasis === "HOURLY" ? "hourly" : "salaried",
    nyManualWorker: f.nyManualWorker,
    ctLessFrequentApproval: acct?.lessFrequentPayApproval,
  });
  if (!check.allowed) go(back, { error: check.reason });
  return schedule!;
}

/** Status follows onboarding: active once the W-4/state form were reviewed and the I-9 is done. */
const statusFor = (f: { i9CompletedAt: Date | null }) => (f.i9CompletedAt ? "ACTIVE" : "ONBOARDING");

export async function createEmployee(form: FormData) {
  const companyId = id(form);
  const { user } = await requireArea(companyId, "people");
  const back = `/app/${companyId}/people/new`;
  const ssn = normalizeSsn(str(form.get("ssn")));
  if (ssn.error) go(back, { error: ssn.error });
  const f = employeeFields(form);
  const scheduleId = str(form.get("payScheduleId"));
  const schedule = await validateEmployee(companyId, f, scheduleId, back);
  const e = await db.employee.create({
    data: { ...f, companyId, payScheduleId: scheduleId, ssn: ssn.value!, status: statusFor(f), defaultHours: Number(str(form.get("defaultHours"))) || DEFAULT_HOURS[schedule.frequency as Frequency] },
  });
  await audit(user.id, companyId, "employee.created", { employeeId: e.id });
  go(`/app/${companyId}/people/${e.id}`, { ok: `${f.firstName} added.` });
}

export async function updateEmployee(form: FormData) {
  const companyId = id(form);
  const { user } = await requireArea(companyId, "people");
  const employeeId = str(form.get("employeeId"));
  const back = `/app/${companyId}/people/${employeeId}`;
  const existing = await db.employee.findFirstOrThrow({ where: { id: employeeId, companyId } });
  const f = employeeFields(form);
  const scheduleId = str(form.get("payScheduleId"));
  await validateEmployee(companyId, f, scheduleId, back);
  const ssnRaw = str(form.get("ssn"));
  const ssn = ssnRaw ? normalizeSsn(ssnRaw) : { value: existing.ssn };
  if ("error" in ssn && ssn.error) go(back, { error: ssn.error });
  await db.employee.update({
    where: { id: employeeId },
    data: {
      ...f,
      ssn: ssn.value!,
      payScheduleId: scheduleId,
      defaultHours: Number(str(form.get("defaultHours"))) || existing.defaultHours,
      i9CompletedAt: f.i9CompletedAt ? (existing.i9CompletedAt ?? f.i9CompletedAt) : null,
      status: existing.status === "TERMINATED" ? "TERMINATED" : statusFor(f),
    },
  });
  await audit(user.id, companyId, "employee.updated", { employeeId });
  go(back, { ok: "Saved." });
}

export async function terminateEmployee(form: FormData) {
  const companyId = id(form);
  const { user } = await requireArea(companyId, "people");
  const employeeId = str(form.get("employeeId"));
  const date = str(form.get("terminationDate"));
  await db.employee.update({
    where: { id: employeeId, companyId },
    data: { status: "TERMINATED", terminationDate: day(date), terminationReason: str(form.get("reason")) || null },
  });
  await audit(user.id, companyId, "employee.terminated", { employeeId, date });
  go(`/app/${companyId}/people/${employeeId}`, {
    ok: "Offboarded. Run their final pay on or before the state deadline (MA: same day if fired; CT: next business day if fired; OR: end of next business day; NY: next regular payday).",
  });
}

export async function rehireEmployee(form: FormData) {
  const companyId = id(form);
  await requireArea(companyId, "people");
  const employeeId = str(form.get("employeeId"));
  await db.employee.update({ where: { id: employeeId, companyId }, data: { status: "ONBOARDING", terminationDate: null, terminationReason: null, i9CompletedAt: null } });
  go(`/app/${companyId}/people/${employeeId}`, { ok: "Rehired. Complete a new I-9 if they left more than 3 years ago." });
}

/** Give an employee a portal login. The temporary password is shown once to the person inviting. */
export async function inviteEmployee(form: FormData) {
  const companyId = id(form);
  const { user } = await requireArea(companyId, "people");
  const employeeId = str(form.get("employeeId"));
  const e = await db.employee.findFirstOrThrow({ where: { id: employeeId, companyId } });
  const back = `/app/${companyId}/people/${employeeId}`;
  if (e.userId) go(back, { error: "They already have a login." });
  if (!e.email) go(back, { error: "Add their email first." });
  const pw = temporaryPassword();
  let u = await db.user.findUnique({ where: { email: e.email } });
  if (u) go(back, { error: "That email already has a White Oak login; use a different email for the employee portal." });
  u = await db.user.create({ data: { email: e.email, name: `${e.firstName} ${e.lastName}`, passwordHash: hashPassword(pw), memberships: { create: { companyId, role: "EMPLOYEE" } } } });
  await db.employee.update({ where: { id: employeeId }, data: { userId: u.id } });
  await audit(user.id, companyId, "employee.invited", { employeeId });
  go(back, { ok: `Portal login created for ${e.email}. Temporary password: ${pw} (shown once; they can change it under Account).` });
}

export async function createContractor(form: FormData) {
  const companyId = id(form);
  const { user } = await requireArea(companyId, "people");
  const back = `/app/${companyId}/people/contractors/new`;
  const tinType = str(form.get("tinType")) === "ein" ? "ein" : "ssn";
  const tin = tinType === "ein" ? normalizeEin(str(form.get("tin"))) : normalizeSsn(str(form.get("tin")));
  if (tin.error) go(back, { error: tin.error });
  const legalName = str(form.get("legalName"));
  if (!legalName) go(back, { error: "Legal name is required." });
  const k = await db.contractor.create({
    data: {
      companyId,
      legalName,
      businessName: str(form.get("businessName")) || null,
      email: str(form.get("email")).toLowerCase(),
      tinType,
      tin: tin.value!,
      addressLine1: str(form.get("addressLine1")),
      city: str(form.get("city")),
      state: str(form.get("state")),
      zip: str(form.get("zip")),
      w9ReceivedAt: form.get("w9") === "on" ? new Date() : null,
      bankLast4: str(form.get("bankAccount")).replace(/\D/g, "").slice(-4) || null,
      paymentMethod: str(form.get("paymentMethod")) === "CHECK" ? "CHECK" : "DIRECT_DEPOSIT",
    },
  });
  await audit(user.id, companyId, "contractor.created", { contractorId: k.id });
  go(`/app/${companyId}/people`, { ok: `${legalName} added as a contractor.` });
}

export async function setContractorStatus(form: FormData) {
  const companyId = id(form);
  await requireArea(companyId, "people");
  const status = str(form.get("status")) === "TERMINATED" ? "TERMINATED" : "ACTIVE";
  await db.contractor.update({ where: { id: str(form.get("contractorId")), companyId }, data: { status } });
  go(`/app/${companyId}/people`, { ok: status === "TERMINATED" ? "Contractor ended." : "Contractor reactivated." });
}

/* ---------- Pay runs ---------- */

export async function startPayRun(form: FormData) {
  const companyId = id(form);
  await requireArea(companyId, "payroll");
  const c = await db.company.findUniqueOrThrow({ where: { id: companyId }, include: { stateAccounts: true } });
  if (!c.bankLast4) go(`/app/${companyId}/payroll`, { error: "Add the funding bank account in Company settings first." });
  const states = await db.employee.findMany({ where: { companyId, status: { not: "TERMINATED" } }, distinct: ["workState"], select: { workState: true } });
  const missing = states.map((s) => s.workState).filter((s) => !c.stateAccounts.some((a) => a.state === s));
  if (missing.length) go(`/app/${companyId}/payroll`, { error: `Add your ${missing.join(", ")} state account and unemployment rate in Company settings first.` });
  const run = await createPayRun(companyId, str(form.get("payScheduleId")));
  go(`/app/${companyId}/payroll/${run.id}`);
}

export async function saveRunInputs(form: FormData) {
  const companyId = id(form);
  await requireArea(companyId, "payroll");
  const payRunId = str(form.get("payRunId"));
  const run = await db.payRun.findFirstOrThrow({ where: { id: payRunId, companyId }, include: { lines: true } });
  if (run.status !== "DRAFT") go(`/app/${companyId}/payroll/${payRunId}`, { error: "This pay run is already approved." });
  for (const l of run.lines) {
    const hours = form.get(`hours_${l.id}`);
    const include = form.get(`include_${l.id}`) === "on";
    if (!include) {
      await db.payRunLine.delete({ where: { id: l.id } });
      continue;
    }
    await db.payRunLine.update({
      where: { id: l.id },
      data: { hours: hours === null ? l.hours : Number(hours) || 0, bonusCents: cents(form.get(`bonus_${l.id}`)) },
    });
  }
  const contractorId = str(form.get("contractorId"));
  const amount = cents(form.get("contractorAmount"));
  if (contractorId && amount > 0) {
    await db.contractorPayment.create({ data: { contractorId, payRunId, amountCents: amount, memo: str(form.get("contractorMemo")) || null, paidOn: run.payday } });
  }
  await recalculate(payRunId);
  go(`/app/${companyId}/payroll/${payRunId}`, { ok: "Recalculated." });
}

export async function removeContractorPayment(form: FormData) {
  const companyId = id(form);
  await requireArea(companyId, "payroll");
  const payRunId = str(form.get("payRunId"));
  await db.contractorPayment.deleteMany({ where: { id: str(form.get("paymentId")), payRunId, payRun: { status: "DRAFT", companyId } } });
  await recalculate(payRunId);
  go(`/app/${companyId}/payroll/${payRunId}`);
}

export async function approveRun(form: FormData) {
  const companyId = id(form);
  const { user } = await requireArea(companyId, "payroll");
  const payRunId = str(form.get("payRunId"));
  if (form.get("confirm") !== "on") go(`/app/${companyId}/payroll/${payRunId}`, { error: "Tick the box to confirm the totals." });
  await db.payRun.findFirstOrThrow({ where: { id: payRunId, companyId } });
  try {
    await approveAndPay(payRunId, user.id);
  } catch (e) {
    go(`/app/${companyId}/payroll/${payRunId}`, { error: (e as Error).message });
  }
  go(`/app/${companyId}/payroll/${payRunId}`, { ok: "Approved. Paystubs are ready and the pay run counts toward this quarter's filings. (Bank transfers are simulated.)" });
}

export async function voidOrReissueCheck(form: FormData) {
  const companyId = id(form);
  const { user } = await requireArea(companyId, "payroll");
  const payRunId = str(form.get("payRunId"));
  const reissue = str(form.get("mode")) === "reissue";
  try {
    const n = await voidCheck(companyId, str(form.get("checkId")), str(form.get("reason")), reissue, user.id);
    go(`/app/${companyId}/payroll/${payRunId}`, { ok: n ? `Voided. Reissued as check ${n.number}; print it from "Print checks".` : "Check voided." });
  } catch (e) {
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    go(`/app/${companyId}/payroll/${payRunId}`, { error: (e as Error).message });
  }
}

export async function setNextCheckNumber(form: FormData) {
  const companyId = id(form);
  await requireArea(companyId, "settings");
  const n = Number(str(form.get("nextCheckNumber")));
  if (!Number.isInteger(n) || n < 1) go(`/app/${companyId}/settings`, { error: "Check number must be a whole number." });
  const used = await db.check.findFirst({ where: { companyId, number: { gte: n } } });
  if (used) go(`/app/${companyId}/settings`, { error: `Check ${used.number} was already printed; start after it.` });
  await db.company.update({ where: { id: companyId }, data: { nextCheckNumber: n } });
  go(`/app/${companyId}/settings`, { ok: `Next check number is ${n}.` });
}

export async function deleteDraftRun(form: FormData) {
  const companyId = id(form);
  await requireArea(companyId, "payroll");
  await db.payRun.deleteMany({ where: { id: str(form.get("payRunId")), companyId, status: "DRAFT" } });
  go(`/app/${companyId}/payroll`, { ok: "Draft deleted." });
}

/* ---------- Filings ---------- */

export async function generate(form: FormData) {
  const companyId = id(form);
  const { user } = await requireArea(companyId, "filings");
  const period = str(form.get("period"));
  try {
    const count = await generateFilings(companyId, period, user.id);
    go(`/app/${companyId}/filings`, count ? { ok: `${count} form${count === 1 ? "" : "s"} generated for ${period}.` } : { error: `Nothing was paid in ${period}, so there is nothing to file yet.` });
  } catch (e) {
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    go(`/app/${companyId}/filings`, { error: (e as Error).message });
  }
}

export async function markFiled(form: FormData) {
  const companyId = id(form);
  const { user } = await requireArea(companyId, "filings");
  await db.filing.update({ where: { id: str(form.get("filingId")), companyId }, data: { status: "filed", filedAt: new Date() } });
  await audit(user.id, companyId, "filing.marked_filed", { filingId: str(form.get("filingId")) });
  revalidatePath(`/app/${companyId}/filings`);
}

/* ---------- Advances ---------- */

export async function decideAdvance(form: FormData) {
  const companyId = id(form);
  const { user } = await requireArea(companyId, "advances");
  const advanceId = str(form.get("advanceId"));
  const approve = str(form.get("decision")) === "approve";
  const a = await db.advance.findFirstOrThrow({ where: { id: advanceId, employee: { companyId } }, include: { employee: true } });
  if (approve && !canOfferAdvance(a.employee.workState as LaunchState))
    go(`/app/${companyId}/advances`, { error: `Advances are not available for ${a.employee.workState} employees yet (Connecticut only until counsel signs off).` });
  await db.advance.update({ where: { id: advanceId }, data: { status: approve ? "ACTIVE" : "DECLINED", decidedAt: new Date() } });
  await audit(user.id, companyId, approve ? "advance.approved" : "advance.declined", { advanceId });
  go(`/app/${companyId}/advances`, { ok: approve ? "Approved. Paid with the next pay run (simulated) and repaid by deduction each pay run, at 0% interest." : "Declined." });
}

/* ---------- Billing ---------- */

export async function toggleAddOn(form: FormData) {
  const companyId = id(form);
  const { user } = await requireArea(companyId, "billing");
  const addOn = str(form.get("addOn")) === "PTO" ? "PTO" : "TIME_TRACKING";
  const existing = await db.companyModule.findUnique({ where: { companyId_addOn: { companyId, addOn } } });
  if (existing) await db.companyModule.delete({ where: { id: existing.id } });
  else await db.companyModule.create({ data: { companyId, addOn } });
  await audit(user.id, companyId, existing ? "addon.disabled" : "addon.enabled", { addOn });
  await refreshInvoice(companyId, new Date().toISOString().slice(0, 7));
  go(`/app/${companyId}/billing`, { ok: existing ? "Add-on turned off." : "Add-on turned on." });
}

/* ---------- Team ---------- */

export async function inviteTeammate(form: FormData) {
  const companyId = id(form);
  const { user } = await requireArea(companyId, "team");
  const back = `/app/${companyId}/team`;
  const email = str(form.get("email")).toLowerCase();
  const role = str(form.get("role")) === "CLIENT_OWNER" ? "CLIENT_OWNER" : "CLIENT_HR";
  if (!email) go(back, { error: "Enter an email." });
  let u = await db.user.findUnique({ where: { email } });
  let pw: string | null = null;
  if (!u) {
    pw = temporaryPassword();
    u = await db.user.create({ data: { email, name: str(form.get("name")) || email, passwordHash: hashPassword(pw) } });
  }
  await db.membership.upsert({ where: { userId_companyId: { userId: u.id, companyId } }, create: { userId: u.id, companyId, role }, update: { role } });
  await audit(user.id, companyId, "team.invited", { email, role });
  go(back, { ok: pw ? `Added ${email}. Temporary password: ${pw} (shown once).` : `Added ${email}; they sign in with their existing password.` });
}

export async function removeTeammate(form: FormData) {
  const companyId = id(form);
  const { user } = await requireArea(companyId, "team");
  const membershipId = str(form.get("membershipId"));
  const m = await db.membership.findFirstOrThrow({ where: { id: membershipId, companyId } });
  if (m.userId === user.id) go(`/app/${companyId}/team`, { error: "You can't remove yourself." });
  await db.membership.delete({ where: { id: membershipId } });
  go(`/app/${companyId}/team`, { ok: "Access removed." });
}
