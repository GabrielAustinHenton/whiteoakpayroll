import { requireUser } from "@/lib/auth/session";
import { Field, Notice, messages } from "@/components/ui";
import { claimAdmin } from "../../auth-actions";

export default async function Claim({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireUser();
  const { error } = await messages(searchParams);
  return (
    <>
      <h1>Become a White Oak admin</h1>
      <p className="muted">Enter the setup code (ADMIN_SETUP_TOKEN in the server settings). Your email must be on the admin list (ADMIN_EMAILS) when one is set. Admins can open every client company.</p>
      <Notice error={error} />
      <form action={claimAdmin} className="form narrow">
        <Field label="Setup code"><input name="token" type="password" required /></Field>
        <button type="submit">Make me an admin</button>
      </form>
    </>
  );
}
