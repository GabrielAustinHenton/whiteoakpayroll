export type PayFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly";
export type LaunchState = "CT" | "MA" | "OR" | "NY";

export const PERIODS_PER_YEAR: Record<PayFrequency, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
};

export interface WorkerProfile {
  state: LaunchState;
  /** Hourly vs salaried; MA treats them differently. */
  payBasis: "hourly" | "salaried";
  /** NY "manual worker" (more than 25% physical labor). */
  nyManualWorker?: boolean;
  /** MA: the employee asked in writing to be paid monthly. */
  maElectedMonthly?: boolean;
  /** CT: the employer holds Labor Commissioner approval for less frequent pay. */
  ctLessFrequentApproval?: boolean;
}

export interface FrequencyCheck {
  allowed: boolean;
  reason?: string;
}

/**
 * Whether a pay frequency is allowed for a worker in a launch state.
 * Rules summarized from official sources in the product spec; confirm with counsel before launch.
 */
export function checkPayFrequency(freq: PayFrequency, w: WorkerProfile): FrequencyCheck {
  switch (w.state) {
    case "CT":
      // CGS 31-71b: weekly or every two weeks; less often needs Labor Commissioner approval (31-71i).
      if (freq === "weekly" || freq === "biweekly") return { allowed: true };
      return w.ctLessFrequentApproval
        ? { allowed: true }
        : { allowed: false, reason: "Connecticut requires Labor Commissioner approval for pay less often than every two weeks." };
    case "MA":
      // c.149 s.148: hourly weekly/biweekly; salaried may be semi-monthly; monthly only by employee election.
      if (freq === "weekly" || freq === "biweekly") return { allowed: true };
      if (w.payBasis === "hourly")
        return { allowed: false, reason: "Massachusetts hourly workers must be paid weekly or bi-weekly." };
      if (freq === "semimonthly") return { allowed: true };
      return w.maElectedMonthly
        ? { allowed: true }
        : { allowed: false, reason: "Massachusetts allows monthly pay only when the employee elects it." };
    case "OR":
      // Paydays no more than 35 days apart; all four frequencies satisfy that.
      return { allowed: true };
    case "NY":
      // NYLL 191: manual workers weekly (unless DOL authorization); others at least twice a month.
      if (w.nyManualWorker)
        return freq === "weekly"
          ? { allowed: true }
          : { allowed: false, reason: "New York manual workers must be paid weekly." };
      return freq === "monthly"
        ? { allowed: false, reason: "New York requires pay at least twice a month." }
        : { allowed: true };
  }
}
