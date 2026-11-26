"use client";

import { monthlyBill } from "@/lib/pricing";
import { formatUSD } from "@/lib/money";
import { usePeopleCount } from "@/lib/preview/use-people-count";
import { PeopleInput } from "../people-input";

export function PricingCalculator() {
  const { people } = usePeopleCount();
  const bill = monthlyBill(people);

  return (
    <section>
      <PeopleInput />
      <p className="big">{formatUSD(bill.total)} / month</p>
      <p className="muted">
        {bill.tierRange ? `Tier ${bill.tier}: ${bill.tierRange.from} to ${bill.tierRange.to} people.` : "No one paid, no charge."}
      </p>
      <p>
        <a href="/preview">See a sample pay run for {people} {people === 1 ? "person" : "people"}</a>
      </p>
    </section>
  );
}
