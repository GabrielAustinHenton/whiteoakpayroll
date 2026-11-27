"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Prisma, ServiceMode } from "@prisma/client";
import { db } from "@/lib/db";
import { canUse, requireWrite, type AppRole } from "@/lib/auth/session";
import { inviteEmployeeLogin, inviteTeammateLogin } from "@/lib/app/invites";
import { normalizeEin, normalizeSsn } from "@/lib/app/ids";
import { checkPayFrequency, type LaunchState } from "@/lib/payroll/schedules";
import { canOfferAdvance } from "@/lib/payroll/advances";
import { approveAndPay, audit, voidCheck, createPayRun, generateFilings, recalculate, refreshInvoice } from "@/lib/app/payroll-service";
import { DEFAULT_HOURS, type Frequency } from "@/lib/app/periods";
import { nameKey, readTimeExport } from "@/lib/app/time-import";
import { stateW4From, w4From } from "@/lib/app/employee-input";
import { FEATURE_KEYS, featureOverrides, featuresFor, type Features } from "@/lib/app/features";
import { cents, str, usd } from "@/components/ui";

const go = (path: string, msg: { error?: string; ok?: string } = {}): never => {
  const q = msg.error ? `?error=${encodeURIComponent(msg.error)}` : msg.ok ? `?ok=${encodeURIComponent(msg.ok)}` : "";
  redirect(path + q);
};
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const id = (form: FormData) => str(form.get("companyId"));
const LAUNCH = ["CT", "MA", "OR", "NY"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Where a settings form returns to: the setup wizard passes returnTo; else Company settings. */
const page = (form: FormData, companyId: string) => {
  const r = str(form.get("returnTo")).split("?")[0];
  return r.startsWith(`/app/${companyId}/`) && !r.includes("//") ? r : `/app/${companyId}/settings`;
};
const thisMonth = () => new Date().toISOString().slice(0, 7);
const companyName = async (companyId: string) => {
  const c = await db.company.findUniqueOrThrow({ where: { id: companyId } });
  return c.tradeName || c.legalName;
};

/** Headcount changed: update this month's bill and, for people who can see billing, say what it is now. */
async function feeNote(companyId: string, role: AppRole, mode: ServiceMode) {
  const bill = await refreshInvoice(companyId, thisMonth());
  if (!canUse(role, "billing", mode)) return "";
  return ` White Oak fee this month: ${usd(bill.total)} (${bill.peopleCount} ${bill.peopleCount === 1 ? "person" : "people"}).`;
}


/* ---------- Company settings ---------- */

export async function updateCompany(form: FormData) {
  const companyId = id(form);
  const { user } = await requireWrite(companyId, "settings");
  const ein = normalizeEin(str(form.get("ein")));
  if (ein.error) go(page(form, companyId), { error: ein.error });
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
  go(page(form, companyId), { ok: "Company details saved." });
}

export async function updateBank(form: FormData) {
  const companyId = id(form);
  const { user } = await requireWrite(companyId, "settings");
  const routing = str(form.get("routing")).replace(/\D/g, "");
  const account = str(form.get("account")).replace(/\D/g, "");
  if (routing.length !== 9 || account.length < 4) go(page(form, companyId), { error: "Routing number is 9 digits; account number at least 4." });
  // Only the last 4 are stored until TD Bank holds the account (money movement is simulated).
  await db.company.update({ where: { id: companyId }, data: { bankName: str(form.get("bankName")) || "Bank", bankLast4: account.slice(-4) } });
  await audit(user.id, companyId, "company.bank_updated", { last4: account.slice(-4) });
  go(page(form, companyId), { ok: "Bank account saved (last 4 only; transfers are simulated)." });
}

export async function upsertStateAccount(form: FormData) {
  const companyId = id(form);
  const { user } = await requireWrite(companyId, "settings");
  const state = str(form.get("state"));
  if (!LAUNCH.includes(state)) go(page(form, companyId), { error: "Choose CT, MA, OR or NY." });
  const ratePct = Number(str(form.get("suiRatePct")));
  if (!Number.isFinite(ratePct) || ratePct < 0 || ratePct > 15) go(page(form, companyId), { error: "Unemployment rate is a percent, for example 2.4." });
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
  go(page(form, companyId), { ok: `${state} account saved.` });
}

export async function createSchedule(form: FormData) {
  const companyId = id(form);
  const { user } = await requireWrite(companyId, "settings");
  const frequency = str(form.get("frequency")) as Frequency;
  const anchor = str(form.get("anchorPayday"));
  if (!["WEEKLY", "BIWEEKLY", "SEMIMONTHLY", "MONTHLY"].includes(frequency) || !/^\d{4}-\d{2}-\d{2}$/.test(anchor))
    go(page(form, companyId), { error: "Choose how often you pay and the first payday." });
  await db.paySchedule.create({
    data: { companyId, name: str(form.get("name")) || "Regular", frequency, anchorPayday: day(anchor), payLagDays: Number(str(form.get("payLagDays")) || 5) },
  });
  await audit(user.id, companyId, "company.schedule_created", { frequency });
  go(page(form, companyId), { ok: "Pay schedule created." });
}

/* ---------- People ---------- */

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
    ...w4From(form),
    stateW4: stateW4From(form, workState),
    i9CompletedAt: form.get("i9Done") === "on" ? new Date() : null,
    bankLast4: str(form.get("bankAccount")).replace(/\D/g, "").slice(-4) || null,
    paymentMethod: str(form.get("paymentMethod")) === "CHECK" ? "CHECK" : "DIRECT_DEPOSIT",
    retirementPretaxRate: Math.min(1, Math.max(0, Number(str(form.get("retirementPct")) || 0) / 100)),
    healthPremiumCents: cents(form.get("healthPremium")),
  };
}

