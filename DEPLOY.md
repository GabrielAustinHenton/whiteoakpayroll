# Deploying whiteoakpayroll.com

The site is a Next.js app and every page is static today, so it needs no database or secrets to deploy.

## Vercel (recommended)

1. Sign in at https://vercel.com with GitHub and choose **Add New → Project**.
2. Import `GabrielAustinHenton/whiteoakpayroll`. Vercel detects Next.js; keep the defaults
   (build `npm run build`, output `.next`). No environment variables are needed yet.
3. Deploy. Every push to `main` redeploys production; every PR gets a preview URL.
4. In the project, open **Settings → Domains** and add `whiteoakpayroll.com` and `www.whiteoakpayroll.com`.
   Vercel shows the DNS records to create. They are normally:

   | Type  | Name | Value                  |
   |-------|------|------------------------|
   | A     | @    | 76.76.21.21            |
   | CNAME | www  | cname.vercel-dns.com   |

   Use whatever values Vercel shows if they differ.
5. Add those records at the domain registrar. Vercel issues the SSL certificate automatically once DNS resolves
   (usually minutes, up to 48 hours).

### If DNS is on Cloudflare

Set both records to **DNS only** (grey cloud). Cloudflare's proxy is not needed for SSL and can break
Vercel's certificate renewal.

## Moving off Vercel later

The app is kept portable so it can move hosts without code changes:

- `next.config.ts` uses `output: "standalone"` and the `Dockerfile` builds a plain Node container
  (`docker build -t whiteoak . && docker run -p 3000:3000 whiteoak`).
- Run that image on AWS (App Runner or ECS Fargate), Fly.io, Render, or Railway.
- Rules that keep this true: use standard Postgres through `DATABASE_URL` (e.g. Neon or AWS RDS), not
  Vercel Postgres/KV/Blob/Edge Config; keep secrets in env vars; no Vercel-only APIs in app code.
- To switch: deploy the container, set the same env vars, then point the DNS records at the new host.

## Before handling real payroll data

This deploy is a public preview. Before any real employee data, see the go-live list in the project thread:
embedded payroll provider (e.g. Check), managed Postgres, auth, security review, and legal review.
