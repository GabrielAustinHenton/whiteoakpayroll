import { NextResponse } from "next/server";
import { KIOSK_COOKIE, redeemSetupCode } from "@/lib/time/kiosk";

/** Opened once on the tablet: turns this device into the kiosk. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const r = await redeemSetupCode(code);
  const url = new URL("/kiosk", req.url);
  if (!r) {
    url.searchParams.set("error", "That setup link is used up or expired. Ask for a new one under Time Tracking > Kiosks.");
    return NextResponse.redirect(url);
  }
  const res = NextResponse.redirect(url);
  res.cookies.set(KIOSK_COOKIE, r.token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 400 * 86_400 });
  return res;
}
