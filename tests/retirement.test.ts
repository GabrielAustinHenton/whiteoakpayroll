import { describe, expect, it } from "vitest";
import {
  EMPLOYER_PRESETS,
  buildProviderFiles,
  eligibleFrom,
  matchFor,
  readElectionReport,
  retirementForPaycheck,
  retirementYtd,
  totalEmployee,
  ZERO_YTD,
  type ContributionRow,
  type Election,
  type PlanConfig,
  type RetirementInput,
} from "@/lib/retirement";
import { computePaycheck, toPaycheckRecord, type EmployeeTaxProfile } from "@/lib/app/engine";
import { buildW2s } from "@/lib/filings/w2";

const k401: PlanConfig = {
  id: "plan1",
  type: "401K",
  allowsRoth: true,
  allowsCatchUp: true,
  employer: EMPLOYER_PRESETS.basic_safe_harbor.formula,
  autoEnrollRate: 0,
  eligibilityDays: 0,
  eligibilityMinAge: 18,
};
const enrolled = (pretaxRate: number, rothRate = 0): Election => ({ status: "ENROLLED", pretaxRate, rothRate, pretaxFlatCents: 0, rothFlatCents: 0 });
const base: RetirementInput = {
  plan: k401,
  election: enrolled(0.06),
  gross: 400_000,
  payday: "2026-06-15",
  birthDate: "1985-03-01",
  hireDate: "2020-01-01",
  ytd: ZERO_YTD,
  priorYearFicaWages: 8_000_000,
};

describe("employee deferrals", () => {
  it("takes the elected percent as pre-tax 401(k)", () => {
    const { line, deductions } = retirementForPaycheck(base);
    expect(line.pretax).toBe(24_000);
    expect(deductions).toEqual([{ kind: "retirement_pretax", amount: 24_000 }]);
  });

  it("splits pre-tax and Roth", () => {
    const { deductions } = retirementForPaycheck({ ...base, election: enrolled(0.04, 0.02) });
    expect(deductions).toEqual([{ kind: "retirement_pretax", amount: 16_000 }, { kind: "retirement_roth", amount: 8_000 }]);
  });

  it("stops at the 402(g) limit for someone under 50", () => {
    const { line } = retirementForPaycheck({ ...base, election: enrolled(0.5), ytd: { ...ZERO_YTD, deferral: 2_440_000 } });
    expect(line.pretax).toBe(10_000);
    expect(line.catchUpPretax).toBe(0);
    expect(line.notes.join(" ")).toMatch(/annual limit/);
  });

  it("lets 50+ continue into catch-up, and 60-63 get the higher catch-up", () => {
    const at55 = retirementForPaycheck({ ...base, birthDate: "1971-05-05", election: enrolled(1), gross: 5_000_000, ytd: { ...ZERO_YTD, deferral: 2_450_000 } });
    expect(at55.line.catchUpPretax).toBe(800_000);
    const at61 = retirementForPaycheck({ ...base, birthDate: "1965-05-05", election: enrolled(1), gross: 5_000_000, ytd: { ...ZERO_YTD, deferral: 2_450_000 } });
    expect(at61.line.catchUpPretax).toBe(1_125_000);
    const at64 = retirementForPaycheck({ ...base, birthDate: "1962-05-05", election: enrolled(1), gross: 5_000_000, ytd: { ...ZERO_YTD, deferral: 2_450_000 } });
    expect(at64.line.catchUpPretax).toBe(800_000);
  });

  it("makes catch-up Roth for people paid over $150,000 here last year", () => {
    const r = retirementForPaycheck({ ...base, birthDate: "1971-05-05", election: enrolled(1), gross: 5_000_000, priorYearFicaWages: 15_000_001, ytd: { ...ZERO_YTD, deferral: 2_450_000 } });
    expect(r.line.catchUpPretax).toBe(0);
    expect(r.line.catchUpRoth).toBe(800_000);
    const noRoth = retirementForPaycheck({ ...base, plan: { ...k401, allowsRoth: false }, birthDate: "1971-05-05", election: enrolled(1), gross: 5_000_000, priorYearFicaWages: 15_000_001, ytd: { ...ZERO_YTD, deferral: 2_450_000 } });
    expect(totalEmployee(noRoth.line)).toBe(0);
  });

  it("respects opt-outs, eligibility waits, and auto-enrollment", () => {
    expect(totalEmployee(retirementForPaycheck({ ...base, election: { ...enrolled(0.1), status: "OPTED_OUT" } }).line)).toBe(0);
    const waiting = retirementForPaycheck({ ...base, plan: { ...k401, eligibilityDays: 90 }, hireDate: "2026-05-01" });
    expect(totalEmployee(waiting.line)).toBe(0);
    expect(eligibleFrom({ ...k401, eligibilityDays: 90 }, "1985-03-01", "2026-05-01")).toBe("2026-07-30");
    const auto = retirementForPaycheck({ ...base, plan: { ...k401, autoEnrollRate: 0.03 }, election: { ...enrolled(0), status: "NOT_ENROLLED" } });
    expect(auto.line.pretax).toBe(12_000);
    expect(auto.line.autoEnrolled).toBe(true);
  });
});

