import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/session";
import { CATEGORY_LABEL, actionsIn, afterName, describeActivity, isCategory } from "@/lib/app/activity";

const PAGE = 50;

/** Who did what in this company account, newest first. Owners and White Oak can see it. */
export default async function Activity({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { companyId } = await params;
  const { role } = await requireArea(companyId, "reports");
  if (role === "CLIENT_HR") redirect(`/app/${companyId}`);
  const sp = await searchParams;
  const category = isCategory(sp.show) ? sp.show : undefined;
  const before = sp.before ? new Date(sp.before) : undefined;

  const entries = await db.auditLog.findMany({
    where: {
      companyId,
      ...(category ? { action: { in: actionsIn(category) } } : {}),
      ...(before && !Number.isNaN(before.getTime()) ? { createdAt: { lt: before } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: PAGE + 1,
  });
  const more = entries.length > PAGE;
  const shown = entries.slice(0, PAGE);
  const ids = (k: string) => [...new Set(shown.map((e) => (e.detail as Record<string, unknown> | null)?.[k]).filter((v): v is string => typeof v === "string"))];
  const [actors, employees, contractors] = await Promise.all([
    db.user.findMany({ where: { id: { in: [...new Set(shown.map((e) => e.actorId).filter((v): v is string => !!v))] } }, select: { id: true, name: true } }),
    db.employee.findMany({ where: { companyId, id: { in: ids("employeeId") } }, select: { id: true, firstName: true, lastName: true } }),
    db.contractor.findMany({ where: { companyId, id: { in: ids("contractorId") } }, select: { id: true, legalName: true, businessName: true } }),
  ]);
  const rows = shown.map((e) =>
    describeActivity(e, new Map(actors.map((a) => [a.id, a.name])), {
      employees: new Map(employees.map((x) => [x.id, `${x.firstName} ${x.lastName}`])),
      contractors: new Map(contractors.map((x) => [x.id, x.businessName ?? x.legalName])),
    }),
  );
  const base = `/app/${companyId}/activity`;
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { state: true } });
  const timeZone = company.state === "OR" ? "America/Los_Angeles" : "America/New_York";
  const when = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone, timeZoneName: "short" });

  return (
    <>
      <h1>Activity</h1>
      <p className="muted">Every change to this account, who made it and when. White Oak admin visits are listed too.</p>
      <nav className="chips" aria-label="Filter activity">
        <a href={base} aria-current={!category ? "page" : undefined}>Everything</a>
        {Object.entries(CATEGORY_LABEL).map(([k, label]) => (
          <a key={k} href={`${base}?show=${k}`} aria-current={category === k ? "page" : undefined}>{label}</a>
        ))}
      </nav>
      {rows.length === 0 ? (
        <div className="empty"><p className="muted">Nothing here yet.</p></div>
      ) : (
        <ol className="activity">
          {rows.map((r) => (
            <li key={r.id}>
              <time dateTime={r.createdAt.toISOString()} className="small muted">{when(r.createdAt)}</time>
              <span><b>{r.actorName}</b> {afterName(r.text)}</span>
              <span className="badge">{CATEGORY_LABEL[r.category]}</span>
            </li>
          ))}
        </ol>
      )}
      {more && (
        <p><a className="button secondary" href={`${base}?${new URLSearchParams({ ...(category ? { show: category } : {}), before: shown[shown.length - 1].createdAt.toISOString() })}`}>Show older</a></p>
      )}
    </>
  );
}
