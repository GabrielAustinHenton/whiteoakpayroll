import { describe, expect, it } from "vitest";
import { nameKey, parseCsv, parseHours, readTimeExport } from "@/lib/app/time-import";
import { computePaycheck, overtimeWages } from "@/lib/app/engine";

describe("time clock import", () => {
  it("parses quoted CSV", () => {
    expect(parseCsv('a,"b, c","d ""e"""\r\n1,2,3\n')).toEqual([["a", "b, c", 'd "e"'], ["1", "2", "3"]]);
  });

  it("reads hours in decimal and h:mm", () => {
    expect(parseHours("8.5")).toBe(8.5);
    expect(parseHours("7:45")).toBe(7.75);
    expect(parseHours("")).toBe(0);
  });

  it("matches names written either way", () => {
    expect(nameKey("Lopez, Maria J.")).toBe(nameKey("Maria Lopez"));
    expect(nameKey("  MARIA   lopez ")).toBe("maria lopez");
  });

  it("finds the header under a title, sums rows per person and skips totals", () => {
    const csv = [
      "Payroll Export,11/01/2026 - 11/14/2026",
      "",
      "Employee Name,Regular Hours,Overtime Hours,Double Time Hours,Total Hours",
      '"Lopez, Maria",40,2.5,0,42.5',
      "\"Lopez, Maria\",38:30,0,0,38.5",
      "Sam Ng,80,0,1,81",
      "Total,158.5,2.5,1,162",
    ].join("\n");
    const r = readTimeExport(csv);
    expect(r.people).toEqual([
      { name: "Lopez, Maria", regular: 78.5, overtime: 2.5, doubleTime: 0 },
      { name: "Sam Ng", regular: 80, overtime: 0, doubleTime: 1 },
    ]);
    expect(r.warnings.join(" ")).toMatch(/Sam Ng has 1 double-time/);
  });

  it("uses first and last name columns and a total column when there is no regular column", () => {
    const r = readTimeExport("First Name,Last Name,Total Hours\nAna,Diaz,30\n");
    expect(r.people).toEqual([{ name: "Ana Diaz", regular: 30, overtime: 0, doubleTime: 0 }]);
    expect(r.warnings[0]).toMatch(/Total hours were used/);
  });

  it("explains a file it can't read", () => {
    expect(readTimeExport("foo,bar\n1,2").warnings[0]).toMatch(/Couldn't find the columns/);
  });
});

describe("overtime", () => {
  it("pays 1.5x the hourly rate and none for salaried", () => {
    expect(overtimeWages({ payBasis: "HOURLY", payRateCents: 2000 }, 2)).toBe(6000);
    expect(overtimeWages({ payBasis: "SALARIED", payRateCents: 5_000_000 }, 2)).toBe(0);
  });
});
void computePaycheck;
