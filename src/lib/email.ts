/**
 * Outgoing email through Resend (https://resend.com), with plain fetch so there is no SDK to keep
 * up to date. Configure with:
 *   RESEND_API_KEY  the API key from Resend
 *   EMAIL_FROM      a sender on a domain verified in Resend, e.g. "White Oak Payroll <hello@whiteoakpayroll.com>"
 *   APP_URL         the site address used in links (default https://whiteoakpayroll.com)
 * Without RESEND_API_KEY nothing is sent and callers fall back to showing the link on screen.
 */

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type SendResult = { sent: true; id?: string } | { sent: false; reason: string };

export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY);

export function appUrl(): string {
  return (process.env.APP_URL || "https://whiteoakpayroll.com").replace(/\/+$/, "");
}

export async function sendEmail(msg: Email): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: "Email is not set up yet (RESEND_API_KEY)." };
  const from = process.env.EMAIL_FROM || "White Oak Payroll <hello@whiteoakpayroll.com>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { sent: false, reason: `Email failed: ${body.message ?? res.status}` };
    return { sent: true, id: body.id };
  } catch (e) {
    return { sent: false, reason: `Email failed: ${(e as Error).message}` };
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A short email with one button. */
export function buttonEmail(o: { to: string; subject: string; lines: string[]; button: string; url: string; after?: string[] }): Email {
  const text = [...o.lines, "", `${o.button}: ${o.url}`, "", ...(o.after ?? [])].join("\n").trim();
  const p = (l: string) => `<p style="margin:0 0 14px">${esc(l)}</p>`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#1f2a24;max-width:520px">
<p style="margin:0 0 18px;font-weight:700;color:#2f5d3a">White Oak Payroll</p>
${o.lines.map(p).join("\n")}
<p style="margin:22px 0"><a href="${esc(o.url)}" style="background:#2f5d3a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">${esc(o.button)}</a></p>
${(o.after ?? []).map(p).join("\n")}
<p style="margin:18px 0 0;font-size:12px;color:#6b756f">If the button does not work, paste this into your browser: ${esc(o.url)}</p>
</div>`;
  return { to: o.to, subject: o.subject, text, html };
}
