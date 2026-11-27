import { db } from "@/lib/db";
import { canUse, companyMode, currentUser, roleIn } from "@/lib/auth/session";
import { submissionFiles } from "@/lib/app/retirement-service";

/** Download one provider file for a paid pay run. The files hold SSNs, so only people who manage the plan may download. */
export async function GET(_req: Request, { params }: { params: Promise<{ submissionId: string; file: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Sign in first", { status: 401 });
  const { submissionId, file } = await params;
  const s = await db.retirementSubmission.findUnique({ where: { id: submissionId }, include: { plan: true } });
  if (!s) return new Response("Not found", { status: 404 });
  if (!canUse(roleIn(user, s.plan.companyId), "settings", await companyMode(s.plan.companyId))) return new Response("Not found", { status: 404 });
  const f = submissionFiles(s)[Number(file)];
  if (!f) return new Response("Not found", { status: 404 });
  await db.auditLog.create({ data: { actorId: user.id, companyId: s.plan.companyId, action: "retirement.file_downloaded", detail: { submissionId, fileName: f.fileName } } });
  return new Response(f.content, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${f.fileName.replace(/[^A-Za-z0-9_.-]/g, "_")}"`, "cache-control": "private, no-store" },
  });
}
