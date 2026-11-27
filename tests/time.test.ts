import { describe, expect, it } from "vitest";
import { checkPunch, distanceMeters, formatDistance, validFix, type Place } from "@/lib/time/geofence";
import { addDays, localDate, paidMinutes, weekStart, zonedInstant } from "@/lib/time/clock";
import { decodePhoto } from "@/lib/time/service";

// A shop in Hartford, CT, with a 150 m fence.
const shop: Place = { id: "L1", name: "Main shop", latitude: 41.7658, longitude: -72.6734, radiusMeters: 150 };
const now = new Date("2026-11-30T14:00:00Z");
const at = (dLatMeters: number, accuracy = 10, ageMs = 0) => ({
  latitude: shop.latitude + dLatMeters / 111_320,
  longitude: shop.longitude,
  accuracy,
  timestamp: now.getTime() - ageMs,
});
const base = { places: [shop], maxAccuracyMeters: 100, now };

describe("geofence", () => {
  it("measures distance on the earth", () => {
    expect(Math.round(distanceMeters(shop, at(500)))).toBeGreaterThan(495);
    expect(Math.round(distanceMeters(shop, at(500)))).toBeLessThan(505);
  });

  it("lets a punch inside the circle through, with no flags", () => {
    const r = checkPunch({ ...base, fix: at(60), mode: "BLOCK" });
    expect(r.inside).toBe(true);
    expect(r.blocked).toBeNull();
    expect(r.flags).toEqual([]);
    expect(r.locationName).toBe("Main shop");
  });

  it("blocks a punch from home in BLOCK mode and says how far away", () => {
    const r = checkPunch({ ...base, fix: at(3_000), mode: "BLOCK" });
    expect(r.inside).toBe(false);
    expect(r.flags).toContain("OUTSIDE_FENCE");
    expect(r.blocked).toMatch(/1\.9 miles from Main shop/);
  });

  it("allows but flags the same punch in FLAG mode, and ignores it when OFF", () => {
    const flag = checkPunch({ ...base, fix: at(3_000), mode: "FLAG" });
    expect(flag.blocked).toBeNull();
    expect(flag.flags).toContain("OUTSIDE_FENCE");
    const off = checkPunch({ ...base, fix: at(3_000), mode: "OFF" });
    expect(off.blocked).toBeNull();
    expect(off.flags).not.toContain("OUTSIDE_FENCE");
  });

  it("gives a precise fix whose accuracy circle reaches the fence the benefit of the doubt", () => {
    const r = checkPunch({ ...base, fix: at(190, 50), mode: "BLOCK" });
    expect(r.inside).toBe(true);
    expect(r.blocked).toBeNull();
  });

  it("allows a weak fix that could be inside, flagged; blocks a weak fix that can't be", () => {
    const maybe = checkPunch({ ...base, fix: at(300, 400), mode: "BLOCK" });
    expect(maybe.blocked).toBeNull();
    expect(maybe.flags).toContain("LOW_ACCURACY");
    const far = checkPunch({ ...base, fix: at(5_000, 400), mode: "BLOCK" });
    expect(far.blocked).not.toBeNull();
  });

  it("needs a location in BLOCK mode, but not when there are no work locations yet", () => {
    expect(checkPunch({ ...base, fix: null, mode: "BLOCK" }).blocked).toMatch(/location is needed/);
    expect(checkPunch({ ...base, fix: null, mode: "FLAG" }).flags).toEqual(["NO_LOCATION"]);
    const none = checkPunch({ ...base, places: [], fix: at(3_000), mode: "BLOCK" });
    expect(none.blocked).toBeNull();
    expect(none.flags).toContain("NO_WORK_LOCATIONS");
  });

  it("flags signs of a faked location", () => {
    const stale = checkPunch({ ...base, fix: at(10, 10, 10 * 60_000), mode: "BLOCK" });
    expect(stale.flags).toContain("STALE_FIX");
    expect(checkPunch({ ...base, fix: at(10, 0), mode: "BLOCK" }).flags).toContain("SUSPICIOUS_ACCURACY");
    const f = at(20);
    const same = checkPunch({ ...base, fix: f, mode: "BLOCK", previous: { at: new Date(now.getTime() - 8 * 3_600_000), latitude: f.latitude, longitude: f.longitude } });
    expect(same.flags).toContain("REPEATED_FIX");
    // 100 km in 10 minutes.
    const jump = checkPunch({ ...base, fix: at(20), mode: "BLOCK", previous: { at: new Date(now.getTime() - 10 * 60_000), latitude: shop.latitude + 0.9, longitude: shop.longitude } });
    expect(jump.flags).toContain("IMPOSSIBLE_TRAVEL");
  });

  it("picks the location whose fence is nearest", () => {
    const yard: Place = { id: "L2", name: "Yard", latitude: shop.latitude + 0.01, longitude: shop.longitude, radiusMeters: 300 };
    const r = checkPunch({ ...base, places: [shop, yard], fix: at(1_000), mode: "BLOCK" });
    expect(r.locationName).toBe("Yard");
    expect(r.inside).toBe(true);
  });

  it("validates fixes from the browser", () => {
    expect(validFix(at(0))).toBe(true);
    expect(validFix({ latitude: 91, longitude: 0, accuracy: 5, timestamp: 1 })).toBe(false);
    expect(validFix({ latitude: "41", longitude: 0, accuracy: 5, timestamp: 1 })).toBe(false);
    expect(validFix(null)).toBe(false);
  });

  it("formats distances in feet and miles", () => {
    expect(formatDistance(30)).toBe("100 feet");
    expect(formatDistance(4_828)).toBe("3.0 miles");
  });
});

