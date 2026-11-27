import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prettyDate } from "@/components/ui";
import { logout } from "../../auth-actions";

export const metadata = { title: "Staff request · White Oak Payroll" };
export const dynamic = "force-dynamic";

/** Where someone who asked to join as staff waits. Approved staff move straight on. */
export default async function StaffPending() {
  const user = await requireUser();
  if (user.isStaff || user.needsTwoStep) redirect(user.needsTwoStep ? "/account/two-step?required=1" : "/ops");
  if (!user.staffStatus) redirect("/app");
  return (
    <>
      <h1>Payroll staff request</h1>
      {user.staffStatus === "PENDING" && (
        <>
          <p className="notice">Thanks, {user.name.split(" ")[0] || user.name}. Your request is waiting for a White Oak administrator{user.staffRequestedAt ? ` (sent ${prettyDate(user.staffRequestedAt)})` : ""}.</p>
          <p className="muted">We&apos;ll email {user.email} when you&apos;re approved. Then sign in again and you&apos;ll set up two-step sign-in before you start.</p>
        </>
      )}
      {user.staffStatus === "DENIED" && <p className="notice">Your request to join as payroll staff was not approved. If you think that&apos;s a mistake, ask the person at White Oak who invited you.</p>}
      {user.staffStatus === "REMOVED" && <p className="notice">Your payroll staff access was removed by a White Oak administrator.</p>}
      {(user.staffStatus === "DENIED" || user.staffStatus === "REMOVED") && <p className="small"><a href="/staff/join">Ask again</a></p>}
      <form action={logout}><button type="submit" className="secondary">Sign out</button></form>
    </>
  );
}
