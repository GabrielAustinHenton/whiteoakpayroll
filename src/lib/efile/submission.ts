import type { Source } from "../tax-engine/types";

/**
 * One e-file submission, whatever the channel. Stored with the payload so the exact bytes sent to
 * an agency can always be produced again (for audits and for the employer's records).
 */
export type Channel =
  /** IRS Modernized e-File, Forms 941/940 (A2A SOAP, or the Internet Filing Application). */
  | "irs_mef"
  /** IRS IRIS, 1099 series (A2A, or the IRIS Taxpayer Portal). */
  | "irs_iris"
  /** SSA Business Services Online, W-2/W-3 (EFW2 upload in a browser; there is no API). */
  | "ssa_bso"
  /** Connecticut myconneCT bulk upload (third-party bulk filer). */
  | "ct_myconnect"
  | "ma_masstaxconnect"
  | "or_revenue_online"
  | "ny_online_services";

export type SubmissionStatus =
  /** Built, not yet checked. */
  | "draft"
  /** Passed our own checks (and schema validation when the agency schema is available). */
  | "validated"
  /** Waiting for a person to upload it in the agency's portal. */
  | "ready_for_upload"
  | "transmitted"
  | "accepted"
  | "rejected";

export interface SubmissionFile {
  name: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface Submission {
  id: string;
  channel: Channel;
  form: string;
  companyEin: string;
  /** "2026Q1" or "2026". */
  period: string;
  status: SubmissionStatus;
  files: SubmissionFile[];
  /** Problems found before transmission; a submission with errors cannot move past draft. */
  errors: string[];
  warnings: string[];
  /** Agency receipt/confirmation number once transmitted or uploaded. */
  agencyReference?: string;
  acknowledgement?: { status: "accepted" | "rejected"; receivedAt: string; errors: { code: string; message: string }[] };
  createdAt: string;
}

export function newSubmission(p: Omit<Submission, "status" | "errors" | "warnings" | "createdAt"> & { errors?: string[]; warnings?: string[] }): Submission {
  const errors = p.errors ?? [];
  return {
    ...p,
    errors,
    warnings: p.warnings ?? [],
    status: errors.length ? "draft" : p.channel === "irs_mef" || p.channel === "irs_iris" ? "validated" : "ready_for_upload",
    createdAt: new Date().toISOString(),
  };
}

/** Allowed status changes; anything else is a bug. */
const NEXT: Record<SubmissionStatus, SubmissionStatus[]> = {
  draft: ["validated", "ready_for_upload"],
  validated: ["transmitted"],
  ready_for_upload: ["transmitted"],
  transmitted: ["accepted", "rejected"],
  accepted: [],
  rejected: ["draft"],
};

export function advance(s: Submission, to: SubmissionStatus, patch: Partial<Submission> = {}): Submission {
  if (!NEXT[s.status].includes(to)) throw new Error(`Cannot move submission ${s.id} from ${s.status} to ${to}`);
  return { ...s, ...patch, status: to };
}

/** Credentials and approvals each channel needs before anything can be sent (see docs/registrations.md). */
export const CHANNEL_REQUIREMENTS: Record<Channel, { needs: string[]; source: Source }> = {
  irs_mef: {
    needs: [
      "IRS e-file application approved with roles Reporting Agent, Transmitter, Software Developer (EFIN and ETIN)",
      "Software ID from passing MeF Assurance Testing (ATS) for 94x per Pub. 5078",
      "A2A credentials: e-Services system ID and a strong-authentication certificate",
      "Signed Form 8655 from each client on the Reporting Agent list",
    ],
    source: {
      cite: "IRS Pub. 4164 (Processing Year 2026); Software developers technical fact sheet; Pub. 5078",
      url: "https://www.irs.gov/e-file-providers/software-developers-technical-fact-sheet",
      readOn: "2026-11-26",
      verified: true,
    },
  },
  irs_iris: {
    needs: ["IRIS A2A Transmitter Control Code (TCC)", "IRIS A2A communications testing (ATS) passed", "A2A credentials (API client ID and JWT signing key)"],
    source: { cite: "IRS Pub. 5717/5718/5719 (IRIS)", url: "https://www.irs.gov/e-file-providers/iris-schemas-and-business-rules", readOn: "2026-11-26", verified: false },
  },
  ssa_bso: {
    needs: ["SSA BSO user ID with wage reporting access (optional Employer Signature PIN)"],
    source: { cite: "SSA Pub. 42-007 EFW2 TY2026", url: "https://www.ssa.gov/employer/efw/26efw2.pdf", readOn: "2026-11-26", verified: true },
  },
  ct_myconnect: {
    needs: ["myconneCT third-party bulk filer (TPBF) login with access to each client"],
    source: { cite: "CT DRS myconneCT TPBF page", url: "https://portal.ct.gov/drs/myconnect/tpbf", readOn: "2026-11-26", verified: true },
  },
  ma_masstaxconnect: { needs: ["MassTaxConnect third-party access, Form M-2848 per client"], source: { cite: "MA DOR", url: "https://mtc.dor.state.ma.us", readOn: "2026-11-26", verified: false } },
  or_revenue_online: { needs: ["Oregon Revenue Online payroll service access"], source: { cite: "Oregon DOR", url: "https://revenueonline.dor.oregon.gov", readOn: "2026-11-26", verified: false } },
  ny_online_services: { needs: ["NY Online Services tax professional account, Form POA-1 per client"], source: { cite: "NYS DTF", url: "https://www.tax.ny.gov/online/", readOn: "2026-11-26", verified: false } },
};
