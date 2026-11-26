# Tax engine: what's built and what still needs verifying

All money is in integer cents. Tax figures live only in `src/lib/tax-engine/tables/<year>/`, and every block carries a `Source` with `verified: true | false`. Adding a tax year means adding a table directory and tests. The calculation code doesn't change.

## Flow
`calculatePaycheck` → `taxableWages` (deduction taxability) → federal income tax (Pub. 15-T Worksheet 1A) → FICA and FUTA → state lines (`state/index.ts`) → one list of `TaxLine`s. Filings (`src/lib/filings/`) read only stored `PaycheckRecord`s, so returns always tie to paychecks.

## Checked against official worked examples or tables
- Federal 2026 percentage tables (all six), Worksheet 1A, NRA add-ons.
- NYS Method II: four publication examples, derived per-period tables, Yonkers resident example.
- Oregon 2026 formula: Example 1 annual and per-period results.
- CT TPG-211 Tables A to E (no official example exists; hand-computed tests).

## Must verify before live payroll (`verified: false`)
| Item | File | Why |
| --- | --- | --- |
| SSA 2026 wage base $184,500 | `tables/2026/federal.ts` | Also printed in the EFW2 2026 spec; re-read SSA's page |
| Supplemental 22%/37% | `tables/2026/federal.ts` | Confirm in the 2026 Pub. 15 text |
| FUTA credit-reduction states for 2026 | `tables/2026/federal.ts` | DOL announces in November |
| MA Circular M percentage method | `tables/2026/ma.ts` | Steps came from a summary of pp. 12-13, not verbatim text |
| MA EMAC 0.36% | `tables/2026/ma.ts` | From memory |
| NY married schedule and Method III | `tables/2026/ny.ts` | From the USDA NFC bulletin; NYS p. 19 and p. 22 didn't extract |
| NYC schedule | `tables/2026/ny.ts` | From a 2018 NFC bulletin; 83 cents high at $2,910 biweekly against the 2026 wage-bracket table |
| Yonkers nonresident exclusions | `tables/2026/ny.ts` | Flat 0.5% used; exclusions not applied |
| NY RSF 0.075%, DBL, MCTMT rates | `tables/2026/ny.ts` | From memory |
| OR transit 0.1%, TriMet, LTD rates | `tables/2026/or.ts` | TriMet and LTD are estimates |
| State SUI wage bases (MA, NY, OR) | tables | From EY's 2026 table, not the agencies |
| State deposit thresholds (CT, MA, NY) | `filings/deposits.ts` | Due-date rules partly from memory |
| EFW2 RT/RF/RS positions; RO/RU not written | `filings/efw2.ts` | Run AccuWage on every file |
| 1099-NEC $2,000 threshold | `filings/form1099nec.ts` | OBBBA change; confirm in 2026 instructions |

## Not built yet
- Oregon Workers' Benefit Fund (needs hours worked); Portland Metro SHS and Multnomah PFA local withholding.
- Multi-state workers (resident and work state differ), reciprocity, and NY convenience-of-employer rules.
- MA supplemental-wage method, CT and NY supplemental elections (flat rates are in the tables).
- State W-2 transmittals (CT-W3, MA, OR WR), CT and MA UI wage reports, PDF rendering, MeF 94x XML.
- EFTPS and state payment files; TD Bank integration.