/** Job and pay only: what the employer enters when the employee fills in the rest (self-onboarding). */
function jobFields(form: FormData) {
  const f = employeeFields(form);
  const { firstName, lastName, email, hireDate, workState, payBasis, payRateCents, nyManualWorker, retirementPretaxRate, healthPremiumCents } = f;
  return { firstName, lastName, email, hireDate, workState, payBasis, payRateCents, nyManualWorker, retirementPretaxRate, healthPremiumCents };
}

type JobFields = ReturnType<typeof jobFields> & { birthDate?: Date | null };

async function validateEmployee(companyId: string, f: JobFields, scheduleId: string, back: string) {
  if (!f.firstName || !f.lastName) go(back, { error: "First and last name are required." });
  if (f.email && !EMAIL.test(f.email)) go(back, { error: "That email doesn't look right." });
  if (!LAUNCH.includes(f.workState)) go(back, { error: "Work state must be CT, MA, OR or NY." });
  if (f.birthDate !== undefined && (!f.birthDate || Number.isNaN(f.birthDate.getTime()))) go(back, { error: "Enter the date of birth." });
  if (Number.isNaN(f.hireDate.getTime())) go(back, { error: "Enter the hire date." });
  if (f.payRateCents <= 0) go(back, { error: "Enter the pay rate." });
  const schedule = await db.paySchedule.findFirst({ where: { id: scheduleId, companyId } });
  if (!schedule) go(back, { error: "There is no pay schedule yet. White Oak sets it up in Company settings." });
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
  const { user, role, mode } = await requireWrite(companyId, "add_people");
  const back = `/app/${companyId}/people/new`;
  if (form.get("selfOnboard") === "on") return createSelfOnboardingEmployee(form, companyId, user.id, role, mode);
  const ssn = normalizeSsn(str(form.get("ssn")));
  if (ssn.error) go(back, { error: ssn.error });
  const f = employeeFields(form);
  const scheduleId = str(form.get("payScheduleId"));
  const schedule = await validateEmployee(companyId, f, scheduleId, back);
  const e = await db.employee.create({
    data: { ...f, companyId, payScheduleId: scheduleId, ssn: ssn.value!, status: statusFor(f), defaultHours: Number(str(form.get("defaultHours"))) || DEFAULT_HOURS[schedule.frequency as Frequency] },
  });
  await audit(user.id, companyId, "employee.created", { employeeId: e.id });
  const fee = await feeNote(companyId, role, mode);
  // Clients add people; White Oak staff review and maintain the record afterwards.
  if (canUse(role, "people", mode)) go(`/app/${companyId}/people/${e.id}`, { ok: `${f.firstName} added.${fee}` });
  go(`/app/${companyId}/people`, { ok: `${f.firstName} ${f.lastName} added. White Oak will review their W-4 and I-9 details before the next payroll.${fee}` });
}

