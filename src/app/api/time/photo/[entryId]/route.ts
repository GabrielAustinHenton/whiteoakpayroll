import { db } from "@/lib/db";
import { canUse, requireUser, roleIn } from "@/lib/auth/session";

/** A punch photo, for people who can see the company's reports. */
export async function GET(req: Request, { params }: { params: Promise<{ entryId: string }> }) {
  const { entryId } = await params;
  const user = await requireUser();
  const e = await db.timeEntry.findUnique({ where: { id: entryId }, select: { companyId: true, inPhoto: true, outPhoto: true } });
  if (!e || !canUse(roleIn(user, e.companyId), "reports")) return new Response("Not found", { status: 404 });
  const photo = new URL(req.url).searchParams.get("side") === "out" ? e.outPhoto : e.inPhoto;
  if (!photo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(photo), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" } });
}
