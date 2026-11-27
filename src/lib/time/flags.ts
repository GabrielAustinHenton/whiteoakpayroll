/** Review flags on a time entry. A flag never changes hours by itself; it asks a manager to look. */
export const FLAG_LABEL: Record<string, string> = {
  OUTSIDE_FENCE: "Punched away from work",
  NO_LOCATION: "No location shared",
  LOW_ACCURACY: "Weak GPS signal",
  STALE_FIX: "Old or mismatched location time",
  REPEATED_FIX: "Exact same spot as last punch",
  IMPOSSIBLE_TRAVEL: "Moved impossibly fast between punches",
  SUSPICIOUS_ACCURACY: "Unrealistically precise location",
  NO_WORK_LOCATIONS: "No work locations set up",
  LONG_SHIFT: "Shift over 16 hours (missed punch out?)",
  EDITED: "Changed by a manager",
};

/** Flags that most likely mean someone punched from the wrong place or faked their location. */
export const SERIOUS_FLAGS = new Set(["OUTSIDE_FENCE", "REPEATED_FIX", "IMPOSSIBLE_TRAVEL", "SUSPICIOUS_ACCURACY"]);

export const flagLabel = (f: string) => FLAG_LABEL[f] ?? f;
