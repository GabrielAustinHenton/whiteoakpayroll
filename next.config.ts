import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

/**
 * Browser security headers for every page. Payroll pages show SSNs, bank and pay data, so:
 * no framing (clickjacking), no MIME sniffing, HTTPS only, scripts only from this site, and
 * the browser features we do not use switched off. Geolocation stays allowed for this site
 * so a time clock can check where an employee punches in.
 */
const csp = [
  "default-src 'self'",
  // Next.js inlines its bootstrap script; dev mode also needs eval for fast refresh.
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${dev ? " ws:" : ""}`,
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), payment=(), usb=(), geolocation=(self)" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // Standalone output lets the same app run in a plain Docker container
  // (AWS, Fly, Render, etc.), so we are not tied to any one host.
  output: "standalone",
  poweredByHeader: false,
  // Time clock exports are uploaded through a server action.
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
