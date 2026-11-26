import { describe, expect, it } from "vitest";
import { dollars } from "@/lib/money";
import { calculatePaycheck, type FullPaycheckInput } from "@/lib/tax-engine";
import { addDays, buildW2s, build1099Necs, type Employer, type PaycheckRecord } from "@/lib/filings";
import {
  advance,
  checkEfw2,
  crc32,
  ctNecFile,
  ctW2File,
  ctYearEndSubmissions,
  ct941Submission,
  iris1099Submission,
  irisText,
  mef940Submission,
  mef941Submission,
  MefNotConfigured,
  IrisNotConfigured,
  package941,
  ssaW2Submission,
  submissionId,
  utid,
  zip,
  businessNameControl,
  type ReportingAgent,
} from "@/lib/efile";
import { form941 as f941 } from "@/lib/filings";

const fedW4 = { version: "2020_or_later" as const, filingStatus: "single" as const, multipleJobs: false, dependentsCredit: 0, otherIncome: 0, deductions: 0, extraWithholding: 0 };
const ctBase: Omit<FullPaycheckInput, "employeeId" | "regularWages" | "ytd" | "stateYtd" | "frequency"> = {
  deductions: [],
  federalW4: fedW4,
  workState: "CT",
  state: { state: "CT", w4: { code: "F" } },
  employerState: { suiRate: 0.03, employerSize: 2 },
};

function year(employeeId: string, gross: number): PaycheckRecord[] {
  const out: PaycheckRecord[] = [];
  const ytd = { ficaWages: 0, futaWages: 0, supplementalWages: 0 };
  const stateYtd = { suiWages: 0, paidLeaveWages: 0, paidLeaveEmployee: 0, maFicaDeductionUsed: 0 };
  let payday = "2026-01-09";
  for (let i = 0; i < 26; i++) {
    const result = calculatePaycheck({ ...ctBase, employeeId, frequency: "biweekly", regularWages: dollars(gross), ytd: { ...ytd }, stateYtd: { ...stateYtd } });
    out.push({ payday, periodStart: addDays(payday, -18), periodEnd: addDays(payday, -5), employeeId, result, deductionDetail: [] });
    ytd.ficaWages += result.wages.fica;
    ytd.futaWages += result.wages.futa;
    stateYtd.suiWages += result.wages.fica;
    stateYtd.paidLeaveWages += result.wages.fica;
    payday = addDays(payday, 14);
  }
  return out;
}

const records = [...year("alice", 3_000), ...year("bob", 5_000)];
const employer: Employer = {
  ein: "12-3456789",
  name: "The Sample Bakery LLC",
  address: { line1: "1 Main St", city: "Hartford", state: "CT", zip: "06103" },
  contact: { name: "Pat Owner", phone: "860-555-0100", email: "pat@example.com" },
  stateIds: { CT: "1234567-000" },
};
const agent: ReportingAgent = {
  name: "White Oak Payroll",
  ein: "98-7654321",
  efin: "123456",
  etin: "54321",
  softwareId: "26000001",
  pin: "12345",
  address: employer.address,
  phone: "8605550199",
};
const now = new Date("2026-04-20T15:00:00Z");
const people = buildW2s(records, 2026, employer).map((w2) => ({
  w2,
  person: { ssn: w2.employeeId === "alice" ? "123-45-6789" : "234-56-7890", firstName: w2.employeeId, lastName: "Sample", address: employer.address },
}));
const unzipNames = (z: Uint8Array) => {
  const names: string[] = [];
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  for (let i = 0; i + 30 <= z.length; ) {
    if (dv.getUint32(i, true) !== 0x04034b50) break;
    const size = dv.getUint32(i + 18, true);
    const nameLen = dv.getUint16(i + 26, true);
    const extra = dv.getUint16(i + 28, true);
    names.push(new TextDecoder().decode(z.slice(i + 30, i + 30 + nameLen)));
    i += 30 + nameLen + extra + size;
  }
  return names;
};

