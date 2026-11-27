/**
 * Hours from a time clock export (BuddyPunch "Payroll Export" or "Hours Summary" saved as CSV, or
 * any similar sheet). Finds the header row, the employee name column(s) and the regular, overtime
 * and total hours columns, then adds up hours per person (exports can have one row per day).
 */

export interface ImportedHours {
  name: string;
  regular: number;
  overtime: number;
  /** Double-time hours we do not pay automatically; flagged for review. */
  doubleTime: number;
}

export interface TimeImport {
  people: ImportedHours[];
  warnings: string[];
}

/** RFC 4180-ish CSV: quoted fields, doubled quotes, commas/newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === "\t") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

/** "8.5", "8:30" (h:mm) or "8h 30m" to decimal hours. */
export function parseHours(v: string): number {
  const t = v.trim();
  if (!t) return 0;
  let m = /^(-?\d+):(\d{1,2})(?::\d{1,2})?$/.exec(t);
  if (m) return Number(m[1]) + Number(m[2]) / 60;
  m = /^(\d+)\s*h(?:ours?)?\s*(?:(\d+)\s*m(?:in)?)?$/i.exec(t);
  if (m) return Number(m[1]) + Number(m[2] ?? 0) / 60;
  const n = Number(t.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
const is = (h: string, ...res: RegExp[]) => res.some((r) => r.test(norm(h)));

function columns(header: string[]) {
  const find = (...res: RegExp[]) => header.findIndex((h) => is(h, ...res));
  return {
    name: find(/^(employee|employee name|name|full name|employee full name|staff|staff name)$/),
    first: find(/^(first|first name|employee first name)$/),
    last: find(/^(last|last name|employee last name)$/),
    regular: find(/^(regular|reg|regular hours|reg hours|regular hrs|reg hrs|regular time)$/),
    overtime: find(/^(overtime|ot|overtime hours|ot hours|overtime hrs|ot hrs|weekly overtime|daily overtime)$/),
    doubleTime: find(/^(double time|doubletime|dt|double time hours|dt hours)$/),
    total: find(/^(total|total hours|total hrs|hours|total time|total worked|worked hours)$/),
  };
}

export function readTimeExport(text: string): TimeImport {
  const rows = parseCsv(text);
  const warnings: string[] = [];
  const headerAt = rows.findIndex((r) => {
    const c = columns(r);
    return (c.name >= 0 || (c.first >= 0 && c.last >= 0)) && (c.regular >= 0 || c.total >= 0);
  });
  if (headerAt < 0) return { people: [], warnings: ["Couldn't find the columns. The file needs an employee name column and a Regular (or Total) hours column. In BuddyPunch, export the Payroll Export or Hours Summary report as CSV."] };
  const c = columns(rows[headerAt]);
  if (c.regular < 0) warnings.push("No Regular hours column, so Total hours were used as regular hours with no overtime.");
  const by = new Map<string, ImportedHours>();
  for (const r of rows.slice(headerAt + 1)) {
    const name = c.name >= 0 ? r[c.name] ?? "" : `${r[c.first] ?? ""} ${r[c.last] ?? ""}`.trim();
    if (!name || /^(total|totals|grand total)\b/i.test(name)) continue;
    const regular = parseHours(r[c.regular >= 0 ? c.regular : c.total] ?? "");
    const overtime = c.regular >= 0 && c.overtime >= 0 ? parseHours(r[c.overtime] ?? "") : 0;
    const doubleTime = c.doubleTime >= 0 ? parseHours(r[c.doubleTime] ?? "") : 0;
    const key = nameKey(name);
    const p = by.get(key) ?? { name, regular: 0, overtime: 0, doubleTime: 0 };
    p.regular += regular;
    p.overtime += overtime;
    p.doubleTime += doubleTime;
    by.set(key, p);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  const people = [...by.values()].map((p) => ({ ...p, regular: round(p.regular), overtime: round(p.overtime), doubleTime: round(p.doubleTime) }));
  for (const p of people) if (p.doubleTime > 0) warnings.push(`${p.name} has ${p.doubleTime} double-time hours. Those are not added; enter them as a bonus if owed.`);
  return { people, warnings };
}

/** Match key for a person's name: lowercase letters, "Last, First" turned around, middle initials dropped. */
export function nameKey(name: string): string {
  let n = name.trim();
  const comma = /^([^,]+),\s*(.+)$/.exec(n);
  if (comma) n = `${comma[2]} ${comma[1]}`;
  const parts = n.toLowerCase().replace(/[^a-z\s'-]/g, " ").replace(/['-]/g, "").split(/\s+/).filter(Boolean);
  const kept = parts.filter((p, i) => !(p.length === 1 && i > 0 && i < parts.length - 1));
  return kept.length >= 2 ? `${kept[0]} ${kept[kept.length - 1]}` : kept.join(" ");
}
