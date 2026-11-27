import type { Prisma } from "@prisma/client";
import { cents, str } from "@/components/ui";
import { w4DependentsCents, type W4Entry } from "./onboarding-records";

/**
 * Reading the W-4 and state certificate inputs (W4Fieldset / StateW4Fieldset in
 * people/employee-form.tsx). Shared by the employer's employee form and the employee portal.
 */

/** The W-4 as entered: Step 3 as counts of children and other dependents. */
export function w4EntryFrom(form: FormData): W4Entry {
  const status = str(form.get("w4FilingStatus"));
  return {
    filingStatus: ["single", "married_jointly", "head_of_household"].includes(status) ? status : "single",
    multipleJobs: form.get("w4MultipleJobs") === "on",
    children: Math.max(0, Math.floor(Number(str(form.get("w4Children")) || 0))),
    otherDependents: Math.max(0, Math.floor(Number(str(form.get("w4OtherDependents")) || 0))),
    otherCreditsCents: cents(form.get("w4OtherCredits")),
    otherIncomeCents: cents(form.get("w4OtherIncome")),
    deductionsCents: cents(form.get("w4Deductions")),
    extraCents: cents(form.get("w4Extra")),
    exempt: form.get("w4Exempt") === "on",
  };
}

/** Employee columns the tax engine reads. */
export function w4From(form: FormData) {
  const w = w4EntryFrom(form);
  return {
    w4FilingStatus: w.filingStatus,
    w4MultipleJobs: w.multipleJobs,
    w4DependentsCents: w4DependentsCents(w),
    w4OtherIncomeCents: w.otherIncomeCents,
    w4DeductionsCents: w.deductionsCents,
    w4ExtraCents: w.extraCents,
    w4Exempt: w.exempt,
  };
}

export function stateW4From(form: FormData, state: string): Prisma.InputJsonValue {
  const k = state.toLowerCase();
  const g = (name: string) => str(form.get(`s_${k}_${name}`));
  const on = (name: string) => form.get(`s_${k}_${name}`) === "on";
  const money = (name: string) => cents(form.get(`s_${k}_${name}`));
  switch (state) {
    case "CT": return on("exempt") ? { code: "E" } : g("code") ? { code: g("code"), additional: money("additional"), reduction: money("reduction") } : {};
    case "MA": return { exemptions: Number(g("exemptions") || 0), headOfHousehold: on("headOfHousehold"), blind: Math.min(2, Number(g("blind") || 0)), fullTimeStudentUnder8k: on("student"), additional: money("additional"), exempt: on("exempt") };
    case "OR": return g("filingStatus") === "none" ? {} : { filingStatus: g("filingStatus") || "single", allowances: Number(g("allowances") || 0), additional: money("additional"), exempt: on("exempt") };
    case "NY": return { status: g("status") === "married" ? "married" : "single", allowances: Number(g("allowances") || 0), nycAllowances: Number(g("nycAllowances") || 0), additionalState: money("additionalState"), additionalNyc: money("additionalNyc"), additionalYonkers: money("additionalYonkers"), nycResident: on("nycResident"), yonkersResident: on("yonkersResident"), exempt: on("exempt") };
    default: return {};
  }
}
