import { afterEach, describe, expect, it, vi } from "vitest";
import { appUrl, buttonEmail, sendEmail } from "@/lib/email";
import { loginStatus } from "@/lib/app/invites";
import { monthlyBill } from "@/lib/pricing";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("email", () => {
  const msg = buttonEmail({ to: "a@example.com", subject: "Hi", lines: ["Hello <b>you</b>"], button: "Set up my login", url: "https://x.test/invite/abc" });

  it("builds text and escaped html with the link", () => {
    expect(msg.text).toContain("Set up my login: https://x.test/invite/abc");
    expect(msg.html).toContain("Hello &lt;b&gt;you&lt;/b&gt;");
    expect(msg.html).toContain('href="https://x.test/invite/abc"');
  });

  it("does not send without RESEND_API_KEY", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await sendEmail(msg)).toEqual({ sent: false, reason: expect.stringContaining("not set up") });
    expect(f).not.toHaveBeenCalled();
  });

  it("posts to Resend with the key", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "WO <hello@whiteoakpayroll.com>");
    const f = vi.fn(async () => new Response(JSON.stringify({ id: "em_1" }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    expect(await sendEmail(msg)).toEqual({ sent: true, id: "em_1" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    expect(JSON.parse(init.body as string)).toMatchObject({ from: "WO <hello@whiteoakpayroll.com>", to: ["a@example.com"], subject: "Hi" });
  });

  it("reports a Resend error", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "domain not verified" }), { status: 403 })));
    expect(await sendEmail(msg)).toEqual({ sent: false, reason: "Email failed: domain not verified" });
  });

  it("uses APP_URL without a trailing slash", () => {
    vi.stubEnv("APP_URL", "https://preview.test/");
    expect(appUrl()).toBe("https://preview.test");
  });
});

describe("login status", () => {
  it("describes pending, expired and set-up logins", () => {
    expect(loginStatus(null).label).toBe("No login");
    expect(loginStatus({ passwordHash: "s:h", invitedAt: null, inviteExpiresAt: null })).toEqual({ label: "Login set up", pending: false });
    const sent = loginStatus({ passwordHash: "", invitedAt: new Date("2026-11-26T12:00:00Z"), inviteExpiresAt: new Date(Date.now() + 86_400_000) });
    expect(sent).toEqual({ label: "Invite sent Nov 26", pending: true });
    expect(loginStatus({ passwordHash: "", invitedAt: null, inviteExpiresAt: new Date("2020-01-02T00:00:00Z") }).label).toBe("Invite expired Jan 2");
  });
});

describe("headcount pricing", () => {
  it("5 people is $25 a month and the 6th person makes it $50", () => {
    expect(monthlyBill(5).total).toBe(2500);
    expect(monthlyBill(6).total).toBe(5000);
  });
});
