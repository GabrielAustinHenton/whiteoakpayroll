"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireWrite } from "@/lib/auth/session";
import { audit, recalculate } from "@/lib/app/payroll-service";
import { importElections, markSubmissionSent } from "@/lib/app/retirement-service";
import { EMPLOYER_PRESETS, PLAN_TYPE_LABEL, provider, type EmployerFormula, type PlanType } from "@/lib/retirement";
import { cents, str } from "@/components/ui";

const go = (companyId: string, msg: { error?: string; ok?: string } = {}, hash = ""): never => {
  const q = msg.error ? `?error=${encodeURIComponent(msg.error)}` : msg.ok ? `?ok=${encodeURIComponent(msg.ok)}` : "";
  redirect(`/app/${companyId}/retirement${q}${hash}`);
};
const pct = (v: FormDataEntryValue | null) => Math.min(1, Math.max(0, (Number(str(v)) || 0) / 100));
const int = (v: FormDataEntryValue | null, d: number) => {
  const n = Math.round(Number(str(v)));
  return Number.isFinite(n) && n >= 0 ? n : d;
};

/** Plan or election changed: draft pay runs pick up the new amounts. */
async function refreshDrafts(companyId: string) {
  const drafts = await db.payRun.findMany({ where: { companyId, status: "DRAFT" }, select: { id: true } });
  for (const d of drafts) await recalculate(d.id);
}

export async function savePlan(form: FormData) {
  const companyId = str(form.get("companyId"));
  const { user } = await requireWrite(companyId, "settings");
  const planId = str(form.get("planId"));
  const p = provider(str(form.get("provider")));
  const planType = str(form.get("planType")) as PlanType;
  if (!PLAN_TYPE_LABEL[planType]) go(companyId, { error: "Choose a plan type." });
  if (!p.planTypes.includes(planType)) go(companyId, { error: `${p.name} does not offer a ${PLAN_TYPE_LABEL[planType]}.` });
  const presetKey = str(form.get("employerPreset")) || "none";
  const preset = EMPLOYER_PRESETS[presetKey] ?? EMPLOYER_PRESETS.none;
  let formula: EmployerFormula = preset.formula;
  if (presetKey === "custom") {
    const tiers = [1, 2]
      .map((n) => ({ rate: pct(form.get(`matchRate${n}`)), upTo: pct(form.get(`matchUpTo${n}`)) }))
      .filter((t) => t.rate > 0 && t.upTo > 0);
    formula = { tiers, nonelective: pct(form.get("nonelective")) };
  }
  if (planType === "STATE_AUTO_IRA") formula = { tiers: [], nonelective: 0 };
  const data = {
    provider: p.key,
    planType,
    name: str(form.get("name")) || `${p.name} ${PLAN_TYPE_LABEL[planType]}`,
    planNumber: str(form.get("planNumber")) || null,
    allowsRoth: planType === "STATE_AUTO_IRA" ? true : planType === "SIMPLE_IRA" ? false : form.get("allowsRoth") === "on",
    allowsCatchUp: form.get("allowsCatchUp") === "on",
    simpleApplicable: form.get("simpleApplicable") === "on",
    employerPreset: planType === "STATE_AUTO_IRA" ? "none" : presetKey,
    employerFormula: formula as unknown as Prisma.InputJsonValue,
    autoEnrollRate: pct(form.get("autoEnrollPct")),
    eligibilityDays: int(form.get("eligibilityDays"), 0),
    eligibilityMinAge: int(form.get("eligibilityMinAge"), 18),
  };
  if (planId) {
    await db.retirementPlan.update({ where: { id: (await db.retirementPlan.findFirstOrThrow({ where: { id: planId, companyId } })).id }, data });
  } else {
    await db.retirementPlan.create({ data: { companyId, ...data } });
  }
  await audit(user.id, companyId, planId ? "retirement.plan_updated" : "retirement.plan_created", { provider: p.key, planType });
  await refreshDrafts(companyId);
  go(companyId, { ok: planId ? "Plan saved. Draft pay runs were recalculated." : "Plan added. Check the elections below, then turn it on for pay runs." });
}

