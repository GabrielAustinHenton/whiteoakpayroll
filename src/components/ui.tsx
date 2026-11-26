import type { ReactNode } from "react";
import { formatUSD } from "@/lib/money";

export const usd = formatUSD;
export const dateStr = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
export const prettyDate = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "";

export function Notice({ error, ok }: { error?: string; ok?: string }) {
  if (error) return <p className="notice error" role="alert">{error}</p>;
  if (ok) return <p className="notice ok" role="status">{ok}</p>;
  return null;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

export function StateSelect({ name, defaultValue, required = true }: { name: string; defaultValue?: string; required?: boolean }) {
  return (
    <select name={name} defaultValue={defaultValue ?? ""} required={required}>
      <option value="" disabled>Choose</option>
      <option value="CT">Connecticut</option>
      <option value="MA">Massachusetts</option>
      <option value="OR">Oregon</option>
      <option value="NY">New York</option>
    </select>
  );
}

type SP = Promise<Record<string, string | string[] | undefined>>;
export async function messages(searchParams: SP) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  return { error: one("error"), ok: one("ok"), sp };
}

/** Money input in dollars ("1,234.50") to cents. */
export function cents(v: FormDataEntryValue | null): number {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export const str = (v: FormDataEntryValue | null) => String(v ?? "").trim();
