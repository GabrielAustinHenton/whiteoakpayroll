import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "White Oak Payroll",
  description: "Flat-priced payroll for small businesses, with every employer tax shown up front.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <a href="/" className="brand">White Oak Payroll</a>
          <nav>
            <a href="/pricing">Pricing</a>
            <a href="/preview">Pay run preview</a>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
