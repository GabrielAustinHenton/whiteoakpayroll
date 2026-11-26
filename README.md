# White Oak Payroll

Payroll for small businesses with one flat monthly price that steps up per 5 people paid, and every employer tax (Social Security, Medicare, FUTA, SUTA) shown before a pay run is approved.

Launch states: Connecticut, Massachusetts, Oregon, New York.

## Stack

Next.js (App Router, TypeScript), PostgreSQL with Prisma, Vitest. Tax calculation and filings are built in-house (`src/lib/tax-engine/`). Money movement (ACH direct deposit and tax payments) will go through TD Bank and is not integrated yet.

## Layout

| Path | What it holds |
| --- | --- |
| `src/lib/pricing.ts` | Tier pricing (placeholder $25 per 5 people) and add-on modules (Time Tracking, PTO) |
| `src/lib/tax-engine/` | In-house tax engine: versioned tax tables with sources (`tables/<year>/`), federal withholding (Pub. 15-T), FICA, FUTA, deduction taxability, paycheck calculator |
| `src/lib/taxes/` | Employer tax cost preview and state paid leave contributions |
| `src/lib/filings/` | Forms 941, 940, W-2/W-3 and SSA EFW2 file, 1099-NEC and 1096, CT-941, CT-W3, M-941, Oregon OQ, NYS-45, and deposit due dates |
| `src/lib/money-movement/` | Interface for TD Bank money movement, plus a NACHA file writer placeholder |
| `docs/tax-engine.md` | How the engine works and what still needs verifying |
| `docs/registrations.md` | IRS, SSA and state registrations needed before filing for clients |
| `src/lib/payroll/schedules.ts` | Pay frequency rules for CT, MA, OR, NY |
| `src/lib/payroll/advances.ts` | Zero-interest payday advances repaid by payroll deduction (CT only for now) |
| `prisma/schema.prisma` | Data model: companies, roles, employees, contractors, pay runs, advances, retirement, sick leave, filings |
| `src/app/` | Marketing pages, pricing calculator, sample pay run cost preview |
| `src/app/signup`, `login`, `app/[companyId]/…` | The payroll app: self-serve signup, company settings, people (employees, contractors, W-4 and state forms, I-9, offboarding), pay runs (review, approve, paystubs, paper checks), tax filings archive, advances, team access, billing |
| `src/app/me`, `src/app/admin` | Employee portal (paystubs, W-2s, advances) and White Oak admin |
| `src/lib/app/` | App services: engine adapter (`engine.ts`), pay periods, pay runs and checks (`payroll-service.ts`), completed forms (`filing-docs.ts`), paystubs |
| `src/lib/pdf/` | PDF rendering for completed forms, paystubs and voucher checks |
| `src/lib/auth/` | Password hashing and database sessions; roles: White Oak admin, client owner, client HR (onboard/offboard only), employee |

## Develop

```bash
npm install
cp .env.example .env   # point DATABASE_URL at a local Postgres
npx prisma migrate dev # create the tables
npm run dev            # http://localhost:3000, then /signup
npm test
npm run typecheck
```

Every tax figure in `src/lib/tax-engine/tables/` carries its official source and a `verified` flag. Figures with `verified: false` must be checked against the cited source before live payroll.
