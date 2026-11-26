import type { Cents } from "../money";

/**
 * NACHA (ACH) file writer: 94-character records, blocked to multiples of 10 lines.
 * This is a placeholder for the TD Bank integration. TD's ACH origination agreement will set the
 * immediate destination/origin values, company ID, balanced vs unbalanced files, cutoff times and
 * whether an offsetting debit entry is required; confirm each against TD's file specification.
 */

export type AccountType = "checking" | "savings";

export interface AchEntry {
  /** 9-digit ABA routing number including check digit. */
  routing: string;
  account: string;
  accountType: AccountType;
  direction: "credit" | "debit";
  amount: Cents;
  /** Employee or payee identifier (15 chars max). */
  individualId: string;
  name: string;
}

export interface AchBatch {
  companyName: string;
  /** 10-character company identification assigned by the ODFI (often "1" + EIN). */
  companyId: string;
  /** PPD for consumer accounts (direct deposit), CCD for business accounts (employer funding). */
  secCode: "PPD" | "CCD";
  entryDescription: string;
  /** YYYY-MM-DD the funds should settle. */
  effectiveDate: string;
  entries: AchEntry[];
}

export interface AchFile {
  /** ODFI routing (TD Bank) as immediate destination. */
  immediateDestination: string;
  destinationName: string;
  /** Usually the originator's 10-digit ID from the bank. */
  immediateOrigin: string;
  originName: string;
  /** 8-digit ODFI identification (first 8 digits of the ODFI routing number). */
  odfiId: string;
  createdAt: Date;
  fileIdModifier?: string;
  batches: AchBatch[];
}

export function isValidRouting(r: string): boolean {
  if (!/^\d{9}$/.test(r)) return false;
  const d = r.split("").map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}

const alpha = (s: string, n: number) => s.toUpperCase().replace(/[^A-Z0-9 .,&'/-]/g, " ").slice(0, n).padEnd(n, " ");
const num = (v: number | string, n: number) => {
  const s = String(v);
  if (s.length > n) throw new Error(`Numeric field overflow: ${s} > ${n} digits`);
  return s.padStart(n, "0");
};
const yymmdd = (iso: string) => iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);

function transactionCode(e: AchEntry): string {
  if (e.accountType === "checking") return e.direction === "credit" ? "22" : "27";
  return e.direction === "credit" ? "32" : "37";
}

export function buildNachaFile(f: AchFile): string {
  for (const b of f.batches) for (const e of b.entries) if (!isValidRouting(e.routing)) throw new Error(`Invalid routing number for ${e.individualId}`);
  const lines: string[] = [];
  const iso = f.createdAt.toISOString();
  lines.push(
    "1" + "01" + (" " + f.immediateDestination).slice(-10).padStart(10, " ") + (f.immediateOrigin.padStart(10, " ")).slice(-10) +
      yymmdd(iso.slice(0, 10)) + iso.slice(11, 13) + iso.slice(14, 16) + (f.fileIdModifier ?? "A") + "094" + "10" + "1" +
      alpha(f.destinationName, 23) + alpha(f.originName, 23) + alpha("", 8),
  );

  let fileEntries = 0;
  let fileHash = 0;
  let fileDebit = 0;
  let fileCredit = 0;
  f.batches.forEach((b, i) => {
    const batchNo = num(i + 1, 7);
    const credits = b.entries.filter((e) => e.direction === "credit");
    const debits = b.entries.filter((e) => e.direction === "debit");
    const service = credits.length && debits.length ? "200" : credits.length ? "220" : "225";
    lines.push(
      "5" + service + alpha(b.companyName, 16) + alpha("", 20) + alpha(b.companyId, 10) + b.secCode + alpha(b.entryDescription, 10) +
        alpha("", 6) + yymmdd(b.effectiveDate) + "   " + "1" + num(f.odfiId, 8) + batchNo,
    );
    let hash = 0;
    let debit = 0;
    let credit = 0;
    b.entries.forEach((e, j) => {
      hash += Number(e.routing.slice(0, 8));
      if (e.direction === "credit") credit += e.amount;
      else debit += e.amount;
      lines.push(
        "6" + transactionCode(e) + e.routing.slice(0, 8) + e.routing[8] + alpha(e.account, 17) + num(e.amount, 10) +
          alpha(e.individualId, 15) + alpha(e.name, 22) + "  " + "0" + num(f.odfiId, 8) + num(j + 1, 7),
      );
    });
    const hashStr = String(hash).slice(-10);
    lines.push(
      "8" + service + num(b.entries.length, 6) + num(hashStr, 10) + num(debit, 12) + num(credit, 12) + alpha(b.companyId, 10) +
        alpha("", 19) + alpha("", 6) + num(f.odfiId, 8) + batchNo,
    );
    fileEntries += b.entries.length;
    fileHash += hash;
    fileDebit += debit;
    fileCredit += credit;
  });

  const recordCount = lines.length + 1;
  const blocks = Math.ceil(recordCount / 10);
  lines.push(
    "9" + num(f.batches.length, 6) + num(blocks, 6) + num(fileEntries, 8) + num(String(fileHash).slice(-10), 10) + num(fileDebit, 12) +
      num(fileCredit, 12) + alpha("", 39),
  );
  while (lines.length % 10 !== 0) lines.push("9".repeat(94));
  for (const l of lines) if (l.length !== 94) throw new Error(`NACHA record is ${l.length} characters: ${l.slice(0, 10)}`);
  return lines.join("\n") + "\n";
}
