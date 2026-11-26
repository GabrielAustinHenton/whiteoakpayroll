/** All money is stored and computed as integer cents to avoid floating point drift. */
export type Cents = number;

export function dollars(amount: number): Cents {
  return Math.round(amount * 100);
}

/** Apply a percentage rate (e.g. 0.062) to cents, rounding half up to the nearest cent. */
export function applyRate(base: Cents, rate: number): Cents {
  return Math.round(base * rate);
}

export function formatUSD(cents: Cents): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
