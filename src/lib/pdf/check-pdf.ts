import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * Paper checks in the standard "voucher" layout (8.5 x 11): the check in the top third, two
 * matching stubs below (one for the employee, one for the employer's records).
 *
 * Printed on pre-printed blank check stock that already carries the bank's MICR line (routing,
 * account, check number) — the same stock QuickBooks and other payroll systems print on. We print
 * the date, payee, amounts, memo and our check number in the standard positions, so no MICR toner
 * or full bank account number is needed.
 */

export interface CheckStubRow {
  label: string;
  current: string;
  ytd?: string;
}

export interface CheckPrint {
  number: number;
  date: string;
  payee: string;
  payeeAddress: string[];
  amountCents: number;
  memo: string;
  payer: { name: string; address: string[]; bankName?: string | null };
  stub: { title: string; rows: CheckStubRow[]; footer: string[] };
  void?: boolean;
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function under1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (r >= 20) parts.push(TENS[Math.floor(r / 10)] + (r % 10 ? `-${ONES[r % 10]}` : ""));
  else if (r) parts.push(ONES[r]);
  return parts.join(" ");
}

/** 1234.56 -> "One Thousand Two Hundred Thirty-Four and 56/100". */
export function amountInWords(cents: number): string {
  const dollars = Math.floor(cents / 100);
  const c = String(cents % 100).padStart(2, "0");
  if (dollars === 0) return `Zero and ${c}/100`;
  const scales = ["", " Thousand", " Million"];
  const parts: string[] = [];
  let n = dollars;
  let i = 0;
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk) parts.unshift(under1000(chunk) + scales[i]);
    n = Math.floor(n / 1000);
    i++;
  }
  return `${parts.join(" ")} and ${c}/100`;
}

const money = (cents: number) => (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function text(p: PDFPage, s: string, x: number, y: number, size: number, f: PDFFont) {
  p.drawText(s.replace(/[^\x20-\x7e]/g, "?"), { x, y, size, font: f, color: rgb(0, 0, 0) });
}

function right(p: PDFPage, s: string, xr: number, y: number, size: number, f: PDFFont) {
  text(p, s, xr - f.widthOfTextAtSize(s, size), y, size, f);
}

function stub(p: PDFPage, c: CheckPrint, top: number, font: PDFFont, bold: PDFFont) {
  let y = top - 30;
  text(p, c.payer.name, 36, y, 10, bold);
  right(p, `Check ${c.number}   ${c.date}`, 576, y, 10, bold);
  y -= 14;
  text(p, `${c.stub.title}: ${c.payee}`, 36, y, 9, font);
  y -= 18;
  text(p, "", 36, y, 8, bold);
  right(p, "This check", 470, y, 8, bold);
  right(p, "Year to date", 576, y, 8, bold);
  y -= 12;
  for (const r of c.stub.rows.slice(0, 14)) {
    text(p, r.label, 36, y, 8, font);
    right(p, r.current, 470, y, 8, font);
    if (r.ytd) right(p, r.ytd, 576, y, 8, font);
    y -= 11;
  }
  y -= 4;
  for (const f of c.stub.footer) {
    text(p, f, 36, y, 8, font);
    y -= 11;
  }
}

export async function renderChecksPdf(checks: CheckPrint[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Checks");
  doc.setCreator("White Oak Payroll");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const courier = await doc.embedFont(StandardFonts.CourierBold);
  for (const c of checks) {
    const p = doc.addPage([612, 792]);
    // Check (top third: y 528-792).
    text(p, c.payer.name, 36, 750, 11, bold);
    c.payer.address.forEach((l, i) => text(p, l, 36, 737 - i * 11, 8, font));
    if (c.payer.bankName) text(p, c.payer.bankName, 300, 750, 8, font);
    right(p, String(c.number), 576, 750, 12, bold);
    text(p, "DATE", 430, 712, 7, font);
    right(p, c.date, 576, 712, 11, courier);
    text(p, "PAY TO THE", 36, 676, 7, font);
    text(p, "ORDER OF", 36, 668, 7, font);
    text(p, c.payee, 90, 670, 11, courier);
    right(p, `**${money(c.amountCents)}`, 576, 670, 12, courier);
    const words = `${amountInWords(c.amountCents)} `;
    text(p, `${words}${"*".repeat(Math.max(0, 80 - words.length))}`, 36, 644, 10, courier);
    right(p, "DOLLARS", 576, 644, 8, font);
    c.payeeAddress.forEach((l, i) => text(p, l, 90, 620 - i * 11, 9, font));
    text(p, `MEMO ${c.memo}`, 36, 566, 8, font);
    p.drawLine({ start: { x: 380, y: 574 }, end: { x: 576, y: 574 }, thickness: 0.5 });
    text(p, "AUTHORIZED SIGNATURE", 420, 564, 6, font);
    if (c.void) {
      p.drawText("VOID", { x: 220, y: 620, size: 64, font: bold, color: rgb(0.8, 0.1, 0.1), opacity: 0.6 });
    }
    // Perforations at 1/3 and 2/3.
    for (const y of [528, 264]) p.drawLine({ start: { x: 18, y }, end: { x: 594, y }, thickness: 0.3, dashArray: [3, 3], color: rgb(0.6, 0.6, 0.6) });
    stub(p, c, 528, font, bold);
    stub(p, c, 264, font, bold);
  }
  return doc.save();
}
