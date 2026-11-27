# Retirement plans and provider connections

Researched 2026-11-27. Code: `src/lib/retirement/` (limits, plans, contributions, providers, files),
`src/lib/app/retirement-service.ts`, page `/app/<companyId>/retirement`.

## What works today, with no partnership

1. The employer (or White Oak staff) picks the provider and plan type on the Retirement page and enters the match.
2. Elections are typed in, or imported from the provider's deferral report (CSV, matched by SSN).
3. Every pay run takes the savings (pre-tax 401(k), Roth 401(k), SIMPLE IRA, or state Roth IRA) within the IRS limits,
   adds the employer match/nonelective, and puts the employer money into the run's cash needed.
4. When the run is paid, White Oak builds the provider file. Someone downloads it, uploads it on the provider's site,
   and clicks "Mark uploaded". The first upload marks the connection as working.
5. W-2: box 12 D (pre-tax), AA (Roth), S (SIMPLE); box 13 checked for 401(k)/SIMPLE participants, not for state IRAs.

## How each provider actually connects payroll companies

| Provider | Today | After a partnership | Source |
|---|---|---|---|
| OregonSaves, MyCTSavings (Vestwell) | File upload in the employer portal (payroll provider added as a "teammate") | Vestwell "360" integration; no charge | oregonsaves.com/employers/payroll-providers; Vestwell 180 Integration PDF |
| New York Secure Choice | File upload (layout assumed to match Vestwell until confirmed) | Ask the program | Venable (Apr 2026), Vestwell blog (Nov 2026) |
| Principal | Sponsor uploads the file | EDI feed for cases with 50+ employees; API "depends on existing integrations or a mutual commitment to build one" | principal.com/data-integration |
| Fidelity, Empower, Ascensus (incl. Vanguard small-business plans), John Hancock | Sponsor uploads the file | Partner file feed / API; requirements not public | — |
| Human Interest | Sponsor uploads the file | Public partner integrations page: most likely first API partner | humaninterest.com/partner-integrations |
| Guideline | Sponsor uploads the file | API; owned by Gusto, so may be hard | — |

## What Gabriel needs to do

1. Email **statepayrollintegrations@vestwell.com**: ask to become an integrated payroll provider for OregonSaves,
   MyCTSavings and NY Secure Choice. Ask them to confirm (a) the 180 file layout is current, (b) whether files need a
   header row, (c) the program code in the file name (we use OR / CT / NY), (d) NY Secure Choice's layout and default rate.
2. Call **Principal** (800-986-3343, or a local sales rep) about an API partnership; ask for their payroll file spec
   for small plans. White Oak is below the 50-employee EDI minimum per case.
3. Apply to **Human Interest**'s partner program (first API candidate).
4. Each client with a 401(k) adds White Oak as a payroll contact/"teammate" on their provider's site so staff can upload.

## Not verified / not built

- State program defaults: OregonSaves 5% (+1%/yr to 10%), MyCTSavings 3%, NY Secure Choice 3%: confirm with each program.
- Match is figured per paycheck; no year-end true-up. 402(g) is per employer (we can't see other jobs).
- Due date shown is 7 business days after payday (DOL small-plan safe harbor, 29 CFR 2510.3-102(a)(2)); federal holidays not skipped.
- Loans (repayments column is always 0), vesting, and HCE testing are not handled.
- EFW2 RO record (W-2 code S for SIMPLE) is still not written; paper/PDF W-2 shows code S.
- Money for the plan still moves outside White Oak (TD Bank not live).
