import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ROLE_LABEL, adminEditingCompany, canUse, requireUser, roleIn, type Area } from "@/lib/auth/session";
import { logAdminView } from "@/lib/app/admin-view";
import { startAdminEdit, stopAdminEdit } from "../../admin/actions";

const NAV: { area: Area; href: string; label: string }[] = [
  { area: "dashboard", href: "", label: "Overview" },
  { area: "add_people", href: "/people", label: "People" },
  { area: "reports", href: "/payroll", label: "Pay runs" },
  { area: "reports", href: "/filings", label: "Tax filings" },
  { area: "advances", href: "/advances", label: "Advances" },
  { area: "settings", href: "/settings", label: "Company settings" },
  { area: "team", href: "/team", label: "Team access" },
  { area: "reports", href: "/billing", label: "Plan and billing" },
];


export default async function CompanyLayout({ children, params }: { children: ReactNode; params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const user = await requireUser();
  const role = roleIn(user, companyId);
  if (!role) redirect("/app");
  if (role === "EMPLOYEE") redirect("/me");
  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company) notFound();
  const isAdmin = role === "PLATFORM_ADMIN";
  const editing = isAdmin && (await adminEditingCompany()) === companyId;
  if (isAdmin) await logAdminView(user.id, companyId);
  return (
    <>
    {isAdmin && (
      <div className={`admin-bar ${editing ? "editing" : ""}`} role="note">
        <span>
          <b>White Oak admin view</b> · {editing ? "Edit mode is on: your changes are saved to this client's account and logged." : "Read-only. Visits are logged."}{" "}
          <a href={`/admin/companies/${companyId}`}>Admin summary</a> · <a href="/admin">All companies</a>
        </span>
        {editing ? (
          <form action={stopAdminEdit} className="inline">
            <input type="hidden" name="companyId" value={companyId} />
            <button type="submit" className="secondary">Turn off edit mode</button>
          </form>
        ) : (
          <details>
            <summary>Turn on edit mode</summary>
            <form action={startAdminEdit} className="actions">
              <input type="hidden" name="companyId" value={companyId} />
              <input name="reason" required placeholder="Why (e.g. client asked by phone)" aria-label="Reason for edit mode" style={{ width: "16rem" }} />
              <button type="submit">Turn on for 1 hour</button>
            </form>
          </details>
        )}
      </div>
    )}
    <div className="app-shell">
      <nav className="app-nav" aria-label="Company">
        <span className="company">{company.tradeName ?? company.legalName}</span>
        <span className="small muted">{ROLE_LABEL[role]}</span>
        {role === "PAYROLL_OPERATOR" && <a href="/ops" className="small">← Payroll desk (all clients)</a>}
        {NAV.filter((n) => canUse(role, n.area)).map((n) => (
          <a key={n.href} href={`/app/${companyId}${n.href}`}>{n.label}</a>
        ))}
      </nav>
      <section>{children}</section>
    </div>
    </>
  );
}
