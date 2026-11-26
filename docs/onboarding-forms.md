# Employee onboarding forms: W-4, state certificates, I-9

Library code lives in `src/lib/onboarding/`. It models each form as the employee or employer fills
it in, validates it, converts withholding forms into the tax engine's inputs, and computes the
deadlines and duties each form creates. Screens and storage are wired in by the app build
(see "Storage" below). Tests: `tests/onboarding.test.ts`.

## Forms and versions

| Form | Edition we model | Who | Feeds | Source |
| --- | --- | --- | --- | --- |
| Form W-4 | 2026 (IRS PDF created 12/8/25) | Employee, by first day | `toFederalW4` → `FederalW4` → `federalIncomeTax` | [irs.gov/pub/irs-pdf/fw4.pdf](https://www.irs.gov/pub/irs-pdf/fw4.pdf) |
| CT-W4 | Rev. 12/25, effective 1/1/2026 | Employee | `toCtW4` → `CtW4` | [CT DRS withholding forms](https://portal.ct.gov/DRS/DRS-Forms/Current-Year-Forms/Withholding-Forms) |
| M-4 | Rev. 3/24 (still current) | Employee | `toMaW4` → `MaW4` | [mass.gov Form M-4](https://www.mass.gov/doc/form-m-4-massachusetts-employees-withholding-exemption-certificate/download) |
| OR-W-4 | 2026 (Rev. 07-28-25) | Employee | `toOrW4` → `OrW4` | [Oregon DOR OR-W-4](https://www.oregon.gov/dor/forms/FormsPubs/form-or-W-4_101-402_2026.pdf) |
| IT-2104 (+ IT-2104-E to claim exempt) | 2026 | Employee | `toNyIt2104` → `NyIt2104` | [IT-2104-I (2026)](https://www.tax.ny.gov/forms/html-instructions/2026/it/it2104i-2026.htm) |
| Form I-9 | 01/20/25, expires 05/31/2027 | Employee (Section 1), Client HR (Section 2) | Onboarding checklist, reverification and purge dates | [E-Verify notice](https://www.e-verify.gov/about-e-verify/whats-new/minor-changes-to-form-i-9-and-e-verify-updates), [acceptable documents](https://www.uscis.gov/i-9-central/form-i-9-acceptable-documents), [M-274](https://www.uscis.gov/book/export/html/59502) |

`src/lib/onboarding/sources.ts` holds each citation with a `verified` flag. Items still marked
`verified: false` (CT, OR, NY field layouts read from copies or instructions, CT code chart, the CT
$1,000/week DRS-copy trigger, MA and OR new-hire deadlines) must be checked against the agency PDF
before live payroll.

## Key rules encoded

**W-4 (2026).** Step 3 is $2,200 per qualifying child under 17 and $500 per other dependent. Exempt
is a checkbox after Step 4 and lasts for 2026 only: a new W-4 is due by February 16, 2027
(`exemptExpires`). No W-4 or an invalid one: withhold as Single/MFS with no adjustments
(`NO_W4_ON_FILE`). Nonresident aliens can't claim exempt and must check Single/MFS (Notice 1392).
IRS lock-in letters override the employee's form (`W4EmployerFacts.lockIn`).

**State defaults when no form is on file.** CT: 6.99% with no exemption. MA: no exemptions. OR: 8%
of wages (a 2020+ federal W-4 cannot be used for Oregon). NY: single, zero allowances.

**State copies to send** (`stateCertificateDuties`). NY: IT-2104 with more than 14 allowances, by
the end of the month after the quarter received. CT: CT-W4 claiming code E with high expected wages.
OR: exemption ends February 15 of the next year; ask for a new form.

**I-9.** Section 1 by the first day of work, and only after the offer is accepted. Section 2 within
3 business days after the first day (Monday start → Thursday), or on day one if the job lasts under
3 business days (`i9Deadlines`). One List A document, or one List B plus one List C; the employee
chooses, and the employer may not ask for specific documents. Under-18 List B records allowed only
for minors. SSN in Section 1 is voluntary unless the employer uses E-Verify. Reverification
(Supplement B) by the date work authorization expires, never for citizens, nationals, or green card
holders. Rehire within 3 years can use Supplement B. Retention: 3 years after the first day or 1
year after termination, whichever is later (`i9RetainUntil`, 8 CFR 274a.2(b)(2)(i)(A)).
Remote document examination (DHS alternative procedure) only for E-Verify employers in good
standing, with copies kept of every document.

## What is stored today

- **SSNs are encrypted** with AES-256-GCM (`src/lib/security/field-crypto.ts`). The employee row keeps
  `ssnEncrypted` and `ssnLast4`; the old plaintext `ssn` column is null for new saves and only read as
  a fallback for test rows created before this change. The full SSN is decrypted only when building
  filings. Set `FIELD_ENCRYPTION_KEY` before turning off `TEST_IDS_ONLY`; without a key the app uses a
  fixed preview key that is only allowed while test SSNs are enforced.
- **Form history**: each save that changes the W-4 or the state certificate adds a new
  `W4Certificate` / `StateWithholdingCertificate` row and marks the previous one superseded.
- **I-9**: `I9Record` tracks Section 1 and Section 2 completion, the Section 2 due date, the
  reverification date, and the retention date (set on offboarding). Rehire within 3 years keeps
  the original I-9 (Supplement B); later rehires start a new one. Document numbers and images are
  not stored yet: the employer keeps the signed paper I-9.

Still to do before real employees: move the key to a cloud KMS (envelope encryption), encrypt
contractor TINs the same way, encrypted document storage for I-9 copies, employee self-service
signing in the portal, and a nightly purge on `retainUntil`.

## Full storage and security plan

These forms carry the most sensitive data in the product: SSNs, dates of birth, immigration
numbers, and images of passports and driver's licenses. Before any real employee uses onboarding:

1. **Postgres with field-level encryption.** SSN, A-Number/USCIS number, I-94 number, foreign
   passport number, and document numbers are encrypted in the app with envelope encryption (a
   per-company data key wrapped by a KMS key, e.g. AWS KMS). Store only `ssnLast4` in clear for
   display and matching. Never put these values in logs, analytics, error reports, or URLs.
2. **Document images in a separate private bucket** (S3 or equivalent) with SSE-KMS, no public
   access, short-lived signed URLs, and object keys that contain no names or numbers. Copies are
   optional under I-9 rules, but if a company keeps them it must keep them for every hire, so make
   it a per-company setting, not per-employee. Required when using the remote-examination procedure.
3. **Access by role.** Employees see their own forms. Client HR completes I-9 Section 2 and sees
   onboarding status, but sees only the last 4 of an SSN and cannot download W-4 data in bulk.
   White Oak staff access requires MFA and a logged reason. Every view or download of an I-9 or
   document image writes an `AuditLog` row.
4. **Electronic signatures and audit trail** (8 CFR 274a.2(e)-(i) for electronic I-9s): record
   signer, timestamp, IP, and form edition with each signature; corrections create a new version
   rather than overwriting; produce a printable I-9 for inspections within 3 business days of a
   Notice of Inspection.
5. **Retention jobs.** A nightly job purges I-9s and their images on `i9RetainUntil`. Keep W-4 and
   state certificates at least 4 years after the tax becomes due or is paid (IRS employment tax
   records rule); keep them on file while in effect.
6. **Keep I-9s apart from personnel files** so they can be produced to auditors without exposing
   other records.

### Schema fields to add (for the app build thread)

- `W4Certificate`: employeeId, formYear, filingStatus, multipleJobs, qualifyingChildren,
  otherDependents, otherCredits, otherIncome, deductions, extraWithholding, exempt, exemptExpiresOn,
  signedName, signedAt, signedIp, supersededAt.
- `StateWithholdingCertificate`: employeeId, state, formName, formRevision, data (Json, the
  `FormCtW4`/`FormM4`/`FormOrW4`/`FormIt2104` shape), signedName, signedAt, signedIp, supersededAt,
  sentToStateAt.
- `I9Record`: employeeId, edition, firstDayOfEmployment, section1 (Json, minus secrets),
  attestationStatus, workAuthExpiresOn, encrypted identifier fields (Bytes), section1SignedAt,
  section2 (Json), section2SignedAt, examinerUserId, alternativeProcedure, reverifyBy, retainUntil,
  everifyCaseNumber (later).
- `I9Document`: i9RecordId, typeId, list, issuingAuthority, numberEncrypted (Bytes), numberLast4,
  expiresOn, receiptKind, imageKeys (String[]).
- `Employee`: ssnEncrypted (Bytes), ssnLast4, offerAcceptedAt.

## Later

E-Verify (case creation within 3 business days of the first day, required for remote examination),
IT-2104-E/IT-2104-MS forms, CT-W4NA for nonresidents, MSRRA military spouse documentation, and the
state new-hire report files.
