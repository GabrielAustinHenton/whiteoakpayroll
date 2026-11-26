import { PricingCalculator } from "./pricing-calculator";

export default function PricingPage() {
  return (
    <>
      <h1>Pricing</h1>
      <p className="muted">
        Your price is set by the most people you pay in a month, in steps of 5. Taxes and wages pass through at cost and
        are never marked up.
      </p>
      <PricingCalculator />
    </>
  );
}
