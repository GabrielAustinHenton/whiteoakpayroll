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

/** Switch a company between self-serve and managed by White Oak staff. Logged. */
export async function setServiceMode(form: FormData) {
  const user = await requireAdmin();
  const companyId = str(form.get("companyId"));
  const mode = str(form.get("serviceMode")) === "MANAGED" ? "MANAGED" : "SELF_SERVE";
  const c = await db.company.findUnique({ where: { id: companyId } });
  if (!c) redirect("/admin");
  // Feature overrides were relative to the old mode's defaults, so they are reset.
  await db.company.update({ where: { id: companyId }, data: { serviceMode: mode, features: {} } });
  await audit(user.id, companyId, "admin.service_mode", { from: c!.serviceMode, to: mode, by: user.email });
  redirect(`/admin/companies/${companyId}?ok=${encodeURIComponent(mode === "MANAGED" ? "Now managed by the payroll desk." : "Now self-serve: the owner runs payroll.")}`);
}

/** Create a payroll bureau (a partner's firm). Its staff will see only its companies. */
export async function createBureau(form: FormData) {
  const user = await requireAdmin();
  const name = str(form.get("name")).slice(0, 120);
  if (!name) redirect(`/admin?error=${encodeURIComponent("Enter the bureau's name.")}#bureaus`);
  if (await db.bureau.findUnique({ where: { name } })) redirect(`/admin?error=${encodeURIComponent(`${name} already exists.`)}#bureaus`);
  await db.bureau.create({ data: { name } });
  await audit(user.id, null, "admin.bureau_created", { name, by: user.email });
  redirect(`/admin?ok=${encodeURIComponent(`${name} created. Next: put its client companies in it, then its staff.`)}#bureaus`);
}

/** Choose which bureau runs a company (or none: White Oak's own, admins only). Logged. */
export async function setCompanyBureau(form: FormData) {
  const user = await requireAdmin();
  const companyId = str(form.get("companyId"));
  const bureauId = str(form.get("bureauId")) || null;
  const c = await db.company.findUnique({ where: { id: companyId } });
  if (!c) redirect("/admin");
  const b = bureauId ? await db.bureau.findUnique({ where: { id: bureauId } }) : null;
  if (bureauId && !b) redirect(`/admin/companies/${companyId}?error=${encodeURIComponent("That bureau no longer exists.")}`);
  await db.company.update({ where: { id: companyId }, data: { bureauId } });
  await audit(user.id, companyId, "admin.company_bureau", { from: c!.bureauId, to: bureauId, by: user.email });
  redirect(`/admin/companies/${companyId}?ok=${encodeURIComponent(b ? `${b.name} staff now run this company.` : "No bureau: only White Oak admins can open this company.")}`);
}

/** Move a staff member to a bureau (or none, which hides every client from them). Logged. */
export async function setStaffBureau(form: FormData) {
  const user = await requireAdmin();
  const userId = str(form.get("userId"));
  const bureauId = str(form.get("bureauId")) || null;
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) redirect("/admin#staff-requests");
  if (bureauId && !(await db.bureau.findUnique({ where: { id: bureauId } }))) redirect(`/admin?error=${encodeURIComponent("That bureau no longer exists.")}#staff-requests`);
  await db.user.update({ where: { id: userId }, data: { bureauId } });
  await audit(user.id, null, "admin.staff_bureau", { email: u!.email, from: u!.bureauId, to: bureauId, by: user.email });
  redirect(`/admin?ok=${encodeURIComponent(`Updated ${u!.name}'s bureau.`)}#staff-requests`);
}