/** Put a plan on pay runs (one active plan per company), bringing over old flat 401(k) percents. */
export async function setPlanStatus(form: FormData) {
  const companyId = str(form.get("companyId"));
  const { user } = await requireWrite(companyId, "settings");
  const plan = await db.retirementPlan.findFirstOrThrow({ where: { id: str(form.get("planId")), companyId } });
  const status = str(form.get("status"));
  if (!["ACTIVE", "PAUSED", "ENDED"].includes(status)) go(companyId, { error: "Unknown status." });
  if (status === "ACTIVE") {
    await db.retirementPlan.updateMany({ where: { companyId, status: "ACTIVE", id: { not: plan.id } }, data: { status: "PAUSED" } });
    const employees = await db.employee.findMany({ where: { companyId, status: { not: "TERMINATED" }, retirementPretaxRate: { gt: 0 } } });
    for (const e of employees) {
      const rate = e.retirementPretaxRate;
      await db.retirementElection.upsert({
        where: { planId_employeeId: { planId: plan.id, employeeId: e.id } },
        create: {
          planId: plan.id,
          employeeId: e.id,
          status: "ENROLLED",
          pretaxRate: plan.planType === "STATE_AUTO_IRA" ? 0 : rate,
          rothRate: plan.planType === "STATE_AUTO_IRA" ? rate : 0,
          source: "employer",
        },
        update: {},
      });
    }
  }
  await db.retirementPlan.update({ where: { id: plan.id }, data: { status } });
  await audit(user.id, companyId, "retirement.plan_status", { planId: plan.id, status });
  await refreshDrafts(companyId);
  go(companyId, { ok: status === "ACTIVE" ? "The plan is on pay runs now. Draft pay runs were recalculated." : "Plan taken off pay runs." });
}

export async function saveElection(form: FormData) {
  const companyId = str(form.get("companyId"));
  const { user } = await requireWrite(companyId, "settings");
  const plan = await db.retirementPlan.findFirstOrThrow({ where: { id: str(form.get("planId")), companyId } });
  const employee = await db.employee.findFirstOrThrow({ where: { id: str(form.get("employeeId")), companyId } });
  const status = str(form.get("status"));
  if (!["ENROLLED", "OPTED_OUT", "NOT_ENROLLED"].includes(status)) go(companyId, { error: "Choose enrolled, opted out or not enrolled." });
  const state = plan.planType === "STATE_AUTO_IRA";
  const pre = pct(form.get("pretaxPct"));
  const roth = pct(form.get("rothPct"));
  const data = {
    status,
    pretaxRate: state ? 0 : pre,
    rothRate: state ? pre + roth : roth,
    pretaxFlatCents: state ? 0 : cents(form.get("pretaxFlat")),
    rothFlatCents: cents(form.get("rothFlat")) + (state ? cents(form.get("pretaxFlat")) : 0),
    source: "employer",
  };
  await db.retirementElection.upsert({ where: { planId_employeeId: { planId: plan.id, employeeId: employee.id } }, create: { planId: plan.id, employeeId: employee.id, ...data }, update: data });
  await audit(user.id, companyId, "retirement.election_saved", { planId: plan.id, employeeId: employee.id, status });
  await refreshDrafts(companyId);
  go(companyId, { ok: `Saved ${employee.firstName} ${employee.lastName}'s election.` }, "#elections");
}

export async function uploadElectionReport(form: FormData) {
  const companyId = str(form.get("companyId"));
  const { user } = await requireWrite(companyId, "settings");
  const file = form.get("report");
  if (!(file instanceof File) || file.size === 0) go(companyId, { error: "Choose the CSV you downloaded from the provider." });
  if ((file as File).size > 2_000_000) go(companyId, { error: "That file is over 2 MB; export only the deferral report." });
  const { updated, problems } = await importElections(companyId, str(form.get("planId")), await (file as File).text());
  await audit(user.id, companyId, "retirement.elections_imported", { updated, problems: problems.length });
  await refreshDrafts(companyId);
  const msg = `Updated ${updated} election${updated === 1 ? "" : "s"} from the provider's report.${problems.length ? ` ${problems.length} row(s) skipped: ${problems.slice(0, 3).join(" ")}` : ""}`;
  go(companyId, updated ? { ok: msg } : { error: msg || "Nothing was imported." }, "#elections");
}

export async function markSent(form: FormData) {
  const companyId = str(form.get("companyId"));
  const { user } = await requireWrite(companyId, "settings");
  await markSubmissionSent(companyId, str(form.get("submissionId")), user.id, str(form.get("note")));
  await audit(user.id, companyId, "retirement.file_sent", { submissionId: str(form.get("submissionId")) });
  go(companyId, { ok: "Marked as uploaded. Remember to send the money the same way the provider asks (their site shows how)." }, "#files");
}