/** Add someone who fills in their own SSN, address, W-4s, bank account and I-9 Section 1 in the portal. */
async function createSelfOnboardingEmployee(form: FormData, companyId: string, actorId: string, role: AppRole, mode: ServiceMode) {
  const back = `/app/${companyId}/people/new`;
  const c = await db.company.findUniqueOrThrow({ where: { id: companyId } });
  if (!featuresFor(c).employeeSelfOnboarding) go(back, { error: "Employee self-onboarding is off for this company. Turn it on in Company settings, or enter their details yourself." });
  const f = jobFields(form);
  if (!f.email) go(back, { error: "Enter their email so we can send them the link." });
  const scheduleId = str(form.get("payScheduleId"));
  const schedule = await validateEmployee(companyId, f, scheduleId, back);
  if (await db.employee.findFirst({ where: { companyId, email: f.email, status: { not: "TERMINATED" } } })) go(back, { error: `${f.email} is already on your team.` });
  const e = await db.employee.create({
    data: {
      ...f,
      companyId,
      payScheduleId: scheduleId,
      ssn: "",
      birthDate: null,
      addressLine1: "",
      city: "",
      state: f.workState,
      zip: "",
      status: "ONBOARDING",
      defaultHours: Number(str(form.get("defaultHours"))) || DEFAULT_HOURS[schedule.frequency as Frequency],
    },
  });
  const invite = await inviteEmployeeLogin(e, c.tradeName || c.legalName);
  await audit(actorId, companyId, "employee.created", { employeeId: e.id, selfOnboarding: true, emailed: invite.emailed });
  const fee = await feeNote(companyId, role, mode);
  go(`/app/${companyId}/people/${e.id}`, { [invite.emailed ? "ok" : "error"]: `${f.firstName} added. ${invite.message}${fee}` });
}

export async function resendEmployeeInvite(form: FormData) {
  const companyId = id(form);
  const { user } = await requireWrite(companyId, "people");
  const e = await db.employee.findFirstOrThrow({ where: { id: str(form.get("employeeId")), companyId } });
  const back = `/app/${companyId}/people/${e.id}`;
  if (!e.email) go(back, { error: "Add their email first." });
  const r = await inviteEmployeeLogin(e, await companyName(companyId));
  await audit(user.id, companyId, "employee.invite_resent", { employeeId: e.id });
  go(back, { [r.emailed ? "ok" : "error"]: r.message });
}

/** Employer completes I-9 Section 2 after examining the original documents. */
export async function completeI9(form: FormData) {
  const companyId = id(form);
  const { user } = await requireWrite(companyId, "people");
  const e = await db.employee.findFirstOrThrow({ where: { id: str(form.get("employeeId")), companyId } });
  const back = `/app/${companyId}/people/${e.id}`;
  const docs = str(form.get("documents"));
  if (form.get("examined") !== "on" || !docs) go(back, { error: "List the documents you examined and confirm you saw the originals." });
  if (!e.ssn) go(back, { error: `${e.firstName} hasn't finished their part yet.` });
  await db.employee.update({
    where: { id: e.id },
    data: { i9CompletedAt: new Date(), status: e.status === "TERMINATED" ? "TERMINATED" : "ACTIVE", i9Section1: { ...((e.i9Section1 as object) ?? {}), section2: { documents: docs, examinedBy: user.name, examinedAt: new Date().toISOString() } } },
  });
  await audit(user.id, companyId, "employee.i9_section2", { employeeId: e.id });
  go(back, { ok: `${e.firstName} is active and will be on the next pay run.` });
}

export async function updateEmployee(form: FormData) {
  const companyId = id(form);
  const { user } = await requireWrite(companyId, "people");
  const employeeId = str(form.get("employeeId"));
  const back = `/app/${companyId}/people/${employeeId}`;
  const existing = await db.employee.findFirstOrThrow({ where: { id: employeeId, companyId } });
  if (form.get("selfOnboard") === "on") {
    // Still filling in their own details: the employer changes job and pay only.
    const j = jobFields(form);
    const scheduleId = str(form.get("payScheduleId"));
    await validateEmployee(companyId, j, scheduleId, back);
    await db.employee.update({ where: { id: employeeId }, data: { ...j, payScheduleId: scheduleId, defaultHours: Number(str(form.get("defaultHours"))) || existing.defaultHours } });
    await audit(user.id, companyId, "employee.updated", { employeeId });
    go(back, { ok: "Saved." });
  }
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
  const { user, role, mode } = await requireWrite(companyId, "people");
  const employeeId = str(form.get("employeeId"));
  const date = str(form.get("terminationDate"));
  await db.employee.update({
    where: { id: employeeId, companyId },
    data: { status: "TERMINATED", terminationDate: day(date), terminationReason: str(form.get("reason")) || null },
  });
  await audit(user.id, companyId, "employee.terminated", { employeeId, date });
  const fee = await feeNote(companyId, role, mode);
  go(`/app/${companyId}/people/${employeeId}`, {
    ok: `Offboarded. Run their final pay on or before the state deadline (MA: same day if fired; CT: next business day if fired; OR: end of next business day; NY: next regular payday). They still count toward this month's fee and drop off next month.${fee}`,
  });
}

