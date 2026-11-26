import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { canUse, requireUser, roleIn, type Area } from "@/lib/auth/session";

const NAV: { area: Area; href: string; label: string }[] = [
  { area: "dashboard", href: "", label: "Overview" },
  { area: "people", href: "/people", label: "People" },
  { area: "payroll", href: "/payroll", label: "Pay runs" },
  { area: "filings", href: "/filings", label: "Tax filings" },
  { area: "advances", href: "/advances", label: "Advances" },
  { area: "settings", href: "/settings", label: "Company settings" },
  { area: "team", href: "/team", label: "Team access" },
  { area: "billing", href: "/billing", label: "Plan and billing" },
];

const ROLE_LABEL = { PLATFORM_ADMIN: "White Oak admin", CLIENT_OWNER: "Owner", CLIENT_HR: "HR (onboarding only)", EMPLOYEE: "Employee" } as const;

export default async function CompanyLayout({ children, params }: { children: ReactNode; params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const user = await requireUser();
  const role = roleIn(user, companyId);
  if (!role) redirect("/app");
  if (role === "EMPLOYEE") redirect("/me");
  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company) notFound();
  return (
    <div className="app-shell">
      <nav className="app-nav" aria-label="Company">
        <span className="company">{company.tradeName ?? company.legalName}</span>
        <span className="small muted">{ROLE_LABEL[role]}</span>
        {NAV.filter((n) => canUse(role, n.area)).map((n) => (
          <a key={n.area} href={`/app/${companyId}${n.href}`}>{n.label}</a>
        ))}
      </nav>
      <section>{children}</section>
    </div>
  );
}
