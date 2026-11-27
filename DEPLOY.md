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

## Bureaus and payroll staff (for example Jose's bureau and Olga)

A **bureau** is a payroll firm, such as a partner's service bureau, that runs payroll for its own
clients. Staff belong to one bureau and see **only that bureau's companies** on the payroll desk
(`/ops`). Companies with no bureau are White Oak's own: only admins can open them. Staff are not admins.

1. Sign in as an admin, open https://whiteoakpayroll.com/admin, and under **Bureaus** add the bureau.
2. Put each of the bureau's clients in it: click the company on /admin and choose the bureau under
   **Bureau**. Clients that the bureau's staff add from the payroll desk go into their bureau by themselves.
3. Optional: make the bureau's owner (for example Jose). Under **Bureaus → Make someone a bureau owner**,
   enter their login email and choose the bureau. The owner sees only that bureau's companies and
   approves, denies and removes its staff from **Payroll desk → Your staff** (`/ops/team`). They stop
   being a White Oak admin: also take their email out of `ADMIN_EMAILS` in Vercel and redeploy.
4. Add staff, either way:
   - **Ask and approve (recommended):** send them the bureau's join link (shown under Bureaus and on the
     owner's /ops/team page). They create a login and ask to join. Admins and the bureau's owner get an
     email; the owner approves on /ops/team, or an admin on /admin. On /admin under **Payroll staff → Waiting for approval**, choose
     their bureau and click **Approve** (or **Deny**). They get an email and can sign in. Until approved
     they have no access. **Remove access** takes it away again.
   - **STAFF_EMAILS:** add the email in Vercel (comma separated), redeploy, then on /admin send the login
     invite and choose their bureau next to their name. Staff with no bureau see no clients.

## Two-step sign-in (required for admins and staff)

Admins and payroll staff can see every client's Social Security numbers and bank details, so their
logins need a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password,
Authy) as well as the password. The first time they sign in, the app takes them to **Account → Two-step
sign-in**; until they finish, their White Oak access is paused. They get 10 one-time recovery codes
for a lost phone. Client owners, HR and employees can turn it on from **Account** too (optional).

- Lost phone and lost recovery codes: set `TWO_STEP_FOR_STAFF=off` in Vercel and redeploy to get back in,
  then clear their old setup in the database (`totpSecret`, `totpEnabledAt` on the User) and set it up
  again. Remove the variable afterwards.
- Local development without a phone: `TWO_STEP_FOR_STAFF=off`.

## Turning on email (logins, invites and password resets)

Inviting staff or a client's owner emails them a link to choose a password, and "Forgot password?" on the
sign-in page emails a one-time reset link (valid for an hour). Until email is set up, invite links are shown
on screen, but reset links are never shown (that would let anyone reset anyone's password), so resets
only work once Resend is on.
Email goes through [Resend](https://resend.com) (free for 3,000 emails a month). Until it is set up,
the app shows the invite link on screen after you save, so you can send it yourself.

1. Sign up at https://resend.com.
2. Open **Domains → Add Domain**, enter `whiteoakpayroll.com`, and pick the US region.
3. Resend lists a few DNS records (a TXT record for DKIM named like `resend._domainkey`, and an MX and a
   TXT record on the `send` subdomain). In GoDaddy open **My Products → whiteoakpayroll.com → DNS**,
   click **Add New Record** for each one, and copy the type, name and value exactly as Resend shows them.
   Back in Resend click **Verify DNS Records**; it usually turns green within an hour.
4. In Resend open **API Keys → Create API Key**, name it `vercel`, permission **Sending access**, and copy it.
5. In Vercel open **Settings → Environment Variables** and add:

   | Name | Value |
   |------|-------|
   | `RESEND_API_KEY` | the key from step 4 |
   | `EMAIL_FROM` | `White Oak Payroll <hello@whiteoakpayroll.com>` |
   | `APP_URL` | `https://whiteoakpayroll.com` |

6. Redeploy (**Deployments → ⋯ → Redeploy**) so the new variables take effect.

Invite links work once and expire after 14 days. A pending invite can be resent from the employee's page.

## Turning on the daily automation (draft pay runs and reminders)

Once a day the app prepares each self-serve company's next pay run a week before payday and emails
owners when a run needs approval, an I-9 is due, or a quarterly return is coming up. It never approves
or pays anything by itself.

1. In Vercel open **Settings → Environment Variables** and add `CRON_SECRET` with a long random value
   (at least 16 characters; for example run `openssl rand -hex 24`).
2. Redeploy. `vercel.json` already schedules `/api/cron/daily` for 12:00 UTC (7 AM Eastern); Vercel
   sends the secret itself. On another host, call `GET /api/cron/daily` once a day with the header
   `Authorization: Bearer <CRON_SECRET>`.

Reminder emails need email turned on (above). Without `CRON_SECRET` the endpoint is off.

## Self-serve and managed companies

Each company is either **self-serve** (the owner runs payroll; employees use the portal) or **managed**
(White Oak staff run it from the payroll desk). New signups are self-serve; companies staff create from
the payroll desk, and every company that existed before this change, are managed. An admin can switch a
company on its admin page. Per-company feature switches (employee portal, self-onboarding, advances,
automatic draft runs, reminder emails) are in the company's settings.

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