export async function rehireEmployee(form: FormData) {
  const companyId = id(form);
  const { role, mode } = await requireWrite(companyId, "people");
  const employeeId = str(form.get("employeeId"));
  await db.employee.update({ where: { id: employeeId, companyId }, data: { status: "ONBOARDING", terminationDate: null, terminationReason: null, i9CompletedAt: null } });
  go(`/app/${companyId}/people/${employeeId}`, { ok: `Rehired. Complete a new I-9 if they left more than 3 years ago.${await feeNote(companyId, role, mode)}` });
}

export async function createContractor(form: FormData) {
  const companyId = id(form);
  const { user, role, mode } = await requireWrite(companyId, "people");
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
  go(`/app/${companyId}/people`, { ok: `${legalName} added as a contractor.${await feeNote(companyId, role, mode)}` });
}

export async function setContractorStatus(form: FormData) {
  const companyId = id(form);
  const { role, mode } = await requireWrite(companyId, "people");
  const status = str(form.get("status")) === "TERMINATED" ? "TERMINATED" : "ACTIVE";
  await db.contractor.update({ where: { id: str(form.get("contractorId")), companyId }, data: { status } });
  const fee = await feeNote(companyId, role, mode);
  go(`/app/${companyId}/people`, { ok: (status === "TERMINATED" ? "Contractor ended. Contractors only count toward your fee in months you pay them." : "Contractor reactivated.") + fee });
}

/* ---------- Pay runs ---------- */

export async function startPayRun(form: FormData) {
  const companyId = id(form);
  await requireWrite(companyId, "payroll");
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
  await requireWrite(companyId, "payroll");
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
      data: {
        hours: hours === null ? l.hours : Math.max(0, Number(hours) || 0),
        overtimeHours: form.get(`ot_${l.id}`) === null ? l.overtimeHours : Math.max(0, Number(form.get(`ot_${l.id}`)) || 0),
        bonusCents: cents(form.get(`bonus_${l.id}`)),
      },
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

/**
 * Fill a draft pay run's hours from a time clock export (BuddyPunch CSV). Hourly employees are
 * matched by name; anyone not in the file keeps the hours already in the grid. The result is a
 * summary shown above the grid so the hours can be checked before approving.
 */
export async function importHours(form: FormData) {
  const companyId = id(form);
  const { user } = await requireWrite(companyId, "payroll");
  const payRunId = str(form.get("payRunId"));
  const here = `/app/${companyId}/payroll/${payRunId}`;
  const run = await db.payRun.findFirstOrThrow({ where: { id: payRunId, companyId }, include: { lines: { include: { employee: true } } } });
  if (run.status !== "DRAFT") go(here, { error: "This pay run is already approved." });
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) go(here, { error: "Choose the CSV file to import." });
  if ((file as File).size > 2_000_000) go(here, { error: "That file is too large for an hours export (2 MB limit)." });
  const name = (file as File).name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) go(here, { error: "That is an Excel file. In BuddyPunch choose CSV when you download the report, or in Excel use File > Save As > CSV." });
  const { people, warnings } = readTimeExport(await (file as File).text());
  if (people.length === 0) go(here, { error: warnings[0] ?? "No hours found in that file." });

  const byKey = new Map(people.map((p) => [nameKey(p.name), p]));
  const lines: string[] = [];
  const used = new Set<string>();
  let filled = 0;
  for (const l of run.lines) {
    const e = l.employee;
    const p = byKey.get(nameKey(`${e.firstName} ${e.lastName}`));
    if (!p) {
      if (e.payBasis === "HOURLY") lines.push(`Not in file, left as is: ${e.firstName} ${e.lastName} (${l.hours ?? 0} h)`);
      continue;
    }
    used.add(nameKey(p.name));
    if (e.payBasis !== "HOURLY") {
      lines.push(`Salaried, hours not used: ${e.firstName} ${e.lastName} (${p.regular + p.overtime} h in file)`);
      continue;
    }
    await db.payRunLine.update({ where: { id: l.id }, data: { hours: p.regular, overtimeHours: p.overtime } });
    filled++;
    if (p.regular + p.overtime > 100) lines.push(`Check: ${e.firstName} ${e.lastName} has ${p.regular + p.overtime} hours.`);
  }
  for (const p of people) if (!used.has(nameKey(p.name))) lines.push(`In file but not on this pay run: ${p.name} (${p.regular} h${p.overtime ? ` + ${p.overtime} OT` : ""}). Add them in People, or check the spelling.`);
  await recalculate(payRunId);
  await audit(user.id, companyId, "payrun.hours_imported", { payRunId, file: (file as File).name, filled, people: people.length });
  const summary = [`Filled hours for ${filled} of ${run.lines.filter((l) => l.employee.payBasis === "HOURLY").length} hourly employees from ${(file as File).name}.`, ...warnings, ...lines].join("\n");
  redirect(`${here}?imported=${encodeURIComponent(summary.slice(0, 1800))}`);
}

