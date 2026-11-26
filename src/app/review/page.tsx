import { PayRunReview } from "./pay-run-review";

export const metadata = { title: "Review pay run · White Oak Payroll" };

export default function ReviewPage() {
  return (
    <>
      <h1>Review pay run</h1>
      <p className="muted">
        Sample data. Before you approve payroll, White Oak shows every tax and deduction line by line, and exactly how
        much cash this run takes from your account. Nothing is hidden in a single &ldquo;taxes&rdquo; total.
      </p>
      <PayRunReview />
    </>
  );
}
