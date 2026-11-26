import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * Filled-in form PDFs drawn by the program. Each form is a title block (form number, tax period,
 * employer name, EIN, address) followed by the form's own line numbers and the computed amounts,
 * so the copy in the archive matches the return line for line.
 *
 * These are White Oak's completed copies for records, review and audits. They are not the IRS or
 * state paper form itself; the official paper form (where a state still takes paper) gets the same
 * numbers. Filling the official PDF templates field by field is the next step.
 */

export interface FormRow {
  line?: string;
  label: string;
  value: string;
}

export interface FormSection {
  heading?: string;
  rows: FormRow[];
}

export interface FormDoc {
  form: string;
  title: string;
  period: string;
  parties: { label: string; lines: string[] }[];
  sections: FormSection[];
  notes?: string[];
}

const M = 48;
const W = 612;
const H = 792;

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(readonly doc: PDFDocument, readonly font: PDFFont, readonly bold: PDFFont) {
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage([W, H]);
    this.y = H - M;
  }
  ensure(h: number) {
    if (this.y - h < M) this.newPage();
  }
  text(s: string, x: number, size = 10, f: PDFFont = this.font, color = rgb(0.1, 0.14, 0.12)) {
    this.page.drawText(sanitize(s), { x, y: this.y, size, font: f, color });
  }
  right(s: string, xRight: number, size = 10, f: PDFFont = this.font) {
    const t = sanitize(s);
    this.page.drawText(t, { x: xRight - f.widthOfTextAtSize(t, size), y: this.y, size, font: f });
  }
  rule() {
    this.page.drawLine({ start: { x: M, y: this.y + 4 }, end: { x: W - M, y: this.y + 4 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.78) });
  }
  wrap(s: string, size: number, width: number, f: PDFFont = this.font): string[] {
    const words = sanitize(s).split(" ");
    const out: string[] = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(next, size) > width && cur) {
        out.push(cur);
        cur = w;
      } else cur = next;
    }
    if (cur) out.push(cur);
    return out;
  }
}

/** Standard fonts only cover WinAnsi; replace anything outside it. */
function sanitize(s: string): string {
  return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7e\xa0-\xff]/g, "?");
}

export async function renderFormPdf(f: FormDoc): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${f.form} ${f.period}`);
  doc.setCreator("White Oak Payroll");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, font, bold);

  w.text(`Form ${f.form}`, M, 20, bold);
  w.right(f.period, W - M, 14, bold);
  w.y -= 18;
  for (const line of w.wrap(f.title, 11, W - 2 * M)) {
    w.text(line, M, 11);
    w.y -= 14;
  }
  w.y -= 6;
  w.rule();
  w.y -= 12;

  const colW = (W - 2 * M) / Math.max(1, f.parties.length);
  const startY = w.y;
  let minY = w.y;
  f.parties.forEach((p, i) => {
    w.y = startY;
    const x = M + i * colW;
    w.text(p.label.toUpperCase(), x, 8, bold, rgb(0.36, 0.42, 0.38));
    w.y -= 13;
    for (const l of p.lines) {
      w.text(l, x, 10);
      w.y -= 13;
    }
    minY = Math.min(minY, w.y);
  });
  w.y = minY - 6;
  w.rule();
  w.y -= 14;

  for (const s of f.sections) {
    if (s.heading) {
      w.ensure(40);
      w.text(s.heading, M, 11, bold);
      w.y -= 16;
    }
    for (const r of s.rows) {
      const labelLines = w.wrap(r.label, 10, W - 2 * M - 170);
      w.ensure(14 * labelLines.length + 4);
      if (r.line) w.text(r.line, M, 10, bold);
      labelLines.forEach((l, i) => {
        w.text(l, M + 40, 10);
        if (i === 0) w.right(r.value, W - M, 10, bold);
        w.y -= 13;
      });
      w.y -= 2;
      w.rule();
      w.y -= 6;
    }
    w.y -= 8;
  }

  const notes = [
    ...(f.notes ?? []),
    `Prepared by White Oak Payroll on ${new Date().toISOString().slice(0, 10)} from approved pay runs. Completed copy for the employer's records; amounts match the return line for line.`,
  ];
  for (const n of notes) {
    const lines = w.wrap(n, 8, W - 2 * M);
    w.ensure(lines.length * 10 + 4);
    for (const l of lines) {
      w.text(l, M, 8, font, rgb(0.36, 0.42, 0.38));
      w.y -= 10;
    }
    w.y -= 4;
  }

  return doc.save();
}

export const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
