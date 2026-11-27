import type { Prisma } from "@prisma/client";
import { cents, str } from "@/components/ui";

/**
 * Reading the W-4 and state certificate inputs (W4Fieldset / StateW4Fieldset in
 * people/employee-form.tsx). Shared by the employer's employee form and the employee portal.
 */

export function w4From(form: FormData) {
  return {
    w4FilingStatus: ["single", "married_jointly", "head_of_household"].includes(str(form.get("w4FilingStatus"))) ? str(form.get("w4FilingStatus")) : "single",
    w4MultipleJobs: form.get("w4MultipleJobs") === "on",
    w4DependentsCents: cents(form.get("w4Dependents")),
    w4OtherIncomeCents: cents(form.get("w4OtherIncome")),
    w4DeductionsCents: cents(form.get("w4Deductions")),
    w4ExtraCents: cents(form.get("w4Extra")),
    w4Exempt: form.get("w4Exempt") === "on",
  };
}

export function stateW4From(form: FormData, state: string): Prisma.InputJsonValue {
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