describe("clock math", () => {
  const t = (s: string) => new Date(s);
  it("subtracts unpaid meal breaks but not paid rest breaks", () => {
    const shift = {
      clockInAt: t("2026-11-30T13:00:00Z"),
      clockOutAt: t("2026-11-30T21:30:00Z"),
      breaks: [
        { kind: "MEAL", startAt: t("2026-11-30T17:00:00Z"), endAt: t("2026-11-30T17:30:00Z") },
        { kind: "REST", startAt: t("2026-11-30T19:00:00Z"), endAt: t("2026-11-30T19:10:00Z") },
      ],
    };
    expect(paidMinutes(shift)).toBe(8 * 60);
  });
  it("counts an open shift up to now", () => {
    expect(paidMinutes({ clockInAt: t("2026-11-30T13:00:00Z"), clockOutAt: null, breaks: [] }, t("2026-11-30T15:15:00Z"))).toBe(135);
  });
  it("uses the company time zone for the workday", () => {
    // 11:30 PM in Portland is already the next day in UTC.
    expect(localDate(t("2026-12-01T07:30:00Z"), "America/Los_Angeles")).toBe("2026-11-30");
    expect(zonedInstant("2026-11-30", "09:00", "America/New_York").toISOString()).toBe("2026-11-30T14:00:00.000Z");
    expect(zonedInstant("2026-07-01", "09:00", "America/New_York").toISOString()).toBe("2026-07-01T13:00:00.000Z");
  });
  it("finds the start of the workweek", () => {
    expect(weekStart("2026-12-02", 0)).toBe("2026-11-29"); // Wednesday -> Sunday
    expect(weekStart("2026-12-02", 1)).toBe("2026-11-30"); // -> Monday
    expect(weekStart("2026-11-29", 0)).toBe("2026-11-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("punch photos", () => {
  it("accepts a small JPEG data URL and rejects anything else", () => {
    expect(decodePhoto("data:image/jpeg;base64,/9j/4AAQ")).not.toBeNull();
    expect(decodePhoto("data:text/html;base64,PGI+")).toBeNull();
    expect(decodePhoto(`data:image/jpeg;base64,${"A".repeat(400_000)}`)).toBeNull();
    expect(decodePhoto(null)).toBeNull();
  });
});
