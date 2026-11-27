"use client";

import { usePathname } from "next/navigation";

/**
 * Links that mark the page you're on (aria-current, styled as selected). `exact` links only
 * match their own path, so "Overview" isn't selected on every page under it.
 */
export function NavLinks({ links, className }: { links: { href: string; label: string; exact?: boolean }[]; className?: string }) {
  const path = usePathname() ?? "";
  const current = (l: { href: string; exact?: boolean }) => path === l.href || (!l.exact && path.startsWith(`${l.href}/`));
  return (
    <>
      {links.map((l) => (
        <a key={l.href} href={l.href} className={className} aria-current={current(l) ? "page" : undefined}>
          {l.label}
        </a>
      ))}
    </>
  );
}
