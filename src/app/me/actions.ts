"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { canOfferAdvance } from "@/lib/payroll/advances";
import type { LaunchState } from "@/lib/payroll/schedules";
import { audit } from "@/lib/app/payroll-service";
import { cents, str } from "@/components/ui";

export async function requestAdvance(form: FormData) {
  const user = await requireUser();
  const e = await db.employee.findUnique({ where: { userId: user.id } });
  const back = (error: string) => redirect(`/me?error=${encodeURIComponent(error)}`);
  if (!e || e.status !== "ACTIVE") return back("Only active employees can request an advance.");
  if (!canOfferAdvance(e.workState as LaunchState)) return back(`Advances are not available in ${e.workState} yet.`);
  const amount = cents(form.get("amount"));
  const installment = cents(form.get("installment"));
  const signed = str(form.get("signature"));
  if (amount <= 0 || amount > 100_000) return back("Request between $1 and $1,000.");
  if (installment <= 0 || installment > amount) return back("Choose a repayment per pay run no larger than the advance.");
  if (signed.toLowerCase() !== `${e.firstName} ${e.lastName}`.toLowerCase()) return back("Type your full name exactly to sign the repayment authorization.");
  const open = await db.advance.count({ where: { employeeId: e.id, status: { in: ["REQUESTED", "ACTIVE"] } } });
  if (open) return back("You already have an advance open.");
  await db.advance.create({ data: { employeeId: e.id, principalCents: amount, installmentCents: installment, authorizationSignedName: signed, authorizationSignedAt: new Date() } });
  await audit(user.id, e.companyId, "advance.requested", { amount });
  redirect("/me?ok=Requested.+Your+employer+will+approve+or+decline+it.");
}
