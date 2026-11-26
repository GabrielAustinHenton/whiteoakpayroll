"use server";

import { redirect } from "next/navigation";
import { requireAdmin, sameCompanyReferer, setAdminEditing } from "@/lib/auth/session";
import { audit } from "@/lib/app/payroll-service";
import { db } from "@/lib/db";
import { str } from "@/components/ui";

/** Unlock changes to one client company for an hour. Logged in the company's audit trail. */
export async function startAdminEdit(form: FormData) {
  const user = await requireAdmin();
  const companyId = str(form.get("companyId"));
  const reason = str(form.get("reason"));
  if (!(await db.company.findUnique({ where: { id: companyId } }))) redirect("/admin");
  const back = await sameCompanyReferer(companyId);
  if (!reason) redirect(`${back}?error=${encodeURIComponent("Say why you are making changes (for the audit log).")}`);
  await setAdminEditing(companyId);
  await audit(user.id, companyId, "admin.edit_started", { reason, by: user.email });
  redirect(`${back}?ok=${encodeURIComponent("Edit mode is on for one hour. Every change is logged.")}`);
}

export async function stopAdminEdit(form: FormData) {
  const user = await requireAdmin();
  const companyId = str(form.get("companyId"));
  await setAdminEditing(null);
  await audit(user.id, companyId || null, "admin.edit_stopped", { by: user.email });
  redirect(companyId ? await sameCompanyReferer(companyId) : "/admin");
}
