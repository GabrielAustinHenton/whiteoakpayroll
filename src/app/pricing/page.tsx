import { PricingCalculator } from "./pricing-calculator";

export default function PricingPage() {
  return (
    <>
      <h1>Pricing</h1>
      <p className="muted">
        Your price is set by the number of people on your payroll each month (employees, plus contractors in months you pay them), in steps of 5: 1 to 5 people is $30 a month, and each further 5 people adds $20 (6 to 10 is $50, 11 to 15 is $70). No base fee, no per-employee fee, unlimited pay runs. Taxes and wages pass through at cost and
        are never marked up.
      </p>
      <PricingCalculator />
    </>
  );
}
