import { dollars, type Cents } from "./money";

/**
 * White Oak pricing: one flat monthly price that steps up for every 5 people on payroll that month
 * (employees on payroll, and contractors in months they are paid).
 * No base fee, no per-employee fee. Add-on modules are flat monthly prices on the same bill.
 * The first 5 people can be priced differently from each further 5 (firstTierPrice vs
 * pricePerTier) so small companies cover their support cost without big ones overpaying.
 *
 * PLACEHOLDERS: tier and add-on prices are not final (see the self-serve plan's unit economics).
 */
export const PRICING = {
  employeesPerTier: 5,
  /** Price for 1 to 5 people. */
  firstTierPrice: dollars(25),
  /** Price for each further 5 people. */
  pricePerTier: dollars(25),
  addOns: {
    time_tracking: { name: "Time Tracking", monthlyPrice: dollars(0) /* TBD */ },
    pto: { name: "PTO", monthlyPrice: dollars(0) /* TBD */ },
  },
} as const;

export type AddOnKey = keyof typeof PRICING.addOns;

/** Tier number for a month, from the number of people on payroll that month. 0 people = tier 0. */
export function tierFor(peoplePaid: number): number {
  if (!Number.isInteger(peoplePaid) || peoplePaid < 0) throw new Error("peoplePaid must be a non-negative integer");
  return Math.ceil(peoplePaid / PRICING.employeesPerTier);
}

/** Base price for a tier (0 for nobody). */
export function tierPrice(tier: number): Cents {
  return tier === 0 ? 0 : PRICING.firstTierPrice + (tier - 1) * PRICING.pricePerTier;
}

/** The price rule in words, e.g. "$25 per 5 people" or "$35 for the first 5 people, then $20 per 5". */
export function priceLabel(): string {
  const f = (c: Cents) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
  return PRICING.firstTierPrice === PRICING.pricePerTier
    ? `${f(PRICING.pricePerTier)} per ${PRICING.employeesPerTier} people`
    : `${f(PRICING.firstTierPrice)} for the first ${PRICING.employeesPerTier} people, then ${f(PRICING.pricePerTier)} per ${PRICING.employeesPerTier}`;
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
  const basePrice = tierPrice(tier);
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
