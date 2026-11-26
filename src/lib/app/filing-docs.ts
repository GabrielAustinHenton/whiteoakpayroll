import type { Cents } from "../money";
import {
  build1099Necs,
  buildW2s,
  ct941,
  ctW3,
  form1096,
  form940,
  form941,
  formOQ,
  inQuarter,
  inYear,
  m941,
  nys45,
  sumLines,
  w3Totals,
  type Contractor as NecContractor,
  type ContractorPaymentRecord,
  type Employer,
  type PaycheckRecord,
  type W2,
} from "../filings";
import { usd, type FormDoc } from "../pdf/form-pdf";

/**
 * Turns a company's paid paychecks and contractor payments into completed forms (data + layout)
 * for the filings archive. Figures come from the filings library; this file only lays them out.
 *
 * Deposits: money movement is a stub, so every tax is treated as deposited on time with its pay
 * run. When TD Bank payments are live, pass the actual deposits instead.
 */

export interface FilingCompany {
  legalName: string;
  ein: string;
  address: { line1: string; city: string; state: string; zip: string };
  /** State withholding account numbers by state. */
  stateIds: Record<string, string>;
  /** State unemployment account numbers by state. */
  uiIds: Record<string, string>;
}

export interface FilingPerson {
  id: string;
  name: string;
  ssn: string;
  address: { line1: string; city: string; state: string; zip: string };
}

export interface FilingInput {
  company: FilingCompany;
  records: PaycheckRecord[];
  employees: FilingPerson[];
  contractors: (FilingPerson & { tinType: "ssn" | "ein"; workState: string })[];
  contractorPayments: ContractorPaymentRecord[];
}

export interface GeneratedForm {
  form: string;
  period: string;
  recipient?: string;
  data: unknown;
  doc: FormDoc;
}

const addr = (a: FilingCompany["address"]) => [a.line1, `${a.city}, ${a.state} ${a.zip}`];
const n = (x: number) => String(x);

function employerParty(c: FilingCompany, extra: string[] = []) {
  return { label: "Employer", lines: [c.legalName, `EIN ${c.ein}`, ...addr(c.address), ...extra] };
}

function employer(c: FilingCompany): Employer {
  return {
    ein: c.ein,
    name: c.legalName,
    address: { line1: c.address.line1, city: c.address.city, state: c.address.state, zip: c.address.zip },
    contact: { name: "", phone: "", email: "" },
    stateIds: c.stateIds,
  };
}

function statesPaid(records: PaycheckRecord[]): string[] {
  const s = new Set<string>();
  for (const r of records) for (const l of r.result.lines) if (l.id.endsWith("_sui")) s.add(l.jurisdiction);
  return [...s].sort();
}