export async function removeContractorPayment(form: FormData) {
  const companyId = id(form);
  await requireWrite(companyId, "payroll");
  const payRunId = str(form.get("payRunId"));
  await db.contractorPayment.deleteMany({ where: { id: str(form.get("paymentId")), payRunId, payRun: { status: "DRAFT", companyId } } });
  await recalculate(payRunId);
  go(`/app/${companyId}/payroll/${payRunId}`);
}

export async function approveRun(form: FormData) {
  const companyId = id(form);
  const { user } = await requireWrite(companyId, "payroll");
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
  const { user } = await requireWrite(companyId, "payroll");
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
  await requireWrite(companyId, "settings");
  const n = Number(str(form.get("nextCheckNumber")));
  if (!Number.isInteger(n) || n < 1) go(page(form, companyId), { error: "Check number must be a whole number." });
  const used = await db.check.findFirst({ where: { companyId, number: { gte: n } } });
  if (used) go(page(form, companyId), { error: `Check ${used.number} was already printed; start after it.` });
  await db.company.update({ where: { id: companyId }, data: { nextCheckNumber: n } });
  go(page(form, companyId), { ok: `Next check number is ${n}.` });
}

export async function deleteDraftRun(form: FormData) {
  const companyId = id(form);
  await requireWrite(companyId, "payroll");
  await db.payRun.deleteMany({ where: { id: str(form.get("payRunId")), companyId, status: "DRAFT" } });
  go(`/app/${companyId}/payroll`, { ok: "Draft deleted." });
}

/* ---------- Filings ---------- */

export async function generate(form: FormData) {
  const companyId = id(form);
  const { user } = await requireWrite(companyId, "filings");
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
  const { user } = await requireWrite(companyId, "filings");
  await db.filing.update({ where: { id: str(form.get("filingId")), companyId }, data: { status: "filed", filedAt: new Date() } });
  await audit(user.id, companyId, "filing.marked_filed", { filingId: str(form.get("filingId")) });
  revalidatePath(`/app/${companyId}/filings`);
}

/* ---------- Advances ---------- */

/**
 * White Oak staff record an advance the employee asked for (on paper, by phone or email). The
 * employee signs the written repayment authorization; staff type the name as signed and the date.
 */
export async function recordAdvance(form: FormData) {
  const companyId = id(form);
  const { user } = await requireWrite(companyId, "advances");
  const back = `/app/${companyId}/advances`;
  const e = await db.employee.findFirst({ where: { id: str(form.get("employeeId")), companyId } });
  if (!e || e.status !== "ACTIVE") go(back, { error: "Only active employees (I-9 complete) can get an advance." });
  if (!canOfferAdvance(e!.workState as LaunchState)) go(back, { error: `Advances are not available for ${e!.workState} employees yet (Connecticut only until counsel signs off).` });
  const amount = cents(form.get("amount"));
  const installment = cents(form.get("installment"));
  const signed = str(form.get("signedName"));
  const signedOn = day(str(form.get("signedOn")));
  if (amount <= 0 || amount > 100_000) go(back, { error: "Enter an advance between $1 and $1,000." });
  if (installment <= 0 || installment > amount) go(back, { error: "The repayment per pay run must be more than $0 and no more than the advance." });
  if (!signed || Number.isNaN(signedOn.getTime())) go(back, { error: "Enter the name as signed on the repayment authorization, and the date signed." });
  const open = await db.advance.count({ where: { employeeId: e!.id, status: { in: ["REQUESTED", "ACTIVE"] } } });
  if (open) go(back, { error: `${e!.firstName} already has an advance open.` });
  await db.advance.create({ data: { employeeId: e!.id, principalCents: amount, installmentCents: installment, authorizationSignedName: signed, authorizationSignedAt: signedOn } });
  await audit(user.id, companyId, "advance.recorded", { employeeId: e!.id, amount });
  go(back, { ok: `Advance request recorded for ${e!.firstName}. Approve it below to pay it.` });
}

