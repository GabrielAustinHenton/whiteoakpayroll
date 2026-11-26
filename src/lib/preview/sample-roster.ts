import { dollars } from "../money";
import type { EmployeeRunInput } from "../taxes/employer-taxes";

const FIRST = ["Ana", "Ben", "Dee", "Eli", "Fay", "Gus", "Hana", "Ivan", "Jo", "Kai", "Lena", "Max", "Nia", "Omar", "Pia", "Quinn", "Rosa", "Sam", "Tess", "Uma"];
const LAST = ["Ruiz", "Cho", "Park", "Novak", "Okafor", "Silva", "Berg", "Kim", "Shah", "Moore", "Diaz", "Reyes", "Lund", "Ito", "Grant", "Vance", "Hale", "Ortiz", "Wolfe", "Ng"];
// Bi-weekly gross pay and wages already paid this year, cycled so the preview shows a realistic mix,
// including one person over the Social Security wage base.
const PAY = [
  { gross: 2_400, ytd: 4_800 },
  { gross: 1_850, ytd: 6_200 },
  { gross: 7_500, ytd: 180_000 },
  { gross: 1_200, ytd: 0 },
  { gross: 3_100, ytd: 52_700 },
  { gross: 2_000, ytd: 20_000 },
  { gross: 950, ytd: 9_500 },
];

/** A made-up, repeatable roster of `count` employees for the pay run preview. */
export function sampleRoster(count: number): EmployeeRunInput[] {
  return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, i) => {
    const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7 + Math.floor(i / FIRST.length)) % LAST.length]}`;
    const pay = PAY[i % PAY.length];
    return { employeeId: `${name} #${i + 1}`, grossWages: dollars(pay.gross), ytdWagesBefore: dollars(pay.ytd) };
  });
}
