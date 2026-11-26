import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { currentUser } from "@/lib/auth/session";
import { databaseUrl } from "@/lib/db-url";
import { logout } from "./auth-actions";

export const metadata: Metadata = {
  title: "White Oak Payroll",
  description: "Flat-priced payroll for small businesses, with every employer tax shown up front.",
};

async function safeUser() {
  // The marketing pages still render when no database is configured.
  if (!databaseUrl()) return null;
  try {
    return await currentUser();
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await safeUser();
  return (
    <html lang="en">
      <body>
        <div className="preview-banner" role="note">
          Preview: no money moves and only test data is accepted. Bank transfers to TD Bank are simulated.
        </div>
        <header className="site-header">
          <a href="/" className="brand">White Oak Payroll</a>
          <nav>
            <a href="/pricing">Pricing</a>
            {user ? (
              <>
                {user.isPlatformAdmin && <a href="/admin">Admin</a>}
                {user.memberships.length > 0 && <a href="/app">My company</a>}
                <a href="/me">My pay</a>
                <a href="/account">Account</a>
                <form action={logout} className="inline">
                  <button type="submit" className="link">Sign out</button>
                </form>
              </>
            ) : (
              <>
                <a href="/login">Sign in</a>
                <a href="/signup">Sign up</a>
              </>
            )}
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
