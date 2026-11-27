import { describe, expect, it } from "vitest";
import { actionsIn, describeActivity } from "@/lib/app/activity";

const names = { employees: new Map([["e1", "Ana Ortiz"]]), contractors: new Map([["c1", "Sparks LLC"]]) };
const actors = new Map([["u1", "Olga"]]);
const row = (action: string, detail: unknown, actorId: string | null = "u1") => describeActivity({ id: "x", createdAt: new Date(), action, detail, actorId }, actors, names);

describe("activity log", () => {
  it("names people and formats money", () => {
    expect(row("employee.terminated", { employeeId: "e1", date: "2026-11-01" }).text).toBe("Ended employment for Ana Ortiz on 2026-11-01");
    expect(row("payrun.approved", { cashNeededCents: 123456 }).text).toBe("Approved a pay run ($1,234.56 total)");
    expect(row("advance.recorded", { employeeId: "e1", amount: 20000 }).text).toBe("Recorded an advance for Ana Ortiz ($200.00)");
    expect(row("contractor.created", { contractorId: "c1" }).text).toBe("Added contractor Sparks LLC");
  });
  it("labels actors and unknown actions", () => {
    expect(row("company.updated", null).actorName).toBe("Olga");
    expect(row("company.updated", null, null).actorName).toBe("White Oak (automatic)");
    expect(row("company.updated", null, "gone").actorName).toBe("Someone (login removed)");
    expect(row("something.new_thing", {}).text).toBe("something new thing");
  });
  it("filters by category", () => {
    expect(actionsIn("access")).toContain("admin.viewed");
    expect(actionsIn("payroll")).toContain("check.voided");
    expect(actionsIn("people")).not.toContain("payrun.approved");
  });
});

describe("activity sentences", () => {
  it("reads after a name", async () => {
    const { afterName } = await import("@/lib/app/activity");
    expect(afterName("Approved a pay run")).toBe("approved a pay run");
    expect(afterName("OR tax account")).toBe("OR tax account");
    expect(row("team.invited", { email: "hr@x.test", role: "CLIENT_HR" }).text).toBe("Invited hr@x.test as HR");
  });
});
