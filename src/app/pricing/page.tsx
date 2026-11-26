import { PricingCalculator } from "./pricing-calculator";

export default function PricingPage() {
  return (
    <>
      <h1>Pricing</h1>
      <p className="muted">
        Your price is set by the number of people on your payroll each month (employees and contractors), in steps of 5: 1 to 5 people is $25 a month, 6 to 10 is $50, and so on. Taxes and wages pass through at cost and
        are never marked up.
      </p>
      <PricingCalculator />
    </>
  );
}
