import type { ServiceMode } from "@prisma/client";

/**
 * Per-company feature switches. Each service mode has defaults; a company's `features` JSON only
 * holds the switches someone changed (for example a managed client of Jose's that wants the
 * employee portal). One codebase, both modes: new behavior goes behind a switch here, not a fork.
 */
export const FEATURES = {
  employeePortal: {
    label: "Employee portal",
    help: "Employees sign in to see paystubs and W-2s, update their W-4 and direct deposit, and request advances.",
  },
  employeeSelfOnboarding: {
    label: "Employees fill in their own details",
    help: "When you add someone, they get an email to enter their SSN, address, W-4, state form, bank account and I-9 Section 1 themselves.",
  },
  advances: {
    label: "Payday advances",
    help: "Zero-interest advances repaid from later paychecks (where state law allows).",
  },
  autoDraftPayroll: {
    label: "Prepare pay runs automatically",
    help: "A week before each payday, a draft pay run with everyone's usual hours and salary is ready to review.",
  },
  payrollReminders: {
    label: "Email reminders",
    help: "Owners get an email when a pay run needs approval and before tax deadlines.",
  },
} as const;

export type FeatureKey = keyof typeof FEATURES;
export type Features = Record<FeatureKey, boolean>;

export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];

const DEFAULTS: Record<ServiceMode, Features> = {
  SELF_SERVE: { employeePortal: true, employeeSelfOnboarding: true, advances: true, autoDraftPayroll: true, payrollReminders: true },
  // Managed clients rarely use a computer; White Oak staff do the work from the payroll desk.
  MANAGED: { employeePortal: false, employeeSelfOnboarding: false, advances: true, autoDraftPayroll: false, payrollReminders: false },
};

/** The switches in effect for a company: its mode's defaults with its own overrides on top. */
export function featuresFor(c: { serviceMode: ServiceMode; features: unknown }): Features {
  const out = { ...DEFAULTS[c.serviceMode] };
  const o = c.features && typeof c.features === "object" ? (c.features as Record<string, unknown>) : {};
  for (const k of FEATURE_KEYS) if (typeof o[k] === "boolean") out[k] = o[k] as boolean;
  // Self-onboarding happens in the portal, so it needs the portal.
  if (!out.employeePortal) out.employeeSelfOnboarding = false;
  return out;
}

/** The overrides to store so that `want` is in effect: only switches that differ from the mode's defaults. */
export function featureOverrides(mode: ServiceMode, want: Partial<Features>): Partial<Features> {
  const out: Partial<Features> = {};
  for (const k of FEATURE_KEYS) if (typeof want[k] === "boolean" && want[k] !== DEFAULTS[mode][k]) out[k] = want[k];
  return out;
}

export const MODE_LABEL: Record<ServiceMode, string> = {
  SELF_SERVE: "Self-serve (the owner runs payroll)",
  MANAGED: "Managed by White Oak (payroll desk)",
};
