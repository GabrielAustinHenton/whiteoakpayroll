import { PDFDocument } from "pdf-lib";
import { db } from "@/lib/db";
import { canUse, currentUser, roleIn } from "@/lib/auth/session";
import { loadPaystub, paystubDoc } from "@/lib/app/paystub";
import { renderFormPdf } from "@/lib/pdf/form-pdf";

/** Every paystub in a paid pay run as one PDF, in name order, for printing and handing out. */
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Sign in first", { status: 401 });
  const { runId } = await params;
  const run = await db.payRun.findUnique({ where: { id: runId }, include: { lines: { where: { grossCents: { gt: 0 } }, include: { employee: true } } } });
  if (!run || run.status !== "PAID" || !canUse(roleIn(user, run.companyId), "reports")) return new Response("Not found", { status: 404 });
  const lines = [...run.lines].sort((a, b) => `${a.employee.lastName} ${a.employee.firstName}`.localeCompare(`${b.employee.lastName} ${b.employee.firstName}`));
  const out = await PDFDocument.create();
  out.setTitle(`Paystubs ${run.payday.toISOString().slice(0, 10)}`);
  for (const l of lines) {
    const p = await loadPaystub(l.id, user);
    if (!p) continue;
    const doc = await PDFDocument.load(await renderFormPdf(paystubDoc(p)));
    for (const page of await out.copyPages(doc, doc.getPageIndices())) out.addPage(page);
  }
  const name = `paystubs-${run.payday.toISOString().slice(0, 10)}.pdf`;
  return new Response(Buffer.from(await out.save()), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store" } });
}
