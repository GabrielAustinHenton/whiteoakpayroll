import type { LaunchState } from "../tax-engine/state";
import { i9Deadlines } from "./i9";
import { NEW_HIRE_REPORTING, STATE_FORM_NAME } from "./state-certificates";

export * from "./sources";
export * from "./w4";
export * from "./state-certificates";
export * from "./i9";

export type OnboardingTaskId = "w4" | "state_w4" | "i9_section1" | "i9_section2" | "new_hire_report";

export interface OnboardingTask {
  id: OnboardingTaskId;
  title: string;
  /** Who completes it. Client HR can do everything here except see bank, tax, or payroll settings. */
  owner: "employee" | "client_hr" | "white_oak";
  due: string;
  /** What happens if it's missing on payday. */
  ifMissing?: string;
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The forms each new employee needs, with deadlines. Drives the onboarding checklist. */
export function onboardingTasks(hire: { firstDay: string; workState: LaunchState; jobUnder3BusinessDays?: boolean; closed?: string[] }): OnboardingTask[] {
  const i9 = i9Deadlines(hire.firstDay, hire);
  const nh = NEW_HIRE_REPORTING[hire.workState];
  return [
    {
      id: "w4",
      title: "Form W-4 (2026)",
      owner: "employee",
      due: hire.firstDay,
      ifMissing: "Federal tax is withheld as Single with no adjustments until a W-4 is signed.",
    },
    {
      id: "state_w4",
      title: `Form ${STATE_FORM_NAME[hire.workState]}`,
      owner: "employee",
      due: hire.firstDay,
      ifMissing: {
        CT: "Connecticut tax is withheld at 6.99% with no exemption.",
        MA: "Massachusetts tax is withheld with no exemptions.",
        OR: "Oregon tax is withheld at 8% of wages.",
        NY: "New York tax is withheld as single with zero allowances.",
      }[hire.workState],
    },
    { id: "i9_section1", title: "Form I-9 Section 1", owner: "employee", due: i9.section1 },
    { id: "i9_section2", title: "Form I-9 Section 2 (examine documents in person)", owner: "client_hr", due: i9.section2 },
    { id: "new_hire_report", title: `New hire report to ${nh.agency}`, owner: "white_oak", due: addDays(hire.firstDay, nh.days) },
  ];
}
