/**
 * Pre-run checks: things that look wrong on a draft pay run, flagged before anyone approves it.
 * Pure (the pay run page passes the facts). "stop" means the run should not go out as is;
 * "check" means it may be right but deserves a second look.
 */

export interface RunCheckLine {
  name: string;
  payBasis: "HOURLY" | "SALARIED";
  hours: number | null;
  overtimeHours: number;
  defaultHours: number;
  bonusCents: number;
  grossCents: number;
  netCents: number;
  /** Gross on this person's last paid regular paycheck, if any. */
  previousGrossCents: number | null;
  paymentMethod: string;
  bankLast4: string | null;
  i9Done: boolean;
  /** YYYY-MM-DD */
  hireDate: string;
  terminationDate: string | null;
}

export interface RunCheckFacts {
  today: string;
  payday: string;
  approveBy: string;
  periodStart: string;
  periodEnd: string;
  lines: RunCheckLine[];
  /** People on this schedule who are still filling in their onboarding (left off the run). */
  waitingOnboarding: string[];
}

export interface RunFlag {
  level: "stop" | "check";
  message: string;
}

const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export function runChecks(f: RunCheckFacts): RunFlag[] {
  const flags: RunFlag[] = [];
  if (f.payday < f.today) flags.push({ level: "stop", message: `Payday ${f.payday} has already passed. Change it or delete this draft and start the next pay run.` });
  else if (f.approveBy < f.today) flags.push({ level: "check", message: `The cutoff for on-time direct deposit was ${f.approveBy}. Deposits may arrive a day or two after payday; paper checks are not affected.` });
  if (f.lines.length === 0) flags.push({ level: "stop", message: "Nobody is on this pay run." });

  for (const l of f.lines) {
    if (l.grossCents === 0) flags.push({ level: "check", message: `${l.name} has no pay this period${l.payBasis === "HOURLY" ? " (0 hours)" : ""}, so they won't get a paycheck.` });
    if (l.netCents < 0 || (l.grossCents > 0 && l.netCents === 0)) flags.push({ level: "stop", message: `${l.name}'s deductions use up their whole paycheck (net ${usd(l.netCents)}). Lower a deduction or advance repayment.` });
    if (l.payBasis === "HOURLY" && l.hours !== null && l.defaultHours > 0 && l.hours > l.defaultHours * 1.5) flags.push({ level: "check", message: `${l.name} has ${l.hours} regular hours, well above their usual ${l.defaultHours}. Is that right, or should some be overtime?` });
    if (l.overtimeHours > 20) flags.push({ level: "check", message: `${l.name} has ${l.overtimeHours} overtime hours.` });
    if (l.previousGrossCents && l.grossCents > 0) {
      const ratio = l.grossCents / l.previousGrossCents;
      if (ratio >= 1.5 || ratio <= 0.5) flags.push({ level: "check", message: `${l.name}'s gross pay is ${usd(l.grossCents)}, ${ratio >= 1.5 ? "up" : "down"} from ${usd(l.previousGrossCents)} last time.` });
    }
    if (l.paymentMethod === "DIRECT_DEPOSIT" && !l.bankLast4 && l.grossCents > 0) flags.push({ level: "check", message: `${l.name} has no bank account on file, so they will be paid by paper check.` });
    if (l.hireDate > f.periodStart && l.hireDate <= f.periodEnd && l.grossCents > 0)
      flags.push({ level: "check", message: `${l.name} started on ${l.hireDate}, partway through this pay period. ${l.payBasis === "HOURLY" ? "Enter only the hours they worked." : "Their full-period salary is on this run. Partial-period salary is not automatic yet, so check the amount before approving."}` });
    if (l.terminationDate && l.terminationDate >= f.periodStart && l.terminationDate < f.periodEnd && l.grossCents > 0)
      flags.push({ level: "check", message: `${l.name}'s last day was ${l.terminationDate}, partway through this pay period. Pay only through their last day.` });
    if (!l.i9Done) flags.push({ level: "check", message: `${l.name}'s Form I-9 isn't complete yet. You can pay them, but finish Section 2 within 3 business days of their first day.` });
  }

  for (const n of f.waitingOnboarding) flags.push({ level: "check", message: `${n} hasn't finished their onboarding, so they are not on this pay run. They join the next pay run once they finish.` });
  return flags;
}
