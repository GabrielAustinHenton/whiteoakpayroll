import { describe, expect, it } from "vitest";
import { featureOverrides, featuresFor } from "@/lib/app/features";
import { currentStep, setupReady, setupSteps, type SetupFacts } from "@/lib/app/setup";
import { approveBy, buildTodos, businessDaysBefore, runsToPrepare, type TodoFacts } from "@/lib/app/todos";
import { runChecks, type RunCheckLine } from "@/lib/app/run-checks";
import { canUse } from "@/lib/auth/session";
import { PRICING, monthlyBill, priceLabel, tierPrice } from "@/lib/pricing";

describe("service modes and feature switches", () => {
  it("gives a self-serve owner every area and a managed owner reports only", () => {
    expect(canUse("CLIENT_OWNER", "payroll", "SELF_SERVE")).toBe(true);
    expect(canUse("CLIENT_OWNER", "settings", "SELF_SERVE")).toBe(true);
    expect(canUse("CLIENT_OWNER", "payroll", "MANAGED")).toBe(false);
    expect(canUse("CLIENT_OWNER", "payroll")).toBe(false); // no mode = the stricter managed rules
    expect(canUse("CLIENT_HR", "people", "SELF_SERVE")).toBe(true);
    expect(canUse("CLIENT_HR", "payroll", "SELF_SERVE")).toBe(false);
    expect(canUse("PAYROLL_OPERATOR", "payroll", "MANAGED")).toBe(true);
  });

  it("uses mode defaults with per-company overrides", () => {
    expect(featuresFor({ serviceMode: "SELF_SERVE", features: {} }).employeePortal).toBe(true);
    expect(featuresFor({ serviceMode: "MANAGED", features: {} }).employeePortal).toBe(false);
    // A managed client of Jose's that wants the portal:
    expect(featuresFor({ serviceMode: "MANAGED", features: { employeePortal: true } }).employeePortal).toBe(true);
    // Self-onboarding needs the portal.
    expect(featuresFor({ serviceMode: "SELF_SERVE", features: { employeePortal: false } }).employeeSelfOnboarding).toBe(false);
    expect(featuresFor({ serviceMode: "SELF_SERVE", features: "junk" }).advances).toBe(true);
  });

  it("stores only switches that differ from the mode's defaults", () => {
    expect(featureOverrides("SELF_SERVE", { employeePortal: true, advances: false })).toEqual({ advances: false });
    expect(featureOverrides("MANAGED", { employeePortal: true })).toEqual({ employeePortal: true });
  });
});

describe("setup wizard", () => {
  const facts: SetupFacts = { companyConfirmed: true, workStates: ["OR"], stateAccounts: [], schedules: 0, bank: false, people: 0, paidRuns: 0 };
  it("starts at the first unfinished step and names missing states", () => {
    const steps = setupSteps(facts);
    expect(currentStep(steps).id).toBe("states");
    expect(steps.find((s) => s.id === "states")!.why).toContain("OR");
    expect(setupReady(steps)).toBe(false);
  });
  it("is ready to run payroll once the required steps are done", () => {
    const steps = setupSteps({ ...facts, stateAccounts: ["OR"], schedules: 1, bank: true, people: 2 });
    expect(setupReady(steps)).toBe(true);
    expect(currentStep(steps).id).toBe("payroll");
    expect(currentStep(steps, "bank").id).toBe("bank");
  });
  it("needs an account for every state people work in", () => {
    const steps = setupSteps({ ...facts, workStates: ["OR", "NY"], stateAccounts: ["OR"], schedules: 1, bank: true, people: 2 });
    expect(steps.find((s) => s.id === "states")!.done).toBe(false);
  });
});

