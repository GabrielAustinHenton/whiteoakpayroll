/** Shared "people paid this month" value for the public preview pages. Browser-only; no account or database. */

export const PEOPLE_DEFAULT = 10;
export const PEOPLE_MAX = 10_000;
const KEY = "whiteoak.peoplePaid";
const EVENT = "whiteoak:people";

/** Clean what someone typed: digits only, no leading zeros, empty allowed, capped at PEOPLE_MAX. */
export function cleanPeopleInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (digits === "") return "";
  return String(Math.min(Number(digits), PEOPLE_MAX));
}

/** The number to price and preview with. An empty box counts as 0. */
export function peopleFromInput(text: string): number {
  return text === "" ? 0 : Number(text);
}

export function readPeopleText(): string {
  try {
    const v = window.localStorage.getItem(KEY);
    if (v !== null) return cleanPeopleInput(v);
  } catch {}
  return String(PEOPLE_DEFAULT);
}

export function writePeopleText(text: string): void {
  try {
    window.localStorage.setItem(KEY, text);
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

export function subscribePeople(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => e.key === KEY && onChange();
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
