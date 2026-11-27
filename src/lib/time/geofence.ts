/**
 * Geofence check for a punch. Pure: no database, so it is unit tested.
 *
 * Location comes from the browser's Geolocation API at the moment of the punch only; nothing is
 * tracked between punches. A browser can't prove a location is real, so besides the fence itself
 * we flag signals that often mean a faked or borrowed location (see FLAG_LABEL in flags.ts).
 */

export type GeofenceMode = "BLOCK" | "FLAG" | "OFF";

export interface Fix {
  latitude: number;
  longitude: number;
  /** Radius of the 68% confidence circle, meters, as the browser reports it. */
  accuracy: number;
  /** When the device took the fix (ms since epoch). */
  timestamp: number;
}

export interface Place {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export interface PreviousPunch {
  at: Date;
  latitude: number;
  longitude: number;
}

export interface PunchCheck {
  /** Nearest work location, and the distance to its center in meters. */
  locationId: string | null;
  locationName: string | null;
  distanceMeters: number | null;
  inside: boolean;
  flags: string[];
  /** Set when the punch must be refused, with the message to show the employee. */
  blocked: string | null;
}

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in meters. */
export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function validFix(f: unknown): f is Fix {
  if (!f || typeof f !== "object") return false;
  const x = f as Record<string, unknown>;
  const n = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  return n(x.latitude) && n(x.longitude) && n(x.accuracy) && n(x.timestamp)
    && Math.abs(x.latitude as number) <= 90 && Math.abs(x.longitude as number) <= 180 && (x.accuracy as number) >= 0;
}

/** A fix taken more than this long before the server received it is flagged. */
export const STALE_MS = 2 * 60_000;
/** Faster than this (m/s, about 300 km/h) between two punches is not travel by car. */
export const MAX_SPEED = 85;

export function checkPunch(input: {
  fix: Fix | null;
  places: Place[];
  mode: GeofenceMode;
  maxAccuracyMeters: number;
  now: Date;
  previous?: PreviousPunch | null;
}): PunchCheck {
  const { fix, places, mode, maxAccuracyMeters, now, previous } = input;
  const flags: string[] = [];
  const out: PunchCheck = { locationId: null, locationName: null, distanceMeters: null, inside: false, flags, blocked: null };

  if (!fix) {
    if (mode === "OFF") return out;
    flags.push("NO_LOCATION");
    if (mode === "BLOCK" && places.length > 0)
      out.blocked = "Your location is needed to punch. Allow location for this site in your browser settings, then try again.";
    return out;
  }

  // Signals of a faked or replayed location.
  if (Math.abs(now.getTime() - fix.timestamp) > STALE_MS) flags.push("STALE_FIX");
  if (fix.accuracy < 1) flags.push("SUSPICIOUS_ACCURACY");
  if (fix.accuracy > maxAccuracyMeters) flags.push("LOW_ACCURACY");
  if (previous) {
    if (previous.latitude === fix.latitude && previous.longitude === fix.longitude) flags.push("REPEATED_FIX");
    const secs = Math.max(1, (now.getTime() - previous.at.getTime()) / 1000);
    const moved = distanceMeters(previous, fix);
    if (moved > 2_000 && moved / secs > MAX_SPEED) flags.push("IMPOSSIBLE_TRAVEL");
  }

  if (places.length === 0) {
    if (mode !== "OFF") flags.push("NO_WORK_LOCATIONS");
    return out;
  }

  let best: { p: Place; d: number } | null = null;
  for (const p of places) {
    const d = distanceMeters(p, fix);
    if (!best || d - p.radiusMeters < best.d - best.p.radiusMeters) best = { p, d };
  }
  const { p, d } = best!;
  out.locationId = p.id;
  out.locationName = p.name;
  out.distanceMeters = Math.round(d);
  // Inside when the reported point is inside, or the accuracy circle reaches the fence and the fix
  // is precise enough to trust. A weak fix that could be inside is allowed but flagged LOW_ACCURACY.
  const reaches = d - fix.accuracy <= p.radiusMeters;
  out.inside = d <= p.radiusMeters || (reaches && fix.accuracy <= maxAccuracyMeters);
  const maybe = !out.inside && reaches; // weak fix, could be inside
  if (mode === "OFF") return out;
  if (!out.inside && !maybe) {
    flags.push("OUTSIDE_FENCE");
    if (mode === "BLOCK") {
      out.blocked = `You're about ${formatDistance(d)} from ${p.name}. Punch in when you get to work.`;
    }
  }
  return out;
}

export function formatDistance(m: number): string {
  const feet = m * 3.28084;
  if (feet < 1000) return `${Math.max(10, Math.round(feet / 10) * 10)} feet`;
  const miles = m / 1609.344;
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} miles`;
}
