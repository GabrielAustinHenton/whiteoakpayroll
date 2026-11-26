import { PayRunPreview } from "./pay-run-preview";

export default function PreviewPage() {
  return (
    <>
      <h1>Pay run preview</h1>
      <p className="muted">
        Sample data. This is the screen an employer sees before approving payroll. The number of people matches what you
        entered on the pricing page.
      </p>
      <PayRunPreview />
    </>
  );
}