/** Quarterly returns: 941 and each state's quarterly return for states with wages this quarter. */
export function quarterForms(input: FilingInput, year: number, q: 1 | 2 | 3 | 4): GeneratedForm[] {
  const period = `${year}-Q${q}`;
  const recs = inQuarter(input.records, year, q);
  if (!recs.length) return [];
  const c = input.company;
  const out: GeneratedForm[] = [];

  const liability941 = ["federal_income", "social_security", "medicare", "additional_medicare", "social_security_er", "medicare_er"].reduce((s, id) => s + sumLines(recs, id), 0);
  const f = form941(input.records, year, q, liability941);
  out.push({
    form: "941",
    period,
    data: f,
    doc: {
      form: "941",
      title: "Employer's QUARTERLY Federal Tax Return",
      period: `Quarter ${q}, ${year}`,
      parties: [employerParty(c)],
      sections: [
        {
          heading: "Part 1: Answer these questions for this quarter",
          rows: [
            { line: "1", label: "Number of employees who received wages for the pay period including the 12th of the third month", value: n(f.line1_employees) },
            { line: "2", label: "Wages, tips, and other compensation", value: usd(f.line2_wages) },
            { line: "3", label: "Federal income tax withheld from wages, tips, and other compensation", value: usd(f.line3_incomeTaxWithheld) },
            { line: "5a", label: `Taxable social security wages ${usd(f.line5a_ssWages)} x 0.124`, value: usd(f.line5a_ssTax) },
            { line: "5b", label: `Taxable social security tips ${usd(f.line5b_ssTips)} x 0.124`, value: usd(f.line5b_ssTipsTax) },
            { line: "5c", label: `Taxable Medicare wages and tips ${usd(f.line5c_medicareWages)} x 0.029`, value: usd(f.line5c_medicareTax) },
            { line: "5d", label: `Wages subject to Additional Medicare Tax ${usd(f.line5d_addlMedicareWages)} x 0.009`, value: usd(f.line5d_addlMedicareTax) },
            { line: "5e", label: "Total social security and Medicare taxes", value: usd(f.line5e_total) },
            { line: "6", label: "Total taxes before adjustments", value: usd(f.line6_totalBeforeAdjustments) },
            { line: "7", label: "Current quarter's adjustment for fractions of cents", value: usd(f.line7_fractionsOfCents) },
            { line: "10", label: "Total taxes after adjustments", value: usd(f.line10_totalAfterAdjustments) },
            { line: "12", label: "Total taxes after adjustments and nonrefundable credits", value: usd(f.line12_totalAfterCredits) },
            { line: "13", label: "Total deposits for this quarter", value: usd(f.line13_deposits) },
            { line: "14", label: "Balance due", value: usd(f.line14_balanceDue) },
            { line: "15", label: "Overpayment", value: usd(f.line15_overpayment) },
          ],
        },
        {
          heading: "Part 2: Tax liability for the quarter (monthly schedule depositor)",
          rows: [
            { line: "16", label: "Month 1", value: usd(f.monthlyLiability[0]) },
            { line: "", label: "Month 2", value: usd(f.monthlyLiability[1]) },
            { line: "", label: "Month 3", value: usd(f.monthlyLiability[2]) },
            { line: "", label: "Total liability for quarter", value: usd(f.monthlyLiability.reduce((a, b) => a + b, 0)) },
          ],
        },
      ],
    },
  });

  for (const st of statesPaid(recs)) {
    if (st === "CT") {
      const paid = sumLines(recs, "ct_income");
      const r = ct941(input.records, year, q, paid);
      out.push({
        form: "CT-941",
        period,
        data: r,
        doc: {
          form: "CT-941",
          title: "Connecticut Quarterly Reconciliation of Withholding",
          period: `Quarter ${q}, ${year}`,
          parties: [employerParty(c, [`CT Tax Registration ${c.stateIds.CT ?? "(not set)"}`])],
          sections: [{ rows: [
            { line: "1", label: "Gross wages", value: usd(r.line1_grossWages) },
            { line: "2", label: "Gross Connecticut wages", value: usd(r.line2_ctWages) },
            { line: "3", label: "Connecticut tax withheld", value: usd(r.line3_ctTaxWithheld) },
            { line: "5", label: "Payments made for this quarter", value: usd(r.line5_payments) },
            { line: "8", label: "Balance due", value: usd(r.line8_balanceDue) },
            { line: "9", label: "Credit / overpayment", value: usd(r.line9_overpayment) },
          ] }],
        },
      });
    }
    if (st === "MA") {
      const paid = sumLines(recs, "ma_income");
      const r = m941(input.records, year, q, paid);
      out.push({
        form: "M-941",
        period,
        data: r,
        doc: {
          form: "M-941",
          title: "Massachusetts Employer's Return of Income Taxes Withheld",
          period: `Quarter ${q}, ${year}`,
          parties: [employerParty(c, [`MA account ${c.stateIds.MA ?? "(not set)"}`])],
          sections: [{ rows: [
            { line: "1", label: "Massachusetts income tax withheld", value: usd(r.massTaxWithheld) },
            { line: "2", label: "Payments made", value: usd(r.payments) },
            { line: "3", label: "Balance due", value: usd(r.balanceDue) },
          ] }],
        },
      });
    }
    if (st === "OR") {
      const r = formOQ(input.records, year, q);
      const names = new Map(input.employees.map((e) => [e.id, e]));
      out.push({
        form: "OQ",
        period,
        data: r,
        doc: {
          form: "OQ",
          title: "Oregon Combined Quarterly Tax Report (with Schedule B and Form 132)",
          period: `Quarter ${q}, ${year}`,
          parties: [employerParty(c, [`BIN ${c.stateIds.OR ?? "(not set)"}`, `UI account ${c.uiIds.OR ?? "(not set)"}`])],
          sections: [
            { heading: "Unemployment insurance", rows: [
              { line: "1", label: "Number of covered employees in pay period including the 12th: month 1 / 2 / 3", value: r.employeesByMonth.join(" / ") },
              { line: "2", label: "Total subject wages paid this quarter", value: usd(r.totalSubjectWages) },
              { line: "3", label: "Excess wages", value: usd(r.excessWages) },
              { line: "4", label: "Taxable UI wages", value: usd(r.taxableUiWages) },
              { line: "5", label: "UI tax", value: usd(r.uiTax) },
              { line: "6", label: "Workers' Benefit Fund hours (not tracked yet; enter from time records)", value: r.wbfHours === null ? "-" : n(r.wbfHours) },
            ] },
            { heading: "Withholding and transit", rows: [
              { line: "9", label: "Oregon income tax withheld", value: usd(r.withholding) },
              { line: "10", label: "Statewide transit tax withheld", value: usd(r.statewideTransitTax) },
            ] },
            { heading: "Schedule B: monthly withholding liability", rows: r.scheduleB_monthlyWithholding.map((v, i) => ({ line: `M${i + 1}`, label: `Month ${i + 1}`, value: usd(v) })) },
            { heading: "Form 132: employee detail", rows: r.form132.map((x) => {
              const p = names.get(x.employeeId);
              return { label: `${p?.name ?? x.employeeId} (SSN ${p?.ssn ?? ""})`, value: usd(x.wages) };
            }) },
          ],
        },
      });
    }
    if (st === "NY") {
      const r = nys45(input.records, year, q);
      const names = new Map(input.employees.map((e) => [e.id, e]));
      out.push({
        form: "NYS-45",
        period,
        data: r,
        doc: {
          form: "NYS-45",
          title: "Quarterly Combined Withholding, Wage Reporting, and Unemployment Insurance Return",
          period: `Quarter ${q}, ${year}`,
          parties: [employerParty(c, [`Withholding ID ${c.stateIds.NY ?? "(not set)"}`, `UI ER no. ${c.uiIds.NY ?? "(not set)"}`])],
          sections: [
            { heading: "Part A: Unemployment insurance", rows: [
              { line: "1", label: "Employees in pay period including the 12th: month 1 / 2 / 3", value: r.partA.employeesByMonth.join(" / ") },
              { line: "2", label: "Total remuneration paid this quarter", value: usd(r.partA.totalRemuneration) },
              { line: "3", label: "Remuneration over the wage base", value: usd(r.partA.remunerationOverBase) },
              { line: "4", label: "Wages subject to contributions", value: usd(r.partA.taxableWages) },
              { line: "5", label: "UI contributions due", value: usd(r.partA.uiContributions) },
              { line: "6", label: "Re-employment Service Fund", value: usd(r.partA.reemploymentServiceFund) },
            ] },
            { heading: "Part B: Withholding", rows: [
              { line: "12", label: "New York State tax withheld", value: usd(r.partB.nysWithheld) },
              { line: "13", label: "New York City tax withheld", value: usd(r.partB.nycWithheld) },
              { line: "14", label: "Yonkers tax withheld", value: usd(r.partB.yonkersWithheld) },
            ] },
            { heading: "Part C: Employee wage and withholding information", rows: r.partC.map((x) => {
              const p = names.get(x.employeeId);
              return { label: `${p?.name ?? x.employeeId} (SSN ${p?.ssn ?? ""})`, value: usd(x.uiRemuneration) };
            }) },
          ],
        },
      });
    }
  }
  return out;
}