describe("zip", () => {
  it("computes the standard CRC-32 and writes local headers", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const z = zip([{ path: "a/b.txt", data: "hi" }]);
    expect(Array.from(z.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(unzipNames(z)).toEqual(["a/b.txt"]);
  });
});

describe("IRS MeF 941/940", () => {
  it("builds a 20-character SubmissionId from EFIN, year and day of year", () => {
    const id = submissionId("123456", now, 1);
    expect(id).toHaveLength(20);
    expect(id.slice(0, 13)).toBe("1234562026110");
    expect(() => submissionId("12345", now)).toThrow();
  });

  it("drops a leading THE from the name control", () => {
    expect(businessNameControl(employer.name)).toBe("SAMP");
  });

  it("packages a 941 with the return amounts and the manifest/xml layout", () => {
    const f = f941(records, 2026, 1, 0);
    const pkg = package941(f, employer, agent, "monthly", now);
    expect(unzipNames(pkg.zip)).toEqual([`${pkg.submissionId}/manifest/manifest.xml`, `${pkg.submissionId}/xml/submission.xml`]);
    expect(pkg.returnXml).toContain('returnVersion="2026Q1v4.0"');
    expect(pkg.returnXml).toContain(`<WagesAmt>${(f.line2_wages / 100).toFixed(2)}</WagesAmt>`);
    expect(pkg.returnXml).toContain("<EIN>123456789</EIN>");
    expect(pkg.returnXml).toContain("<ReportingAgentPIN>12345</ReportingAgentPIN>");
    expect(pkg.returnXml).toContain("MonthlyDepositorGrp");
    expect(pkg.returnXml).not.toContain("IRS941ScheduleB");
    expect(pkg.manifestXml).toContain(`<SubmissionId>${pkg.submissionId}</SubmissionId>`);
  });

  it("adds Schedule B for semiweekly depositors", () => {
    const pkg = package941(f941(records, 2026, 1, 0), employer, agent, "semiweekly", now);
    expect(pkg.returnXml).toContain("IRS941ScheduleB");
    expect(pkg.returnXml).toContain('documentCnt="2"');
  });

  it("wraps 941 and 940 as validated submissions that cannot be sent yet", async () => {
    const s = mef941Submission(records, 2026, 1, 0, employer, agent, "monthly", now);
    expect(s).toMatchObject({ channel: "irs_mef", form: "941", period: "2026Q1", status: "validated", errors: [] });
    const s940 = mef940Submission(records, 2026, 0, ["CT"], employer, agent, now);
    expect(s940.form).toBe("940");
    await expect(new MefNotConfigured().send()).rejects.toThrow(/registrations/);
  });
});

describe("IRIS 1099-NEC", () => {
  const contractors = [
    { id: "c1", tin: "123-45-6789", tinType: "ssn" as const, name: "Jo O'Neil", address: employer.address, state: "CT" },
    { id: "c2", tin: "11-2233445", tinType: "ein" as const, name: "Fix--It Co", address: employer.address, state: "CT" },
  ];
  const payments = [
    { contractorId: "c1", paidOn: "2026-05-01", amount: dollars(3_000), backupWithholding: 0 },
    { contractorId: "c2", paidOn: "2026-06-01", amount: dollars(4_500), backupWithholding: 0 },
  ];
  const transmitter = { tcc: "DG5BW", tin: agent.ein, name: agent.name, contact: { name: "Ops", phone: "8605550199", email: "ops@example.com" }, softwareId: "SW1" };

  it("formats the UTID and cleans text the way IRIS requires", () => {
    expect(utid("DG5BW", "0b4c1f9e-1234-4abc-8def-0123456789ab")).toBe("0b4c1f9e-1234-4abc-8def-0123456789ab:IRIS:DG5BW::A");
    expect(() => utid("TOOLONG")).toThrow();
    expect(irisText("Jo O'Neil", true)).toBe("Jo ONeil");
    expect(irisText("Fix--It Co")).not.toContain("--");
  });

  it("writes one detail record per form and archives a 1096", () => {
    const { submission, forms } = iris1099Submission(contractors, payments, 2026, employer, transmitter, { test: true, uuid: "0b4c1f9e-1234-4abc-8def-0123456789ab" });
    expect(forms).toHaveLength(2);
    const xml = new TextDecoder().decode(submission.files[0].bytes);
    expect(xml.match(/<Form1099NECDetail>/g)).toHaveLength(2);
    expect(xml).toContain("<TotalReportedRcpntFormCnt>2</TotalReportedRcpntFormCnt>");
    const f1096 = JSON.parse(new TextDecoder().decode(submission.files[1].bytes));
    expect(f1096).toMatchObject({ box3_totalForms: 2, box5_totalAmountReported: dollars(7_500), sentToIrs: false });
    expect(submission.status).toBe("validated");
  });

  it("has no client until IRIS credentials exist", async () => {
    await expect(new IrisNotConfigured().submit()).rejects.toThrow(/TCC/);
  });

  it("writes the Connecticut 1099 file at 750 bytes per record", () => {
    const forms = build1099Necs(contractors, payments, 2026, employer.stateIds);
    const recs = ctNecFile({ year: 2026, transmitter: employer }, employer, forms).split("\r\n").filter(Boolean);
    expect(recs.map((r) => r[0])).toEqual(["T", "A", "B", "B", "C", "F"]);
    for (const r of recs) expect(r.length).toBe(750);
    expect(recs[1].slice(25, 27)).toBe("NE");
    expect(recs[2].slice(746, 748)).toBe("08");
    expect(recs[2].slice(668, 722).trim()).toBe("1234567000");
  });
});

describe("W-2 for SSA and Connecticut", () => {
  it("builds a ready-to-upload BSO submission with a clean EFW2 file", () => {
    const s = ssaW2Submission({ year: 2026, bsoUserId: "ABCD1234", submitter: employer }, employer, people);
    expect(s).toMatchObject({ channel: "ssa_bso", status: "ready_for_upload", errors: [] });
    expect(s.files[0].name).toBe("W2REPORT_2026_123456789.txt");
  });

  it("catches bad SSNs and record lengths", () => {
    const bad = "RA".padEnd(512) + "\r\n" + "RW000123456".padEnd(500) + "\r\n" + "RF".padEnd(512) + "\r\n";
    const errs = checkEfw2(bad);
    expect(errs.some((e) => e.includes("not 512"))).toBe(true);
    expect(errs.some((e) => e.includes("SSN"))).toBe(true);
  });

  it("writes the CT W-2 file with state code 09, CT TRN and totals", () => {
    const recs = ctW2File({ year: 2026, submitter: employer }, employer, people).split("\r\n").filter(Boolean);
    expect(recs.map((r) => r.slice(0, 2))).toEqual(["RA", "RE", "RS", "RS", "RT", "RF"]);
    for (const r of recs) expect(r.length).toBe(512);
    const rs = recs[2];
    expect(rs.slice(2, 4)).toBe("09");
    expect(rs.slice(273, 275)).toBe("09");
    expect(rs.slice(9, 18)).toBe("123456789");
    expect(rs.slice(247, 267).trim()).toBe("1234567000");
    const alice = people.find((p) => p.w2.employeeId === "alice")!.w2.states[0];
    expect(Number(rs.slice(275, 286))).toBe(alice.stateWages);
    expect(Number(rs.slice(286, 297))).toBe(alice.stateTax);
    const totalTax = people.reduce((s, p) => s + p.w2.states[0].stateTax, 0);
    expect(Number(recs[4].slice(2, 9))).toBe(2);
    expect(Number(recs[4].slice(24, 39))).toBe(totalTax);
    expect(Number(recs[5].slice(27, 43))).toBe(totalTax);
  });

  it("refuses a CT file without a CT Tax Registration Number", () => {
    expect(() => ctW2File({ year: 2026, submitter: employer }, { ...employer, stateIds: {} }, people)).toThrow(/Registration/);
  });

  it("produces the CT year-end set and CT-941 keying worksheet", () => {
    const subs = ctYearEndSubmissions(2026, employer, employer, people, [], 0);
    expect(subs.map((s) => s.form)).toEqual(["CT W-2", "CT-W3"]);
    expect(subs.every((s) => s.status === "ready_for_upload")).toBe(true);
    const ws = new TextDecoder().decode(subs[1].files[0].bytes);
    expect(ws).toContain("Line 4 Total CT tax withheld");
    const q = ct941Submission(records, 2026, 1, 0, employer);
    expect(new TextDecoder().decode(q.files[0].bytes)).toContain("CT TRN 1234567-000");
  });
});

describe("submission lifecycle", () => {
  it("only allows forward moves, and a rejection goes back to draft", () => {
    const s = mef941Submission(records, 2026, 2, 0, employer, agent, "monthly", now);
    const sent = advance(s, "transmitted", { agencyReference: "MSG1" });
    expect(() => advance(sent, "validated")).toThrow();
    const rej = advance(sent, "rejected");
    expect(advance(rej, "draft").status).toBe("draft");
    expect(() => advance(advance(sent, "accepted"), "rejected")).toThrow();
  });
});
