import type { Source } from "../tax-engine/types";

/**
 * Official form versions used by onboarding. Each entry names the edition we model and where it
 * came from. `verified: false` means the field list was read from a secondary copy or summary and
 * must be checked against the agency PDF before live use.
 */
export interface FormVersion {
  form: string;
  edition: string;
  /** Last day the edition may be used, if the agency publishes one. */
  expires?: string;
  source: Source;
}

export const FORM_VERSIONS = {
  W4: {
    form: "Form W-4, Employee's Withholding Certificate",
    edition: "2026",
    source: {
      cite: "IRS Form W-4 (2026)",
      url: "https://www.irs.gov/pub/irs-pdf/fw4.pdf",
      readOn: "2026-11-26",
      verified: true,
      note:
        "2026 form (Created 12/8/25) read from the IRS PDF: Step 3 applies at income of $200,000 or less ($400,000 MFJ), $2,200 per qualifying child, " +
        "$500 per other dependent; exempt checkbox after Step 4 (new W-4 needed by February 16, 2027); 15-line Deductions Worksheet.",
    },
  },
  CT_W4: {
    form: "Form CT-W4, Employee's Withholding Certificate",
    edition: "Rev. 12/25, effective January 1, 2026",
    source: {
      cite: "CT DRS Form CT-W4 (Rev. 12/25)",
      url: "https://portal.ct.gov/DRS/DRS-Forms/Current-Year-Forms/Withholding-Forms",
      readOn: "2026-11-26",
      verified: false,
      note: "Read from a copy hosted at ctd.uscourts.gov/sites/default/files/2026-CT-W-4.pdf; confirm against the DRS PDF.",
    },
  },
  MA_M4: {
    form: "Form M-4, Massachusetts Employee's Withholding Exemption Certificate",
    edition: "Rev. 3/24 (current per mass.gov, page updated 2026-02-19)",
    source: {
      cite: "MA DOR Form M-4 (Rev. 3/24)",
      url: "https://www.mass.gov/doc/form-m-4-massachusetts-employees-withholding-exemption-certificate/download",
      readOn: "2026-11-26",
      verified: true,
    },
  },
  OR_W4: {
    form: "Form OR-W-4, Oregon Employee's Withholding Statement and Exemption Certificate",
    edition: "2026 (150-101-402, Rev. 07-28-25, ver. 01)",
    source: {
      cite: "Oregon DOR Form OR-W-4 (2026) and instructions 150-101-402-1",
      url: "https://www.oregon.gov/dor/forms/FormsPubs/form-or-W-4_101-402_2026.pdf",
      readOn: "2026-11-26",
      verified: false,
      note: "Read from a copy hosted at cdn.wou.edu/hr/files/2026/01/2026-Form-OR-W-4.pdf; confirm against the DOR PDF.",
    },
  },
  NY_IT2104: {
    form: "Form IT-2104, Employee's Withholding Allowance Certificate",
    edition: "2026",
    source: {
      cite: "NYS DTF Form IT-2104 (2026) and IT-2104-I (2026)",
      url: "https://www.tax.ny.gov/forms/html-instructions/2026/it/it2104i-2026.htm",
      readOn: "2026-11-26",
      verified: false,
      note: "Line meanings read from the 2026 instructions; the form PDF (tax.ny.gov/pdf/2026/inc/it2104_2026_fill_in.pdf) was not read.",
    },
  },
  I9: {
    form: "Form I-9, Employment Eligibility Verification",
    edition: "01/20/25",
    expires: "2027-05-31",
    source: {
      cite: "USCIS Form I-9 (edition 01/20/25), E-Verify 'Minor Changes to Form I-9' (updated 2025-09-15)",
      url: "https://www.e-verify.gov/about-e-verify/whats-new/minor-changes-to-form-i-9-and-e-verify-updates",
      readOn: "2026-11-26",
      verified: true,
      note:
        "Edition 01/20/25, expiration 05/31/2027. The 08/01/23 edition may only be used with the 05/31/2027 expiration date updated in electronic systems (required by 2026-07-31). " +
        "We only generate the 01/20/25 edition. Section 1 fourth option reads 'An alien authorized to work'.",
    },
  },
  I9_DOCUMENTS: {
    form: "Form I-9 Lists of Acceptable Documents",
    edition: "01/20/25",
    source: {
      cite: "USCIS I-9 Central, Form I-9 Acceptable Documents (reviewed 2025-04-08)",
      url: "https://www.uscis.gov/i-9-central/form-i-9-acceptable-documents",
      readOn: "2026-11-26",
      verified: true,
    },
  },
  I9_HANDBOOK: {
    form: "Handbook for Employers M-274",
    edition: "current online edition",
    source: {
      cite: "USCIS M-274 Handbook for Employers",
      url: "https://www.uscis.gov/book/export/html/59502",
      readOn: "2026-11-26",
      verified: false,
      note: "Timing and retention rules; also 8 CFR 274a.2(b).",
    },
  },
} satisfies Record<string, FormVersion>;