function w2Doc(c: FilingCompany, p: FilingPerson | undefined, w: W2): FormDoc {
  return {
    form: "W-2",
    title: "Wage and Tax Statement",
    period: String(w.year),
    parties: [
      employerParty(c),
      { label: "Employee", lines: p ? [p.name, `SSN ${p.ssn}`, ...addr(p.address)] : [w.employeeId] },
    ],
    sections: [
      { rows: [
        { line: "1", label: "Wages, tips, other compensation", value: usd(w.box1_wages) },
        { line: "2", label: "Federal income tax withheld", value: usd(w.box2_federalTax) },
        { line: "3", label: "Social security wages", value: usd(w.box3_ssWages) },
        { line: "4", label: "Social security tax withheld", value: usd(w.box4_ssTax) },
        { line: "5", label: "Medicare wages and tips", value: usd(w.box5_medicareWages) },
        { line: "6", label: "Medicare tax withheld", value: usd(w.box6_medicareTax) },
        { line: "7", label: "Social security tips", value: usd(w.box7_ssTips) },
        { line: "10", label: "Dependent care benefits", value: usd(w.box10_dependentCare) },
        ...Object.entries(w.box12).map(([code, v]) => ({ line: "12", label: `Code ${code}`, value: usd(v ?? 0) })),
        { line: "13", label: "Retirement plan", value: w.box13_retirementPlan ? "X" : "" },
        ...Object.entries(w.box14).map(([k, v]) => ({ line: "14", label: k, value: usd(v) })),
      ] },
      { heading: "State and local", rows: [
        ...w.states.flatMap((s) => [
          { line: "15", label: `State ${s.state}, employer state ID ${s.stateId || "(not set)"}`, value: "" },
          { line: "16", label: "State wages", value: usd(s.stateWages) },
          { line: "17", label: "State income tax", value: usd(s.stateTax) },
        ]),
        ...w.locals.flatMap((l) => [
          { line: "18", label: `Local wages (${l.locality})`, value: usd(l.localWages) },
          { line: "19", label: "Local income tax", value: usd(l.localTax) },
        ]),
      ] },
    ],
  };
}

