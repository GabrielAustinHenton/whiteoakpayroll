# White Oak Payroll

Payroll for small businesses with one flat monthly price that steps up per 5 people paid, and every employer tax (Social Security, Medicare, FUTA, SUTA) shown before a pay run is approved.

Launch states: Connecticut, Massachusetts, Oregon, New York.

## Stack

Next.js (App Router, TypeScript), PostgreSQL with Prisma, Vitest. Tax calculation, filings, and ACH money movement are planned to come from an embedded payroll provider behind `src/lib/providers/payroll-provider.ts`.

## Layout

| Path | What it holds |
| --- | --- |
| `src/lib/pricing.ts` | Tier pricing (placeholder $25 per 5 people) and add-on modules (Time Tracking, PTO) |
| `src/lib/taxes/` | 2026 federal rates and the employer tax cost calculator |
| `src/lib/payroll/schedules.ts` | Pay frequency rules for CT, MA, OR, NY |
| `src/lib/payroll/advances.ts` | Zero-interest payday advances repaid by payroll deduction (CT only for now) |
| `prisma/schema.prisma` | Data model: companies, roles, employees, contractors, pay runs, advances, retirement, sick leave, filings |
| `src/app/` | Marketing pages, pricing calculator, sample pay run cost preview |

## Develop

```bash
npm install
cp .env.example .env   # point DATABASE_URL at a local Postgres
npm run dev            # http://localhost:3000
npm test
npm run typecheck
```

Tax rates in `src/lib/taxes/rates-2026.ts` are marked for verification against IRS and SSA sources before launch.
