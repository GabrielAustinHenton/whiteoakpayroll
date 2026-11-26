# Deploying whiteoakpayroll.com

The site is a Next.js app. Marketing pages work without a database; the app itself needs Postgres (below).

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

## Turning on the app (database and sign-in)

The app (sign up, companies, people, pay runs, paystubs, checks, filings) needs a Postgres database.
Use Neon through Vercel; it is standard Postgres, so it can move later.

1. In Vercel, open the **whiteoakpayroll** project and click the **Storage** tab.
2. Click **Create Database**, choose **Neon** (Serverless Postgres), accept the free plan, pick the region
   closest to you (US East is fine), and click **Create**.
3. When asked which environments to connect, keep **Production**, **Preview** and **Development** checked
   and click **Connect**. This adds `DATABASE_URL` (and `DATABASE_URL_UNPOOLED`) to the project.
4. Open **Settings → Environment Variables** and add:

   | Name | Value |
   |------|-------|
   | `ADMIN_SETUP_TOKEN` | any long random phrase you keep private (12+ characters) |
   | `ADMIN_EMAILS` | the White Oak staff emails allowed to be admins, comma-separated |

   `TEST_IDS_ONLY` is on by default: only test SSNs (000-xx-xxxx) and EINs (00-xxxxxxx) are accepted
   until SSNs are encrypted and the security review is done. Do not set it to `false` before then.
5. Merge the pull request (or, if already merged, open **Deployments**, click **⋯** on the latest one and
   **Redeploy**). The build creates the database tables automatically (`prisma migrate deploy`).
6. Each White Oak admin goes to https://whiteoakpayroll.com/admin/setup and enters their name, email (one on
   `ADMIN_EMAILS`), a password and the setup code (`ADMIN_SETUP_TOKEN`). If that email already has a login,
   they enter its current password and it becomes an admin. Admins land on https://whiteoakpayroll.com/admin.

### The admin portal

- `/admin` lists every client company with its owner, headcount, plan tier, add-ons and monthly price, plus
  totals (monthly run rate, billed this month and last month), a "needs attention" list, filing deadlines
  across clients, billing by month, the admin list and the admin access log.
- Opening a client shows their account **read-only**. To change something for a client, turn on edit mode
  in the admin bar (asks for a reason, lasts one hour). Every view and edit-mode start is logged.
- To remove an admin, delete their email from `ADMIN_EMAILS` and redeploy.

## Moving off Vercel later

The app is kept portable so it can move hosts without code changes:

- `next.config.ts` uses `output: "standalone"` and the `Dockerfile` builds a plain Node container
  (`docker build -t whiteoak . && docker run -p 3000:3000 whiteoak`).
- Run that image on AWS (App Runner or ECS Fargate), Fly.io, Render, or Railway.
- Rules that keep this true: use standard Postgres through `DATABASE_URL` (e.g. Neon or AWS RDS), not
  Vercel Postgres/KV/Blob/Edge Config; keep secrets in env vars; no Vercel-only APIs in app code.
- To switch: deploy the container, set the same env vars, then point the DNS records at the new host.

## Before handling real payroll data

This deploy is a public preview. Before any real employee data: encrypt SSNs and bank numbers at rest,
add two-factor sign-in, connect TD Bank for money movement, finish IRS/state registrations
(docs/registrations.md), and complete a security and legal review.
