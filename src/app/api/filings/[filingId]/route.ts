import { db } from "@/lib/db";
import { canUse, currentUser, roleIn } from "@/lib/auth/session";

/** Download a completed form from the archive. Owners/admins see every form; employees and contractors only their own W-2. */
export async function GET(_req: Request, { params }: { params: Promise<{ filingId: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Sign in first", { status: 401 });
  const { filingId } = await params;
  const f = await db.filing.findUnique({ where: { id: filingId } });
  if (!f) return new Response("Not found", { status: 404 });
  const ok = canUse(roleIn(user, f.companyId), "filings") || (await ownW2(user.id, f));
  if (!ok) return new Response("Not found", { status: 404 });
  const name = `${f.form}-${f.period}${f.recipient ? `-${f.recipient.replace(/[^A-Za-z0-9]+/g, "_")}` : ""}.pdf`;
  return new Response(Buffer.from(f.pdf), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store" } });
}

async function ownW2(userId: string, f: { form: string; companyId: string; data: unknown }) {
  if (f.form !== "W-2") return false;
  const e = await db.employee.findFirst({ where: { userId, companyId: f.companyId } });
  return !!e && (f.data as { employeeId?: string }).employeeId === e.id;
}
