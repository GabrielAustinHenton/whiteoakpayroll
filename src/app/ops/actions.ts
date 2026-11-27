"use server";

import { redirect } from "next/navigation";
import { requireAdmin, requireStaff } from "@/lib/auth/session";
import { staffEmails } from "@/lib/auth/admins";
import { normalizeEin } from "@/lib/app/ids";
import { inviteStaffLogin } from "@/lib/app/invites";
import { audit } from "@/lib/app/payroll-service";
import { db } from "@/lib/db";
import { str } from "@/components/ui";

const back = (path: string, msg: { error?: string; ok?: string }): never =>
  redirect(`${path}?${msg.error ? `error=${encodeURIComponent(msg.error)}` : `ok=${encodeURIComponent(msg.ok ?? "")}`}`);

/** White Oak staff set up a client company themselves; the client never needs to log in. */
export async function addClientCompany(form: FormData) {
  const user = await requireStaff();
  const legalName = str(form.get("legalName"));
  const ein = normalizeEin(str(form.get("ein")));
  const state = str(form.get("state"));
  if (!legalName) back("/ops", { error: "Enter the company's legal name." });
  if (ein.error) back("/ops", { error: ein.error });
  if (!["CT", "MA", "OR", "NY"].includes(state)) back("/ops", { error: "Choose the company's state." });
  const c = await db.company.create({
    data: {
      legalName,
      tradeName: str(form.get("tradeName")) || null,
      ein: ein.value!,
      addressLine1: str(form.get("addressLine1")),
      city: str(form.get("city")),
      state,
      zip: str(form.get("zip")),
      serviceMode: "MANAGED",
    },
  });
  await audit(user.id, c.id, "company.created_by_staff", { legalName, by: user.email });
  redirect(`/app/${c.id}/settings?ok=${encodeURIComponent(`${legalName} created. Next: bank account, state tax accounts and a pay schedule, then add the employees.`)}`);
}

/** Admins send a White Oak staff member (listed in STAFF_EMAILS) their login invite. */
export async function sendStaffInvite(form: FormData) {
  const admin = await requireAdmin();
  const email = str(form.get("email")).toLowerCase();
  if (!staffEmails().includes(email)) back("/admin", { error: "That email is not in STAFF_EMAILS." });
  const r = await inviteStaffLogin(email, str(form.get("name")) || email);
  await audit(admin.id, null, "staff.invited", { email });
  back("/admin", { ok: r.message });
}