describe("employer contributions", () => {
  it("figures the basic safe harbor match", () => {
    // 6% deferral: 100% of 3% + 50% of 2% = 4% of pay.
    expect(retirementForPaycheck(base).line.employerMatch).toBe(16_000);
    // 2% deferral: 2% match.
    expect(retirementForPaycheck({ ...base, election: enrolled(0.02) }).line.employerMatch).toBe(8_000);
    expect(matchFor([{ rate: 1, upTo: 0.04 }], 40_000, 400_000)).toBe(16_000);
  });

  it("pays nonelective contributions to people who do not save", () => {
    const r = retirementForPaycheck({ ...base, plan: { ...k401, employer: EMPLOYER_PRESETS.nonelective_3.formula }, election: { ...enrolled(0), status: "NOT_ENROLLED" } });
    expect(r.line.employerNonelective).toBe(12_000);
  });

  it("caps plan pay at the 401(a)(17) limit", () => {
    const r = retirementForPaycheck({ ...base, ytd: { ...ZERO_YTD, planComp: 35_900_000 } });
    expect(r.line.planComp).toBe(100_000);
  });
});

describe("state auto-IRA programs", () => {
  const oregonSaves: PlanConfig = { ...k401, id: "os", type: "STATE_AUTO_IRA", allowsRoth: false, employer: EMPLOYER_PRESETS.basic_safe_harbor.formula, autoEnrollRate: 0.05, eligibilityDays: 30 };
  it("takes Roth IRA savings after the opt-out window, with no employer money", () => {
    const r = retirementForPaycheck({ ...base, plan: oregonSaves, election: { ...enrolled(0), status: "NOT_ENROLLED" } });
    expect(r.deductions).toEqual([{ kind: "state_auto_ira", amount: 20_000 }]);
    expect(r.line.employerMatch + r.line.employerNonelective).toBe(0);
  });
  it("stops at the IRA limit", () => {
    const r = retirementForPaycheck({ ...base, plan: oregonSaves, ytd: { ...ZERO_YTD, deferral: 745_000 } });
    expect(totalEmployee(r.line)).toBe(5_000);
  });
});

describe("SIMPLE IRA", () => {
  it("uses W-2 code S and the SIMPLE limit", () => {
    const simple: PlanConfig = { ...k401, type: "SIMPLE_IRA", employer: EMPLOYER_PRESETS.simple_match_3.formula };
    const r = retirementForPaycheck({ ...base, plan: simple, ytd: { ...ZERO_YTD, deferral: 1_690_000 } });
    expect(r.deductions).toEqual([{ kind: "simple_ira", amount: 10_000 }]);
  });
});