export async function decideAdvance(form: FormData) {
  const companyId = id(form);
  const { user } = await requireWrite(companyId, "advances");
  const advanceId = str(form.get("advanceId"));
  const approve = str(form.get("decision")) === "approve";
  const a = await db.advance.findFirstOrThrow({ where: { id: advanceId, employee: { companyId } }, include: { employee: true } });
  if (approve && !canOfferAdvance(a.employee.workState as LaunchState))
    go(`/app/${companyId}/advances`, { error: `Advances are not available for ${a.employee.workState} employees yet (Connecticut only until counsel signs off).` });
  await db.advance.update({ where: { id: advanceId }, data: { status: approve ? "ACTIVE" : "DECLINED", decidedAt: new Date() } });
  await audit(user.id, companyId, approve ? "advance.approved" : "advance.declined", { advanceId });
  go(`/app/${companyId}/advances`, { ok: approve ? "Approved. The advance is sent to the employee now (simulated until TD Bank is connected) and repaid by a deduction on each pay run, at 0% interest." : "Declined." });
}

/* ---------- Billing ---------- */

export async function toggleAddOn(form: FormData) {
  const companyId = id(form);
  const { user } = await requireWrite(companyId, "billing");
  const addOn = str(form.get("addOn")) === "PTO" ? "PTO" : "TIME_TRACKING";
  const existing = await db.companyModule.findUnique({ where: { companyId_addOn: { companyId, addOn } } });
  if (existing) await db.companyModule.delete({ where: { id: existing.id } });
  else await db.companyModule.create({ data: { companyId, addOn } });
  await audit(user.id, companyId, existing ? "addon.disabled" : "addon.enabled", { addOn });
  await refreshInvoice(companyId, thisMonth());
  go(`/app/${companyId}/billing`, { ok: existing ? "Add-on turned off." : "Add-on turned on." });
}

/* ---------- Team ---------- */

export async function inviteTeammate(form: FormData) {
  const companyId = id(form);
  const { user } = await requireWrite(companyId, "team");
  const back = `/app/${companyId}/team`;
  const email = str(form.get("email")).toLowerCase();
  const role = str(form.get("role")) === "CLIENT_OWNER" ? "CLIENT_OWNER" : "CLIENT_HR";
  if (!EMAIL.test(email)) go(back, { error: "Enter an email." });
  const r = await inviteTeammateLogin(email, str(form.get("name")), companyId, role, await companyName(companyId));
  await audit(user.id, companyId, "team.invited", { email, role });
  go(back, { ok: `Added ${email}. ${r.message}` });
}

export async function removeTeammate(form: FormData) {
  const companyId = id(form);
  const { user } = await requireWrite(companyId, "team");
  const membershipId = str(form.get("membershipId"));
  const m = await db.membership.findFirstOrThrow({ where: { id: membershipId, companyId } });
  if (m.userId === user.id) go(`/app/${companyId}/team`, { error: "You can't remove yourself." });
  await db.membership.delete({ where: { id: membershipId } });
  go(`/app/${companyId}/team`, { ok: "Access removed." });
}

/* ---------- Features and setup ---------- */

export async function updateFeatures(form: FormData) {
  const companyId = id(form);
  const { user } = await requireWrite(companyId, "settings");
  const c = await db.company.findUniqueOrThrow({ where: { id: companyId } });
  const want = Object.fromEntries(FEATURE_KEYS.map((k) => [k, form.get(k) === "on"])) as Features;
  const overrides = featureOverrides(c.serviceMode, want);
  await db.company.update({ where: { id: companyId }, data: { features: overrides } });
  await audit(user.id, companyId, "company.features", want);
  go(`/app/${companyId}/settings`, { ok: "Features saved." });
}

/** The owner confirmed the details from signup in the setup wizard. */
export async function confirmCompany(form: FormData) {
  const companyId = id(form);
  const { user } = await requireWrite(companyId, "settings");
  await audit(user.id, companyId, "company.confirmed");
  go(`/app/${companyId}/setup`, { ok: "Company details confirmed." });
}
