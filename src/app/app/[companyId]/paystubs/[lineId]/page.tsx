import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { loadPaystub } from "@/lib/app/paystub";
import { PaystubView } from "@/components/paystub-view";

export default async function PaystubPage({ params }: { params: Promise<{ lineId: string }> }) {
  const { lineId } = await params;
  const p = await loadPaystub(lineId, await requireUser());
  if (!p) notFound();
  return <PaystubView p={p} />;
}