/** Year-end forms: 940, W-2s, W-3, 1099-NECs, 1096 (always, for CT audits), CT-W3 when CT wages. */
export function yearForms(input: FilingInput, year: number): GeneratedForm[] {
  const period = String(year);
  const c = input.company;
  const recs = inYear(input.records, year);
  const out: GeneratedForm[] = [];
  const people = new Map(input.employees.map((e) => [e.id, e]));

  let w2s: W2[] = [];
  if (recs.length) {
    const states = statesPaid(recs);
    const futaPaid = sumLines(recs, "futa");
    const f = form940(input.records, year, futaPaid, states);
    out.push({
      form: "940",
      period,
      data: f,
      doc: {
        form: "940",
        title: "Employer's Annual Federal Unemployment (FUTA) Tax Return",
        period,
        parties: [employerParty(c)],
        sections: [
          { rows: [
            { line: "1a", label: "State where you paid state unemployment tax (multi = Schedule A)", value: f.line1a_state },
            { line: "3", label: "Total payments to all employees", value: usd(f.line3_totalPayments) },
            { line: "4", label: "Payments exempt from FUTA tax", value: usd(f.line4_exemptPayments) },
            { line: "5", label: "Total of payments made to each employee in excess of $7,000", value: usd(f.line5_over7000) },
            { line: "6", label: "Subtotal (line 4 + line 5)", value: usd(f.line6_subtotal) },
            { line: "7", label: "Total taxable FUTA wages", value: usd(f.line7_futaWages) },
            { line: "8", label: "FUTA tax before adjustments (line 7 x 0.006)", value: usd(f.line8_futaBeforeAdjustments) },
            { line: "11", label: "Credit reduction (Schedule A)", value: usd(f.line11_creditReduction) },
            { line: "12", label: "Total FUTA tax after adjustments", value: usd(f.line12_totalFuta) },
            { line: "13", label: "FUTA tax deposited for the year", value: usd(f.line13_deposits) },
            { line: "14", label: "Balance due", value: usd(f.line14_balanceDue) },
            { line: "15", label: "Overpayment", value: usd(f.line15_overpayment) },
          ] },
          { heading: "Part 5: FUTA tax liability by quarter", rows: f.quarterlyLiability.map((v, i) => ({ line: `16${"abcd"[i]}`, label: `Quarter ${i + 1}`, value: usd(v) })) },
        ],
      },
    });

    w2s = buildW2s(input.records, year, employer(c));
    for (const w of w2s) {
      const p = people.get(w.employeeId);
      out.push({ form: "W-2", period, recipient: p?.name ?? w.employeeId, data: w, doc: w2Doc(c, p, w) });
    }
    const t = w3Totals(w2s);
    out.push({
      form: "W-3",
      period,
      data: t,
      doc: {
        form: "W-3",
        title: "Transmittal of Wage and Tax Statements",
        period,
        parties: [employerParty(c)],
        sections: [{ rows: [
          { line: "c", label: "Total number of Forms W-2", value: n(t.count) },
          { line: "1", label: "Wages, tips, other compensation", value: usd(t.box1) },
          { line: "2", label: "Federal income tax withheld", value: usd(t.box2) },
          { line: "3", label: "Social security wages", value: usd(t.box3) },
          { line: "4", label: "Social security tax withheld", value: usd(t.box4) },
          { line: "5", label: "Medicare wages and tips", value: usd(t.box5) },
          { line: "6", label: "Medicare tax withheld", value: usd(t.box6) },
          { line: "7", label: "Social security tips", value: usd(t.box7) },
          { line: "10", label: "Dependent care benefits", value: usd(t.box10) },
          { line: "12a", label: "Deferred compensation (codes D, AA)", value: usd(t.box12D + t.box12AA) },
        ] }],
      },
    });
  }

  // 1099-NEC and 1096.
  const necContractors: NecContractor[] = input.contractors.map((k) => ({
    id: k.id,
    tin: k.ssn,
    tinType: k.tinType,
    name: k.name,
    address: { line1: k.address.line1, city: k.address.city, state: k.address.state, zip: k.address.zip },
    state: k.workState,
  }));
  const necs = build1099Necs(necContractors, input.contractorPayments, year, c.stateIds);
  for (const f of necs) {
    out.push({
      form: "1099-NEC",
      period,
      recipient: f.contractor.name,
      data: f,
      doc: {
        form: "1099-NEC",
        title: "Nonemployee Compensation",
        period,
        parties: [
          { label: "Payer", lines: [c.legalName, `TIN ${c.ein}`, ...addr(c.address)] },
          { label: "Recipient", lines: [f.contractor.name, `TIN ${f.contractor.tin}`, f.contractor.address.line1, `${f.contractor.address.city}, ${f.contractor.address.state} ${f.contractor.address.zip}`] },
        ],
        sections: [{ rows: [
          { line: "1", label: "Nonemployee compensation", value: usd(f.box1_nonemployeeComp) },
          { line: "4", label: "Federal income tax withheld", value: usd(f.box4_federalTaxWithheld) },
          { line: "5", label: "State tax withheld", value: usd(f.box5_stateTaxWithheld) },
          { line: "6", label: "State / Payer's state no.", value: `${f.contractor.state ?? ""} ${f.box6_statePayerNumber}`.trim() },
          { line: "7", label: "State income", value: usd(f.box7_stateIncome) },
        ] }],
      },
    });
  }
  const anyContractorPay = input.contractorPayments.some((p) => p.paidOn.startsWith(`${year}-`));
  if (anyContractorPay || necs.length) {
    // Always archive a 1096, even when the 1099s are e-filed: Connecticut auditors ask for it.
    const t = form1096(necs, year, { name: c.legalName, ein: c.ein }, true);
    out.push({
      form: "1096",
      period,
      data: t,
      doc: {
        form: "1096",
        title: "Annual Summary and Transmittal of U.S. Information Returns",
        period,
        parties: [{ label: "Filer", lines: [c.legalName, `EIN ${c.ein}`, ...addr(c.address)] }],
        sections: [{ rows: [
          { line: "3", label: "Total number of forms", value: n(t.box3_totalForms) },
          { line: "4", label: "Federal income tax withheld", value: usd(t.box4_federalTaxWithheld) },
          { line: "5", label: "Total amount reported with this Form 1096", value: usd(t.box5_totalAmountReported) },
          { line: "6", label: "Type of form", value: "1099-NEC" },
        ] }],
        notes: [
          t.box3_totalForms === 0
            ? "No contractor reached the 1099-NEC reporting threshold this year; this 1096 is kept for the record."
            : "Kept for the employer's records and state audits (Connecticut asks for Form 1096). When 1099s are e-filed through IRIS, the IRS does not need this transmittal.",
        ],
      },
    });
  }

  const ctWages = w2s.some((w) => w.states.some((s) => s.state === "CT"));
  if (ctWages) {
    const paid = sumLines(recs, "ct_income");
    const r = ctW3(w2s, necs, year, paid);
    out.push({
      form: "CT-W3",
      period,
      data: r,
      doc: {
        form: "CT-W3",
        title: "Connecticut Annual Reconciliation of Withholding",
        period,
        parties: [employerParty(c, [`CT Tax Registration ${c.stateIds.CT ?? "(not set)"}`])],
        sections: [{ rows: [
          { line: "", label: "Number of Forms W-2 / 1099 with CT withholding", value: `${r.w2Count} / ${r.form1099Count}` },
          { line: "1", label: "Gross Connecticut wages", value: usd(r.line1_grossCtWages) },
          { line: "2", label: "Connecticut tax withheld (W-2)", value: usd(r.line2_ctTaxWithheldW2) },
          { line: "3", label: "Connecticut tax withheld (1099)", value: usd(r.line3_ctTaxWithheld1099) },
          { line: "4", label: "Total Connecticut tax withheld", value: usd(r.line4_totalCtTaxWithheld) },
          { line: "5", label: "Connecticut tax paid for the year", value: usd(r.line5_paidForYear) },
          { line: "6", label: "Balance due", value: usd(r.line6_balanceDue) },
          { line: "7", label: "Overpayment", value: usd(r.line7_overpayment) },
        ] }],
      },
    });
  }
  return out;
}

export type { Cents };
