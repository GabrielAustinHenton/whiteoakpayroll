import { dollars, type Cents } from "./money";

/**
 * White Oak pricing: one flat monthly price that steps up for every 5 employees paid.
 * No base fee, no per-employee fee. Add-on modules are flat monthly prices on the same bill.
 *
 * PLACEHOLDERS: tier and add-on prices are not final (see the product spec's open questions).
 */
export const PRICING = {
  employeesPerTier: 5,
  pricePerTier: dollars(25),
  addOns: {
    time_tracking: { name: "Time Tracking", monthlyPrice: dollars(0) /* TBD */ },
    pto: { name: "PTO", monthlyPrice: dollars(0) /* TBD */ },
  },
} as const;

export type AddOnKey = keyof typeof PRICING.addOns;

/** Tier number for a month, from the highest number of people paid that month. 0 people = tier 0. */
export function tierFor(peoplePaid: number): number {
  if (!Number.isInteger(peoplePaid) || peoplePaid < 0) throw new Error("peoplePaid must be a non-negative integer");
  return Math.ceil(peoplePaid / PRICING.employeesPerTier);
}

export interface MonthlyBill {
  tier: number;
  tierRange: { from: number; to: number } | null;
  basePrice: Cents;
  addOns: { key: AddOnKey; name: string; price: Cents }[];
  total: Cents;
}

export function monthlyBill(peoplePaid: number, enabledAddOns: AddOnKey[] = []): MonthlyBill {
  const tier = tierFor(peoplePaid);
  const per = PRICING.employeesPerTier;
  const basePrice = tier * PRICING.pricePerTier;
  const addOns = [...new Set(enabledAddOns)].map((key) => ({
    key,
    name: PRICING.addOns[key].name,
    price: PRICING.addOns[key].monthlyPrice,
  }));
  return {
    tier,
    tierRange: tier === 0 ? null : { from: (tier - 1) * per + 1, to: tier * per },
    basePrice,
    addOns,
    total: basePrice + addOns.reduce((s, a) => s + a.price, 0),
  };
}
