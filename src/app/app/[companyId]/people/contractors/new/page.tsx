import { requireArea } from "@/lib/auth/session";
import { Field, Notice, StateSelect, messages } from "@/components/ui";
import { createContractor } from "../../../actions";

export default async function NewContractor({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { companyId } = await params;
  await requireArea(companyId, "people");
  const { error } = await messages(searchParams);
  return (
    <>
      <h1>Add a contractor</h1>
      <p className="muted">From their Form W-9. You pay contractors on a pay run; no taxes are withheld and they get a 1099-NEC at year end.</p>
      <Notice error={error} />
      <form action={createContractor} className="form">
        <input type="hidden" name="companyId" value={companyId} />
        <div className="row">
          <Field label="Legal name (W-9 line 1)"><input name="legalName" required /></Field>
          <Field label="Business name (line 2, optional)"><input name="businessName" /></Field>
          <Field label="Email"><input name="email" type="email" required /></Field>
        </div>
        <div className="row">
          <Field label="TIN type">
            <select name="tinType" defaultValue="ssn"><option value="ssn">SSN</option><option value="ein">EIN</option></select>
          </Field>
          <Field label="TIN" hint="Test numbers only: SSN 000-xx-xxxx or EIN 00-xxxxxxx"><input name="tin" required /></Field>
        </div>
        <Field label="Street address"><input name="addressLine1" required /></Field>
        <div className="row">
          <Field label="City"><input name="city" required /></Field>
          <Field label="State (where they work)"><StateSelect name="state" /></Field>
          <Field label="ZIP"><input name="zip" required /></Field>
        </div>
        <div className="row">
          <Field label="Pay by">
            <select name="paymentMethod" defaultValue="DIRECT_DEPOSIT">
              <option value="DIRECT_DEPOSIT">Direct deposit</option>
              <option value="CHECK">Paper check</option>
            </select>
          </Field>
          <Field label="Deposit account number" hint="Last 4 kept; deposits simulated"><input name="bankAccount" inputMode="numeric" /></Field>
        </div>
        <label className="check"><input type="checkbox" name="w9" defaultChecked /> Signed W-9 received</label>
        <button type="submit">Add contractor</button>
      </form>
    </>
  );
}
