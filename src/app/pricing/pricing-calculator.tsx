"use client";

import { useState } from "react";
import { monthlyBill } from "@/lib/pricing";
import { formatUSD } from "@/lib/money";

export function PricingCalculator() {
  const [people, setPeople] = useState(72);
  const safe = Number.isInteger(people) && people >= 0 ? people : 0;
  const bill = monthlyBill(safe);

  return (
    <section>
      <label>
        People paid this month{" "}
        <input type="number" min={0} step={1} value={people} onChange={(e) => setPeople(Number(e.target.value))} />
      </label>
      <p className="big">{formatUSD(bill.total)} / month</p>
      <p className="muted">
        {bill.tierRange ? `Tier ${bill.tier}: ${bill.tierRange.from} to ${bill.tierRange.to} people.` : "No one paid, no charge."}
      </p>
    </section>
  );
}
