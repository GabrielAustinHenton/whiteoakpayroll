import { canUse, currentUser, roleIn } from "@/lib/auth/session";
import { REPORTS, parseRange, reportCsv, toCsv, type ReportKind } from "@/lib/reports";
import { loadReportData } from "@/lib/reports/load";
import { audit } from "@/lib/app/payroll-service";

/** CSV download of one payroll report, e.g. /api/companies/<id>/reports/register?period=2026-Q3 */
export async function GET(req: Request, { params }: { params: Promise<{ companyId: string; kind: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Sign in first", { status: 401 });
  const { companyId, kind } = await params;
  if (!(kind in REPORTS) || !canUse(roleIn(user, companyId), "reports")) return new Response("Not found", { status: 404 });
  const range = parseRange(new URL(req.url).searchParams.get("period") ?? undefined);
  const { lines, contractors } = await loadReportData(companyId, range);
  const { header, rows } = reportCsv(kind as ReportKind, lines, contractors);
  await audit(user.id, companyId, "report.downloaded", { kind, period: range.label });
  return new Response(toCsv(header, rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${kind}-${range.label}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
