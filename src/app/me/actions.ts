"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { canOfferAdvance } from "@/lib/payroll/advances";
import type { LaunchState } from "@/lib/payroll/schedules";
import { audit } from "@/lib/app/payroll-service";
import type { Prisma } from "@prisma/client";
import { cents, str } from "@/components/ui";
import { featuresFor } from "@/lib/app/features";
import { normalizeSsn } from "@/lib/app/ids";
import { stateW4From, w4From } from "@/lib/app/employee-input";
import { validateSection1, type I9Attestation, type I9Section1 } from "@/lib/onboarding/i9";
import { appUrl, buttonEmail, sendEmail } from "@/lib/email";

export async function requestAdvance(form: FormData) {
  const user = await requireUser();
  const e = await db.employee.findUnique({ where: { userId: user.id }, include: { company: true } });
  const back = (error: string) => redirect(`/me?error=${encodeURIComponent(error)}`);
  if (!e || e.status !== "ACTIVE") return back("Only active employees can request an advance.");
  if (!featuresFor(e.company).advances) return back("Your employer doesn't offer payday advances.");
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

const I9_LABEL: Record<string, string> = {
  us_citizen: "U.S. citizen",
  noncitizen_national: "noncitizen national",
  lawful_permanent_resident: "lawful permanent resident",
  alien_authorized: "alien authorized to work",
};

/** Employee self-service: first-time onboarding, then address, withholding and bank changes. */
export async function saveMyDetails(form: FormData) {
  const user = await requireUser();
  const back = (error: string): never => redirect(`/me/details?error=${encodeURIComponent(error)}`);
  const e = await db.employee.findUnique({ where: { userId: user.id }, include: { company: true } });
  if (!e) return back("Your login is not linked to an employee record.");
  if (!featuresFor(e.company).employeePortal) return back("Your employer manages your details directly.");
  if (e.status === "TERMINATED") return back("You no longer work here; ask your former employer to update your details.");
  const onboarding = !e.ssn;

  const address = { addressLine1: str(form.get("addressLine1")), city: str(form.get("city")), state: str(form.get("homeState")).toUpperCase(), zip: str(form.get("zip")) };
  if (!address.addressLine1 || !address.city || !/^[A-Z]{2}$/.test(address.state) || !/^\d{5}$/.test(address.zip)) return back("Enter your full home address (2-letter state, 5-digit ZIP).");

  const paymentMethod = str(form.get("paymentMethod")) === "CHECK" ? "CHECK" : "DIRECT_DEPOSIT";
  const routing = str(form.get("routing")).replace(/\D/g, "");
  const account = str(form.get("account")).replace(/\D/g, "");
  if (account && (routing.length !== 9 || account.length < 4)) return back("The routing number is 9 digits and the account number at least 4.");
  if (paymentMethod === "DIRECT_DEPOSIT" && !account && !e.bankLast4) return back("Enter your bank account for direct deposit, or choose a paper check.");

  const data: Prisma.EmployeeUpdateInput = {
    ...address,
    ...w4From(form),
    stateW4: stateW4From(form, e.workState),
    paymentMethod,
    ...(account ? { bankLast4: account.slice(-4) } : {}),
    electronicW2Consent: form.get("electronicW2") === "on",
  };

  if (onboarding) {
    const ssn = normalizeSsn(str(form.get("ssn")));
    if (ssn.error) return back(ssn.error);
    const dob = str(form.get("birthDate"));
    const status = str(form.get("i9Status"));
    const num = str(form.get("i9Number"));
    const attestation: I9Attestation =
      status === "lawful_permanent_resident" ? { status, aNumber: num }
      : status === "alien_authorized" ? { status, expires: str(form.get("i9Expires")) || "N/A", id: { kind: "a_number", value: num } }
      : status === "noncitizen_national" ? { status } : { status: "us_citizen" };
    const signed = str(form.get("signature"));
    const section1: I9Section1 = {
      lastName: e.lastName,
      firstName: e.firstName,
      address: { street: address.addressLine1, city: address.city, state: address.state, zip: address.zip },
      dateOfBirth: dob,
      ssnProvided: true,
      email: e.email,
      attestation,
      signature: { name: signed, signedAt: new Date().toISOString() },
    };
    const issues = validateSection1(section1, { eVerify: false });
    if (issues.length) return back(issues[0].message);
    if (signed.toLowerCase().replace(/\s+/g, " ") !== `${e.firstName} ${e.lastName}`.toLowerCase()) return back(`Sign by typing your name exactly as ${e.firstName} ${e.lastName}.`);
    Object.assign(data, {
      ssn: ssn.value!,
      birthDate: new Date(`${dob}T00:00:00Z`),
      selfOnboardingDoneAt: new Date(),
      i9Section1: { ...section1, statusLabel: I9_LABEL[attestation.status], signature: signed, signedAt: section1.signature.signedAt } as unknown as Prisma.InputJsonValue,
    });
  }

  await db.employee.update({ where: { id: e.id }, data });
  await audit(user.id, e.companyId, onboarding ? "employee.self_onboarded" : "employee.self_updated", { employeeId: e.id, bankChanged: !!account });
  if (onboarding) await tellOwners(e.companyId, e.company.tradeName || e.company.legalName, `${e.firstName} ${e.lastName}`, e.id);
  redirect(`/me?ok=${encodeURIComponent(onboarding ? `Thanks, you're all set. Bring your I-9 documents on your first day so ${e.company.tradeName || e.company.legalName} can finish.` : "Saved. Changes apply from your next paycheck.")}`);
}

/** Let the owners know a new hire finished their part (and that I-9 Section 2 is theirs now). */
async function tellOwners(companyId: string, companyName: string, who: string, employeeId: string) {
  const owners = await db.membership.findMany({ where: { companyId, role: { in: ["CLIENT_OWNER", "CLIENT_HR"] } }, include: { user: true } });
  for (const m of owners) {
    await sendEmail(
      buttonEmail({
        to: m.user.email,
        subject: `${who} finished their onboarding`,
        lines: [`${who} entered their details, W-4, state form, bank account and I-9 Section 1 for ${companyName}.`, "Your part: look at their original I-9 documents in person and complete Section 2 within 3 business days of their first day."],
        button: "Complete Section 2",
        url: `${appUrl()}/app/${companyId}/people/${employeeId}`,
      }),
    );
  }
}
