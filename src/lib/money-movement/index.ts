import type { Cents } from "../money";
import { buildNachaFile, type AchEntry, type AchFile } from "./nacha";

/**
 * Money movement boundary. TD Bank (through Gabriel's business partner's agreement) will move the
 * money; nothing here talks to a bank yet. A pay run produces:
 *  1. a funding debit from the employer's account (net pay + taxes + our fee), CCD;
 *  2. direct deposit credits to employees and contractors, PPD;
 *  3. tax payments to the IRS (EFTPS) and states, on each deposit due date.
 * Funds should settle into a payroll trust/clearing account at TD before credits go out.
 */
export interface MoneyMovementProvider {
  /** Pull funding for a pay run. Returns a provider reference. */
  debitEmployer(input: { companyId: string; payRunId: string; amount: Cents; effectiveDate: string }): Promise<{ reference: string }>;
  /** Send direct deposits for a pay run. */
  sendCredits(input: { payRunId: string; entries: AchEntry[]; effectiveDate: string }): Promise<{ reference: string }>;
  /** Pay a tax agency. Federal: EFTPS (batch provider or ACH credit with TXP addenda). States: their ACH debit/credit programs. */
  payTax(input: { companyId: string; agency: TaxAgency; taxType: string; period: string; amount: Cents; dueDate: string }): Promise<{ reference: string }>;
  /** Status of a previously submitted item, including returns (R01 insufficient funds, R03 no account, ...). */
  status(reference: string): Promise<{ state: "pending" | "settled" | "returned"; returnCode?: string }>;
}

export type TaxAgency = "IRS" | "CT-DRS" | "CT-DOL" | "MA-DOR" | "MA-DUA" | "MA-PFML" | "OR-DOR" | "OR-PLO" | "NY-DTF" | "NY-PFL" | "CT-PL";

/**
 * Placeholder provider that writes NACHA files instead of calling a bank, so pay runs can be
 * exercised end to end in testing. Files are kept in memory; a real deployment would hand them to
 * TD over their SFTP or API channel.
 */
export class NachaFileProvider implements MoneyMovementProvider {
  readonly files: { reference: string; contents: string }[] = [];
  private seq = 0;

  constructor(private readonly header: Omit<AchFile, "batches" | "createdAt">, private readonly employerAccounts: Record<string, Omit<AchEntry, "amount" | "direction">>) {}

  private write(batch: AchFile["batches"][number]): string {
    const reference = `nacha-${++this.seq}`;
    this.files.push({ reference, contents: buildNachaFile({ ...this.header, createdAt: new Date(), batches: [batch] }) });
    return reference;
  }

  async debitEmployer(input: { companyId: string; payRunId: string; amount: Cents; effectiveDate: string }) {
    const acct = this.employerAccounts[input.companyId];
    if (!acct) throw new Error(`No funding account on file for company ${input.companyId}`);
    return {
      reference: this.write({
        companyName: this.header.originName,
        companyId: this.header.immediateOrigin,
        secCode: "CCD",
        entryDescription: "PAYROLL",
        effectiveDate: input.effectiveDate,
        entries: [{ ...acct, amount: input.amount, direction: "debit" }],
      }),
    };
  }

  async sendCredits(input: { payRunId: string; entries: AchEntry[]; effectiveDate: string }) {
    return {
      reference: this.write({
        companyName: this.header.originName,
        companyId: this.header.immediateOrigin,
        secCode: "PPD",
        entryDescription: "PAYROLL",
        effectiveDate: input.effectiveDate,
        entries: input.entries,
      }),
    };
  }

  async payTax(): Promise<{ reference: string }> {
    throw new Error("Tax payments are not wired up yet: EFTPS enrollment and state ACH programs come first (see docs/registrations.md).");
  }

  async status(reference: string) {
    return { state: this.files.some((f) => f.reference === reference) ? ("pending" as const) : ("returned" as const) };
  }
}

export { buildNachaFile, isValidRouting } from "./nacha";
export type { AchEntry, AchFile, AchBatch } from "./nacha";
