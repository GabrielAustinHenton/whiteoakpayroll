/**
 * Taxpayer ID handling. Until the security review is done and SSNs are encrypted at rest, the app
 * runs with TEST_IDS_ONLY on (the default) and accepts only numbers that can never belong to a real
 * person or business: SSNs starting 000 (never issued by SSA) and EINs starting 00 (never assigned).
 */
export function testIdsOnly(): boolean {
  return process.env.TEST_IDS_ONLY !== "false";
}

export function normalizeSsn(raw: string): { value?: string; error?: string } {
  const d = raw.replace(/\D/g, "");
  if (d.length !== 9) return { error: "SSN must be 9 digits." };
  if (testIdsOnly() && !d.startsWith("000")) return { error: "Preview mode: use a test SSN that starts with 000 (for example 000-12-3456). Real SSNs are not accepted yet." };
  return { value: `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` };
}

export function normalizeEin(raw: string): { value?: string; error?: string } {
  const d = raw.replace(/\D/g, "");
  if (d.length !== 9) return { error: "EIN must be 9 digits." };
  if (testIdsOnly() && !d.startsWith("00")) return { error: "Preview mode: use a test EIN that starts with 00 (for example 00-1234567). Real EINs are not accepted yet." };
  return { value: `${d.slice(0, 2)}-${d.slice(2)}` };
}

export function maskTin(t: string): string {
  return `***-**-${t.replace(/\D/g, "").slice(-4)}`;
}
