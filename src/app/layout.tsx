import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { currentUser } from "@/lib/auth/session";
import { databaseUrl } from "@/lib/db-url";
import { logout } from "./auth-actions";
import { NavLinks } from "@/components/nav-links";

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
        <a href="#main" className="skip-link">Skip to main content</a>
        <div className="preview-banner" role="note">
          Preview: no money moves and only test data is accepted. Bank transfers to TD Bank are simulated.
        </div>
        <header className="site-header">
          <a href="/" className="brand">White Oak Payroll</a>
          <nav aria-label="Main">
            <NavLinks
              links={[
                { href: "/pricing", label: "Pricing" },
                ...(user
                  ? [
                      ...(user.isStaff ? [{ href: "/ops", label: "Payroll desk" }] : []),
                      ...(user.isPlatformAdmin ? [{ href: "/admin", label: "Admin" }] : []),
                      ...(user.memberships.length > 0 ? [{ href: "/app", label: "My company" }] : []),
                      { href: "/me", label: "My pay" },
                      { href: "/account", label: "Account" },
                    ]
                  : []),
              ]}
            />
            {user ? (
              <>
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
        {user?.needsTwoStep && (
          <div className="two-step-banner" role="alert">
            Your White Oak admin or staff access is paused until you <a href="/account/two-step?required=1">turn on two-step sign-in</a>.
          </div>
        )}
        <main id="main" tabIndex={-1}>{children}</main>
      </body>
    </html>
  );
}
