import type { PlanType } from "./plans";

/**
 * Retirement providers White Oak can connect to, and how each connection really works today.
 *
 * Researched 2026-11-27. The short version: no major 401(k) recordkeeper offers an open, self-serve
 * API. Each one connects payroll companies through a partnership (Principal: EDI file feeds for 50+
 * employee cases, API only with existing partners or "a mutual commitment to build one",
 * principal.com/data-integration). Until a partnership is signed, the working method everywhere is
 * a contribution file that the employer (or White Oak staff) uploads on the provider's website.
 * The state programs (OregonSaves, MyCTSavings, MarylandSaves) are run by Vestwell and publish a
 * file layout for payroll providers ("180 Integration Instructions for State Payroll Providers").
 */

/** How contributions get to the provider. */
export type ConnectionMethod =
  /** White Oak builds the file each payday; someone uploads it on the provider's site. Works now. */
  | "file_upload"
  /** White Oak sends files automatically over SFTP. Needs the provider's partner agreement and credentials. */
  | "sftp"
  /** Two-way API: contributions out, elections and plan changes in. Needs a partner agreement. */
  | "api";

export type FileFormat = "vestwell_180" | "white_oak_standard";

export interface ProviderInfo {
  key: string;
  name: string;
  kind: "recordkeeper" | "state_program";
  /** Plan types this provider administers. */
  planTypes: PlanType[];
  /** Methods available to White Oak today, best first. file_upload always works. */
  available: ConnectionMethod[];
  /** Methods that open up once Gabriel's partnership application is approved. */
  withPartnership: ConnectionMethod[];
  fileFormat: FileFormat;
  /** Where the employer signs in to upload files and see the plan. */
  sponsorSite: string;
  /** How White Oak applies to become a payroll partner. */
  partnerContact: string;
  /** One-line facts, with source, shown on the connection page. */
  facts: string[];
  state?: "CT" | "OR" | "NY" | "MA";
  /** Defaults the state program uses (unverified unless the fact list cites them). */
  stateDefaults?: { autoEnrollRate: number; optOutDays: number; minAge: number };
}

