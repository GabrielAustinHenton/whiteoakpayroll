import { currentUser } from "@/lib/auth/session";
import { loadPaystub, paystubDoc } from "@/lib/app/paystub";
import { renderFormPdf } from "@/lib/pdf/form-pdf";

export async function GET(_req: Request, { params }: { params: Promise<{ lineId: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Sign in first", { status: 401 });
  const { lineId } = await params;
  const p = await loadPaystub(lineId, user);
  if (!p) return new Response("Not found", { status: 404 });
  const pdf = await renderFormPdf(paystubDoc(p));
  const name = `paystub-${p.employee.lastName}-${p.line.payRun.payday.toISOString().slice(0, 10)}.pdf`;
  return new Response(Buffer.from(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store" } });
}