describe("to-dos and automatic pay runs", () => {
  it("counts approval cutoffs in business days", () => {
    expect(businessDaysBefore("2026-12-04", 2)).toBe("2026-12-02"); // Fri -> Wed
    expect(approveBy("2026-12-07")).toBe("2026-12-03"); // Mon -> Thu
    expect(approveBy("2026-12-28")).toBe("2026-12-23"); // Mon after Christmas -> Wed
  });

  const base: TodoFacts = {
    today: "2026-12-01",
    schedules: [{ id: "s1", name: "Regular", frequency: "BIWEEKLY", anchorPayday: "2026-12-04", payLagDays: 5, lastRegularPayday: null }],
    openRuns: [],
    employees: [],
    paidQuarters: [],
    filed941: [],
  };

  it("prepares the next regular run within a week of payday, once", () => {
    expect(runsToPrepare(base)).toEqual([{ scheduleId: "s1", payday: "2026-12-04" }]);
    expect(runsToPrepare({ ...base, openRuns: [{ id: "r1", payScheduleId: "s1", payday: "2026-12-04", status: "DRAFT", offCycle: false }] })).toEqual([]);
    expect(runsToPrepare({ ...base, today: "2026-11-20" })).toEqual([]);
  });

  it("asks for approval and flags a missed cutoff as urgent", () => {
    const draft = { ...base, openRuns: [{ id: "r1", payScheduleId: "s1", payday: "2026-12-04", status: "DRAFT" as const, offCycle: false }] };
    const [t] = buildTodos(draft);
    expect(t.key).toBe("approve:r1");
    expect(t.due).toBe("2026-12-02");
    expect(t.remind).toBe(true);
    expect(buildTodos({ ...draft, today: "2026-12-03" })[0].urgent).toBe(true);
  });

  it("follows each new hire from self-onboarding to I-9 Section 2", () => {
    const e = { id: "e1", name: "Ana Diaz", status: "ONBOARDING" as const, hireDate: "2026-11-30", selfOnboardingInvited: true, selfOnboardingDone: false, i9Done: false };
    expect(buildTodos({ ...base, schedules: [], employees: [e] })[0].key).toBe("waiting:e1");
    const i9 = buildTodos({ ...base, schedules: [], employees: [{ ...e, selfOnboardingDone: true }] })[0];
    expect(i9.key).toBe("i9:e1");
    expect(i9.due).toBe("2026-12-03");
  });

  it("reminds about a finished quarter's 941 until it is filed", () => {
    const f = { ...base, schedules: [], today: "2027-01-25", paidQuarters: ["2026-Q4"] };
    expect(buildTodos(f)[0]).toMatchObject({ key: "941:2026-Q4", due: "2027-02-01", remind: true });
    expect(buildTodos({ ...f, filed941: ["2026-Q4"] })).toEqual([]);
    expect(buildTodos({ ...f, today: "2026-12-15" })).toEqual([]); // quarter not over yet
  });
});

describe("pre-run checks", () => {
  const line: RunCheckLine = { name: "Ana Diaz", payBasis: "HOURLY", hours: 80, overtimeHours: 0, defaultHours: 80, bonusCents: 0, grossCents: 160_000, netCents: 125_000, previousGrossCents: 160_000, paymentMethod: "DIRECT_DEPOSIT", bankLast4: "1234", i9Done: true, hireDate: "2025-01-01", terminationDate: null };
  const run = { today: "2026-12-01", payday: "2026-12-04", approveBy: "2026-12-02", periodStart: "2026-11-16", periodEnd: "2026-11-29", waitingOnboarding: [] as string[] };

  it("is quiet for a normal run", () => {
    expect(runChecks({ ...run, lines: [line] })).toEqual([]);
  });
  it("flags spikes, missing hours, missing bank accounts and unpayable lines", () => {
    const flags = runChecks({
      ...run,
      lines: [
        { ...line, grossCents: 320_000 },
        { ...line, name: "Bo Li", hours: 0, grossCents: 0, netCents: 0 },
        { ...line, name: "Cy Ng", bankLast4: null },
        { ...line, name: "Di Fox", netCents: -500 },
        { ...line, name: "Fay Ho", hireDate: "2026-11-25" },
      ],
      waitingOnboarding: ["Ed Kim"],
    });
    const text = flags.map((f) => f.message).join("\n");
    expect(text).toContain("up from $1,600.00");
    expect(text).toContain("Bo Li has no pay");
    expect(text).toContain("Cy Ng has no bank account");
    expect(text).toContain("Ed Kim hasn't finished");
    expect(text).toContain("Fay Ho started on 2026-11-25, partway");
    expect(flags.find((f) => f.message.startsWith("Di Fox"))!.level).toBe("stop");
  });
  it("stops a run whose payday has passed", () => {
    expect(runChecks({ ...run, today: "2026-12-05", lines: [line] })[0].level).toBe("stop");
  });
});

describe("tier pricing with a different first tier", () => {
  it("prices the first 5 people and each further 5 separately", () => {
    const saved = { ...PRICING };
    Object.assign(PRICING, { firstTierPrice: 3_500, pricePerTier: 2_000 });
    try {
      expect(tierPrice(0)).toBe(0);
      expect(tierPrice(1)).toBe(3_500);
      expect(monthlyBill(20).total).toBe(9_500);
      expect(monthlyBill(50).total).toBe(21_500);
      expect(priceLabel()).toBe("$35 for the first 5 people, then $20 per 5");
    } finally {
      Object.assign(PRICING, saved);
    }
  });
  it("keeps today's $25 per 5 people (6 people = $50)", () => {
    expect(monthlyBill(6).total).toBe(5_000);
    expect(priceLabel()).toBe("$25 per 5 people");
  });
});
