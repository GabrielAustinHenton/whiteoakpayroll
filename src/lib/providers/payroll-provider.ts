import type { Cents } from "../money";

/**
 * Boundary to the embedded payroll provider (e.g. Check). The provider calculates withholding,
 * moves money over ACH, and files with agencies. Keeping it behind this interface lets us swap
 * providers or bring parts in-house later.
 */
export interface PayrollProvider {
  createCompany(input: { legalName: string; ein: string; states: string[] }): Promise<{ providerCompanyId: string }>;
  createEmployee(input: { providerCompanyId: string; firstName: string; lastName: string; workState: string }): Promise<{ providerEmployeeId: string }>;
  createContractor(input: { providerCompanyId: string; name: string; tinType: "ssn" | "ein" }): Promise<{ providerContractorId: string }>;
  previewPayroll(input: { providerCompanyId: string; payday: string; items: PayrollItem[] }): Promise<PayrollPreview>;
  approvePayroll(providerPayrollId: string): Promise<{ status: "approved" | "failed" }>;
  /** Year-end and quarterly forms (941, 940, W-2/W-3, 1099-NEC, state returns). */
  listFilings(providerCompanyId: string, year: number): Promise<FilingRecord[]>;
}

export interface PayrollItem {
  providerEmployeeId: string;
  earnings: { type: "regular" | "overtime" | "bonus" | "reimbursement"; amount: Cents; hours?: number }[];
  postTaxDeductions?: { type: "advance_repayment" | "state_retirement" | "other"; amount: Cents }[];
}

export interface PayrollPreview {
  providerPayrollId: string;
  employeeTaxes: Cents;
  employerTaxes: Cents;
  netPay: Cents;
}

export interface FilingRecord {
  form: string;
  period: string;
  status: "pending" | "filed" | "accepted" | "rejected";
}