export const PROVIDERS: ProviderInfo[] = [
  {
    key: "oregonsaves",
    name: "OregonSaves",
    kind: "state_program",
    planTypes: ["STATE_AUTO_IRA"],
    available: ["file_upload"],
    withPartnership: ["api"],
    fileFormat: "vestwell_180",
    sponsorSite: "https://employer.oregonsaves.com",
    partnerContact: "statepayrollintegrations@vestwell.com",
    state: "OR",
    stateDefaults: { autoEnrollRate: 0.05, optOutDays: 30, minAge: 18 },
    facts: [
      "Required for Oregon employers with no retirement plan of their own (any size).",
      "No charge for a payroll integration; integrated providers today include Gusto, Paylocity and QuickBooks Online (oregonsaves.com/employers/payroll-providers).",
      "Contribution uploads accept CSV or Excel with SSN, first name, last name and the dollar amount per person (help.oregonsaves.com, 'How to Submit Contributions via File Upload').",
      "Employers add their payroll provider as a 'teammate' on their OregonSaves account so the provider can upload.",
      "Default 5% Roth IRA savings, rising 1% a year to 10% (unverified, confirm with the program).",
    ],
  },
  {
    key: "myctsavings",
    name: "MyCTSavings",
    kind: "state_program",
    planTypes: ["STATE_AUTO_IRA"],
    available: ["file_upload"],
    withPartnership: ["api"],
    fileFormat: "vestwell_180",
    sponsorSite: "https://employer.myctsavings.com",
    partnerContact: "statepayrollintegrations@vestwell.com",
    state: "CT",
    stateDefaults: { autoEnrollRate: 0.03, optOutDays: 30, minAge: 19 },
    facts: [
      "Required for Connecticut employers with 5 or more CT employees and no retirement plan.",
      "Run by Vestwell, same file layout as OregonSaves ('180 Integration Instructions for State Payroll Providers').",
      "Default 3% Roth IRA savings; employees 19 and older after 120 days of employment (from earlier research, verify).",
    ],
  },
  {
    key: "ny_secure_choice",
    name: "New York Secure Choice",
    kind: "state_program",
    planTypes: ["STATE_AUTO_IRA"],
    available: ["file_upload"],
    withPartnership: ["api"],
    fileFormat: "vestwell_180",
    sponsorSite: "https://newyorksecurechoice.com",
    partnerContact: "Program's payroll provider support (administrator not confirmed; ask through newyorksecurechoice.com)",
    state: "NY",
    stateDefaults: { autoEnrollRate: 0.03, optOutDays: 30, minAge: 18 },
    facts: [
      "Required for employers in business 2+ years with 10 or more NY employees and no qualified plan (Venable, April 2026).",
      "Registration deadlines in 2026: 30+ employees by March 18, 15-29 by May 15, 10-14 by July 15; newly covered employers by November 18, 2026 (Vestwell, updated November 2026).",
      "Contributions go to a Roth IRA unless the employee opts out. Default rate and file layout not confirmed yet; we assume the Vestwell layout until the program confirms.",
    ],
  },
  {
    key: "principal",
    name: "Principal",
    kind: "recordkeeper",
    planTypes: ["401K", "SAFE_HARBOR_401K", "SIMPLE_IRA"],
    available: ["file_upload"],
    withPartnership: ["sftp", "api"],
    fileFormat: "white_oak_standard",
    sponsorSite: "https://www.principal.com/businesses",
    partnerContact: "Principal sales representative / data integration team (principal.com/data-integration, 800-986-3343)",
    facts: [
      "EDI file feeds need at least 50 employees on the case; 'Principal can connect with any vendor that meets our EDI specifications' (principal.com/data-integration).",
      "API is available for all case sizes, but 'depends on existing integrations or a mutual commitment to build one'. Partners include Gusto and Rippling.",
      "Until then: the employer (or White Oak staff) uploads White Oak's contribution file on Principal's plan sponsor site each payday.",
    ],
  },
  {
    key: "fidelity",
    name: "Fidelity",
    kind: "recordkeeper",
    planTypes: ["401K", "SAFE_HARBOR_401K", "SIMPLE_IRA"],
    available: ["file_upload"],
    withPartnership: ["sftp"],
    fileFormat: "white_oak_standard",
    sponsorSite: "https://plansponsorservices.fidelity.com",
    partnerContact: "Fidelity Workplace Investing payroll integration team (through the client's Fidelity relationship manager)",
    facts: ["Partner requirements are not public; ask Fidelity. Until a feed is set up, the sponsor uploads White Oak's contribution file on Fidelity's plan sponsor site."],
  },
  {
    key: "empower",
    name: "Empower",
    kind: "recordkeeper",
    planTypes: ["401K", "SAFE_HARBOR_401K"],
    available: ["file_upload"],
    withPartnership: ["sftp", "api"],
    fileFormat: "white_oak_standard",
    sponsorSite: "https://www.empower.com/plan-sponsors",
    partnerContact: "Empower payroll partner program (through the plan's Empower contact)",
    facts: ["Partner requirements are not public; ask Empower. Until then, the sponsor uploads White Oak's contribution file."],
  },
  {
    key: "ascensus",
    name: "Ascensus (including Vanguard small-business plans)",
    kind: "recordkeeper",
    planTypes: ["401K", "SAFE_HARBOR_401K", "SIMPLE_IRA"],
    available: ["file_upload"],
    withPartnership: ["sftp", "api"],
    fileFormat: "white_oak_standard",
    sponsorSite: "https://www.ascensus.com",
    partnerContact: "Ascensus payroll integration partners team",
    facts: ["Vanguard moved its small-business retirement plans to Ascensus (verify for each client). Partner requirements are not public; ask Ascensus."],
  },
  {
    key: "john_hancock",
    name: "John Hancock",
    kind: "recordkeeper",
    planTypes: ["401K", "SAFE_HARBOR_401K"],
    available: ["file_upload"],
    withPartnership: ["sftp"],
    fileFormat: "white_oak_standard",
    sponsorSite: "https://www.johnhancock.com/retirement",
    partnerContact: "John Hancock Retirement payroll integration team",
    facts: ["Partner requirements are not public; ask John Hancock. Until then, the sponsor uploads White Oak's contribution file."],
  },
  {
    key: "guideline",
    name: "Guideline",
    kind: "recordkeeper",
    planTypes: ["401K", "SAFE_HARBOR_401K"],
    available: ["file_upload"],
    withPartnership: ["api"],
    fileFormat: "white_oak_standard",
    sponsorSite: "https://my.guideline.com",
    partnerContact: "Guideline payroll partnerships (guideline.com)",
    facts: ["Owned by Gusto, so a partnership with a competing payroll company may be harder. Ask Guideline; until then, upload the file."],
  },
  {
    key: "human_interest",
    name: "Human Interest",
    kind: "recordkeeper",
    planTypes: ["401K", "SAFE_HARBOR_401K"],
    available: ["file_upload"],
    withPartnership: ["api"],
    fileFormat: "white_oak_standard",
    sponsorSite: "https://app.humaninterest.com",
    partnerContact: "Human Interest partner integrations (humaninterest.com/partner-integrations)",
    facts: ["Publishes a payroll partner integrations page (humaninterest.com/partner-integrations): the most likely first API partner."],
  },
  {
    key: "other",
    name: "Another provider",
    kind: "recordkeeper",
    planTypes: ["401K", "SAFE_HARBOR_401K", "SIMPLE_IRA"],
    available: ["file_upload"],
    withPartnership: [],
    fileFormat: "white_oak_standard",
    sponsorSite: "",
    partnerContact: "",
    facts: ["White Oak builds a contribution file every payday that most recordkeepers' sites can import."],
  },
];

export function provider(key: string): ProviderInfo {
  return PROVIDERS.find((p) => p.key === key) ?? PROVIDERS[PROVIDERS.length - 1];
}

/** The state program a company in this state must use if it has no plan of its own. MA has no private-employer mandate. */
export function stateProgramFor(state: string): ProviderInfo | undefined {
  return PROVIDERS.find((p) => p.kind === "state_program" && p.state === state);
}

export const METHOD_LABEL: Record<ConnectionMethod, string> = {
  file_upload: "File each payday (upload on the provider's site)",
  sftp: "Automatic file transfer (SFTP)",
  api: "Live connection (API)",
};
