import { db } from "@/lib/db";
import { canUse, currentUser, roleIn } from "@/lib/auth/session";
import { loadPaystub } from "@/lib/app/paystub";
import { renderChecksPdf, type CheckPrint } from "@/lib/pdf/check-pdf";
import { usd } from "@/lib/pdf/form-pdf";

/** Printable checks for a pay run (all issued checks, or one with ?check=<id>). */
export async function GET(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Sign in first", { status: 401 });
  const { runId } = await params;
  const run = await db.payRun.findUnique({ where: { id: runId }, include: { company: true } });
  if (!run || !canUse(roleIn(user, run.companyId), "reports")) return new Response("Not found", { status: 404 });
  const only = new URL(req.url).searchParams.get("check");
  const checks = await db.check.findMany({
    where: { companyId: run.companyId, status: "ISSUED", ...(only ? { id: only } : {}), OR: [{ payRunLine: { payRunId: runId } }, { contractorPayment: { payRunId: runId } }] },
    include: { payRunLine: { include: { employee: true } }, contractorPayment: { include: { contractor: true } } },
    orderBy: { number: "asc" },
  });
  if (!checks.length) return new Response("No checks to print", { status: 404 });
  const c = run.company;
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const prints: CheckPrint[] = [];
  for (const k of checks) {
    const payer = { name: c.legalName, address: [c.addressLine1, `${c.city}, ${c.state} ${c.zip}`], bankName: c.bankName };
    if (k.payRunLine) {
      const p = await loadPaystub(k.payRunLine.id, user);
      const e = k.payRunLine.employee;
      prints.push({
        number: k.number,
        date: iso(k.checkDate),
        payee: k.payee,
        payeeAddress: [e.addressLine1, `${e.city}, ${e.state} ${e.zip}`],
        amountCents: k.amountCents,
        memo: `Pay period ${iso(run.periodStart)} to ${iso(run.periodEnd)}`,
        payer,
        stub: {
          title: "Earnings statement",
          rows: p
            ? [
                { label: "Gross pay", current: usd(p.gross.current), ytd: usd(p.gross.ytd) },
                ...p.taxes.filter((t) => t.current || t.ytd).map((t) => ({ label: t.label, current: usd(t.current), ytd: usd(t.ytd) })),
                ...p.deductions.map((t) => ({ label: t.label, current: usd(t.current), ytd: usd(t.ytd) })),
                { label: "Net pay", current: usd(p.net.current), ytd: usd(p.net.ytd) },
              ]
            : [],
          footer: [`Payday ${iso(run.payday)}`],
        },
      });
    } else if (k.contractorPayment) {
      const x = k.contractorPayment.contractor;
      prints.push({
        number: k.number,
        date: iso(k.checkDate),
        payee: k.payee,
        payeeAddress: [x.addressLine1, `${x.city}, ${x.state} ${x.zip}`],
        amountCents: k.amountCents,
        memo: k.contractorPayment.memo ?? "Contractor payment",
        payer,
        stub: { title: "Contractor payment", rows: [{ label: k.contractorPayment.memo ?? "Services", current: usd(k.amountCents) }], footer: ["No taxes withheld. Reported on Form 1099-NEC."] },
      });
    }
  }
  const pdf = await renderChecksPdf(prints);
  return new Response(Buffer.from(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="checks-${iso(run.payday)}.pdf"`, "cache-control": "private, no-store" },
  });
}
