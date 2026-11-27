import { timingSafeEqual, createHash } from "node:crypto";
import { runDailyAutomation } from "@/lib/app/automation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily automation: draft pay runs and reminder emails. Any scheduler can call it with
 * "Authorization: Bearer <CRON_SECRET>" (Vercel Cron sends that header itself when CRON_SECRET is
 * set; see vercel.json). Without CRON_SECRET the endpoint is off.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const h = (s: string) => createHash("sha256").update(s).digest();
  const got = req.headers.get("authorization") ?? "";
  if (secret.length < 16 || !timingSafeEqual(h(got), h(`Bearer ${secret}`))) return new Response("Not found", { status: 404 });
  return Response.json(await runDailyAutomation());
}
