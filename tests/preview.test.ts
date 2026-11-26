import { describe, expect, it } from "vitest";
import { cleanPeopleInput, peopleFromInput, PEOPLE_MAX } from "@/lib/preview/people-count";
import { sampleRoster } from "@/lib/preview/sample-roster";

describe("people count input", () => {
  it("can be cleared to empty instead of 0", () => {
    expect(cleanPeopleInput("")).toBe("");
    expect(peopleFromInput("")).toBe(0);
  });
  it("drops leading zeros", () => {
    expect(cleanPeopleInput("01")).toBe("1");
    expect(cleanPeopleInput("0072")).toBe("72");
    expect(cleanPeopleInput("0")).toBe("0");
  });
  it("ignores non-digits and caps the value", () => {
    expect(cleanPeopleInput("1a2.5")).toBe("125");
    expect(cleanPeopleInput("99999999")).toBe(String(PEOPLE_MAX));
  });
});

describe("sample roster", () => {
  it("has exactly the requested number of unique employees", () => {
    const r = sampleRoster(72);
    expect(r).toHaveLength(72);
    expect(new Set(r.map((e) => e.employeeId)).size).toBe(72);
    expect(sampleRoster(0)).toEqual([]);
  });
});
