# Registrations Gabriel must complete

White Oak Payroll calculates, files and pays taxes for client employers. The software can produce every return and file, but agencies only accept them from a registered filer, and some steps need a signed authorization from each client. These steps have to be done by a person, under White Oak Payroll's own EIN. Form numbers marked **(verify)** should be confirmed on the agency's site before applying.

Allow 4 to 8 weeks for the federal items. IRS e-file approval and communications testing take the longest, so start them first.

## Once, for White Oak Payroll

### Federal
1. **EIN for White Oak Payroll** (if the operating company doesn't have one yet). Needed for every application below. https://www.irs.gov/ein
2. **IRS e-Services account** for the responsible official, then an **IRS e-file application** naming White Oak Payroll as **Reporting Agent, Transmitter and Software Developer** for Forms 94x (941, 940, Schedule B). The IRS issues an EFIN and ETIN. Next comes Modernized e-File (MeF) Assurance Testing (ATS) of our 94x XML. Guidance: IRS Publication 3112 (e-file application) and Publication 4163 (MeF for business returns).
3. **Reporting Agent authorization list.** Each client signs **Form 8655** (Reporting Agent Authorization). We submit Reporting Agent Lists to the IRS per Publication 1474. This lets us sign and file 941/940 for clients, make deposits, and receive copies of their notices.
4. **EFTPS Batch Provider enrollment**, to make federal tax deposits for many clients. Each client is then enrolled under our batch filer ID. The alternative is ACH credit through TD Bank with TXP addenda; clients still enroll in EFTPS for that. https://www.eftps.gov
5. **IRIS Transmitter Control Code (TCC)** for 1099-NEC. FIRE is being retired and IRIS replaces it. A2A (software) filing needs the IRIS A2A TCC and communications testing. The IRIS Taxpayer Portal works for low volume in the meantime.
6. **SSA Business Services Online (BSO)** account for the person who uploads W-2s (EFW2). SSA now offers an optional Employer Signature PIN (new for TY2026). Test files with SSA AccuWage Online. https://www.ssa.gov/bso

### Connecticut
7. **DRS myconneCT**: register as a third-party bulk filer (payroll service) for CT-WH payments, CT-941 and CT-W3. Each client signs **Form LGL-001** (Power of Attorney) **(verify)**.
8. **DRS ACH credit registration** with the Electronic Commerce Unit, if we pay by ACH credit from TD instead of ACH debit.
9. **CT DOL ReEmployCT**: Third Party Administrator (TPA) registration, to file the quarterly UI wage report and pay UI for clients.
10. **CT Paid Leave Authority**: third-party administrator access for quarterly contribution reports.

### Massachusetts
11. **MassTaxConnect** third-party (payroll service) access for M-941 and withholding payments. Each client signs **Form M-2848** (Power of Attorney).
12. **DUA UI Online**: Third Party Administrator registration for the quarterly Employment and Wage Detail Report, UI contributions and EMAC.
13. **Department of Family and Medical Leave**: PFML contributions are filed through MassTaxConnect. Confirm third-party access covers them.

### Oregon
14. **Oregon DOR Revenue Online / Frances Online**: payroll service provider access for the combined payroll program (Form OQ, Form 132, Form WR, W-2 upload by iWire), plus EFT payment enrollment. Each client signs Oregon's tax information authorization and power of attorney form **(verify form number)**.
15. **Oregon Employment Department (Frances Online)**: third-party access for UI and Paid Leave Oregon.
16. **TriMet and Lane Transit District** taxes are filed through Oregon DOR. Nothing separate is needed beyond item 14.

### New York
17. **NYS DTF Online Services for tax professionals**: payroll service provider account for NYS-45 (withholding, wage reporting and UI on one return), and bulk electronic filing of NYS-45 per NYS's electronic filing specifications **(verify publication number)**. Each client signs **Form POA-1**.
18. **NYS DOL**: third-party access so UI rate notices and NYS-45 UI data can be managed for clients.
19. **MCTMT** (MTA-305) for clients in the MCTD whose quarterly payroll exceeds the threshold, under the same DTF access.
20. NY disability (DBL) and Paid Family Leave are insurance. Each client must hold a policy from a carrier (or the State Insurance Fund). We withhold the employee share. Nothing to register for us.

## E-filing: credentials, testing and who does what

The e-file code is in `src/lib/efile/`. It builds every submission now. Nothing is sent until the credentials below exist, and the transmitters raise a "not configured" error until then. Each submission records its channel, files, status (draft, validated, ready_for_upload, transmitted, accepted, rejected) and the agency's receipt number.

| Filing | Channel | Built now | Gabriel must get | Then |
| --- | --- | --- | --- | --- |
| 941 (+ Schedule B), 940 | IRS MeF A2A | XML return + manifest in a zip per IRS layout | IRS e-file application (Pub. 3112) with roles Reporting Agent, Transmitter, Software Developer, giving an **EFIN** and **ETIN**. A Reporting Agent **PIN** for signing. An e-Services **A2A system ID and strong-authentication certificate**. Form 8655 from each client. | Download the TY2026 94x schemas, align element names (`mef/94x.ts`), pass **MeF Assurance Testing** for 94x per **Pub. 5078** (e-help desk 866-255-0654). The IRS then issues our **Software ID**. |
| 1099-NEC (with 1096 archived) | IRS IRIS A2A | IRIS XML transmission, UTID, 1096 kept with it | An **IRIS A2A TCC** (separate application in IRIS; FIRE is closed for TY2026). An **API client ID** registered in e-Services, with our **X.509 certificate / JWKS** for the OAuth JWT. | Download the IRIS schemas from the Secure Object Repository (needs the TCC), align `iris/1099nec.ts`, pass **IRIS ATS per Pub. 5719** (help desk 866-937-4130). Until then the IRIS Taxpayer Portal works for keying a few forms. |
| W-2/W-3 | SSA BSO upload | EFW2 file, checked, marked ready to upload | **BSO user ID** with wage reporting (optional Employer Signature PIN). | Check each file in **AccuWage Online**, upload in BSO, record the WFID. SSA has no API, so this stays a manual upload. |
| CT W-2 (state copy) and CT 1099 | myconneCT bulk upload | `CTTAX2026.txt` (RA/RE/RS/RT/RF) and the CT 1099 file (T/A/B/C/F, 750 bytes) | **myconneCT third-party bulk filer (TPBF)** login with each client linked. DRS issues no separate W-2 submitter code. | Upload the files, then file the CT-W3 and CT-1096 to complete the year. |
| CT-941, CT-W3, CT-1096 | myconneCT | Keying worksheets with each form line | Same TPBF login | DRS publishes the CSV upload layouts as .xlsx files we could not read. Send a copy of them and the CSV export can replace the worksheets. |
| M-941, OR OQ, NYS-45 | State portals | Return data only | Items 11, 14 and 17 above | E-file formats not built yet. |

## For each new client (onboarding checklist)
- Signed Form 8655, plus each state's POA (CT LGL-001, MA M-2848, NY POA-1, Oregon's form).
- The client's federal EIN and each state's withholding and UI account numbers, plus its assigned UI rate.
- EFTPS enrollment under our batch provider.
- Bank authorization for TD to debit the client's account (ACH debit authorization, CCD).
- Federal deposit schedule (monthly or semiweekly) from the IRS notice, and CT, MA and NY deposit frequencies.
- Prior-quarter and year-to-date payroll if they switch to us mid-year.

## Questions for counsel or the TD Bank partner
- Holding client funds between the debit and the tax and employee payments may trigger state money transmitter licensing, or need a trust-account structure. Confirm how the TD agreement covers this.
- Some states require payroll service providers to register or post a bond. Confirm for CT, MA, OR and NY.
- Errors and omissions and crime/fidelity insurance before handling live payroll.