describe("pay run integration", () => {
  const emp: EmployeeTaxProfile = {
    id: "e1", workState: "OR", payBasis: "SALARIED", payRateCents: 10_400_000, w4FilingStatus: "single", w4MultipleJobs: false,
    w4DependentsCents: 0, w4OtherIncomeCents: 0, w4DeductionsCents: 0, w4ExtraCents: 0, w4Exempt: false, stateW4: { filingStatus: "single", allowances: 1 },
    retirementPretaxRate: 0.1, healthPremiumCents: 0,
    retirement: { plan: k401, election: enrolled(0.05, 0.01), birthDate: "1985-03-01", hireDate: "2020-01-01", priorYearFicaWages: 0 },
  };
  const ctx = { frequency: "BIWEEKLY" as const, hours: null, bonus: 0, company: { suiRate: 0.024 }, employerSize: 3, prior: [], advances: [], payday: "2026-06-12" };

  it("uses the plan election instead of the old flat percent, and pre-tax lowers income tax wages only", () => {
    const d = computePaycheck(emp, ctx);
    expect(d.retirement?.pretax).toBe(20_000);
    expect(d.retirement?.roth).toBe(4_000);
    expect(d.result.wages.federalIncome).toBe(400_000 - 20_000);
    expect(d.result.wages.fica).toBe(400_000);
    expect(d.retirement?.employerMatch).toBe(16_000);
  });

  it("carries year-to-date savings forward and fills W-2 box 12 and 13", () => {
    const first = computePaycheck(emp, ctx);
    expect(retirementYtd([first]).deferral).toBe(24_000);
    const rec = toPaycheckRecord({ employeeId: "e1", detail: first }, { payday: new Date("2026-06-12"), periodStart: new Date("2026-05-25"), periodEnd: new Date("2026-06-07") });
    const [w2] = buildW2s([rec], 2026, { ein: "001234567", name: "Good PDX", address: { line1: "1 Main", city: "Portland", state: "OR", zip: "97201" }, stateIds: {} } as never);
    expect(w2.box12.D).toBe(20_000);
    expect(w2.box12.AA).toBe(4_000);
    expect(w2.box13_retirementPlan).toBe(true);
  });
});

describe("provider files", () => {
  const row: ContributionRow = {
    employeeId: "emp_1", firstName: "Ana", lastName: "Diaz", ssn: "000-12-3456", birthDate: "1990-02-03", hireDate: "2024-01-08",
    address: { line1: "1 Main St", city: "Portland", state: "OR", zip: "97201" }, gross: 200_000, hours: 80, ytdGross: 2_400_000,
    retirement: retirementForPaycheck({ ...base, gross: 200_000, plan: { ...k401, type: "STATE_AUTO_IRA" } }).line, electionStatus: "ENROLLED",
  };
  const run = { ein: "00-1234567", payday: "2026-06-12", periodStart: "2026-05-25", periodEnd: "2026-06-07", payGroup: "Bi-weekly" };

  it("writes the Vestwell 180 contribution and roster files for OregonSaves", () => {
    const files = buildProviderFiles("oregonsaves", run, [row], [row]);
    expect(files).toHaveLength(2);
    expect(files[0].fileName).toMatch(/^OR_001234567_newemployee_\d{14}\.csv$/);
    expect(files[1].fileName).toMatch(/^OR_001234567_2026-06-12_\d{14}\.csv$/);
    expect(files[1].content.split("\r\n")[0]).toBe("Last Name,First Name,Social Security Number,Contribution amount,UID,Division");
    expect(files[1].content.split("\r\n")[1]).toBe("Diaz,Ana,000123456,120.00,emp_1,Bi-weekly");
  });

  it("writes White Oak's standard file for recordkeepers like Principal", () => {
    const r401 = { ...row, retirement: retirementForPaycheck({ ...base, gross: 200_000 }).line };
    const [f] = buildProviderFiles("principal", run, [r401]);
    expect(f.fileName).toBe("whiteoak_principal_001234567_2026-06-12.csv");
    const [head, line] = f.content.split("\r\n");
    expect(head.split(",")).toContain("Employer Match");
    expect(line).toContain("120.00");
    expect(f.employerCents).toBe(8_000);
  });
});

describe("election reports from providers", () => {
  it("reads SSN, pre-tax and Roth percents, and opt-outs", () => {
    const csv = "Participant SSN,Name,Pre-Tax Deferral %,Roth Deferral %,Status\n000-11-2222,Ana,5,1,Active\n000113333,Bo,0,0,Opted Out\nbad,Cy,3,0,Active\n";
    const { elections, problems } = readElectionReport(csv);
    expect(elections).toEqual([
      { ssn: "000112222", status: "ENROLLED", pretaxRate: 0.05, rothRate: 0.01 },
      { ssn: "000113333", status: "OPTED_OUT", pretaxRate: 0, rothRate: 0 },
    ]);
    expect(problems).toHaveLength(1);
  });
});
