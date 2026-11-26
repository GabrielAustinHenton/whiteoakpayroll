import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/session";
import { Notice, messages, prettyDate } from "@/components/ui";
import { generate, markFiled } from "../actions";

const ORDER = ["941", "940", "W-3", "W-2", "1096", "1099-NEC", "CT-941", "CT-W3", "M-941", "OQ", "NYS-45"];

export default async function Filings({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { companyId } = await params;
  await requireArea(companyId, "filings");
  const { error, ok } = await messages(searchParams);
  const filings = await db.filing.findMany({ where: { companyId }, orderBy: [{ period: "desc" }, { form: "asc" }], select: { id: true, form: true, period: true, recipient: true, status: true, generatedAt: true, filedAt: true } });
  const runs = await db.payRun.findMany({ where: { companyId, status: "PAID" }, select: { payday: true } });
  const periods = new Set<string>();
  for (const r of runs) {
    const y = r.payday.getUTCFullYear();
    periods.add(`${y}-Q${Math.floor(r.payday.getUTCMonth() / 3) + 1}`);
    periods.add(String(y));
  }
  const byPeriod = new Map<string, typeof filings>();
  for (const f of filings) byPeriod.set(f.period, [...(byPeriod.get(f.period) ?? []), f]);
  for (const list of byPeriod.values()) list.sort((a, b) => ORDER.indexOf(a.form) - ORDER.indexOf(b.form) || (a.recipient ?? "").localeCompare(b.recipient ?? ""));
  const all = [...new Set([...periods, ...byPeriod.keys()])].sort().reverse();

  return (
    <>
      <h1>Tax filings</h1>
      <p className="muted">
        Completed forms for this company, filled in from approved pay runs. Generate a quarter for the 941 and state quarterly
        returns, and a year for the 940, W-2s, W-3, 1099-NECs, 1096 and CT-W3. Every form downloads as a PDF and stays in
        this archive. A Form 1096 is always kept, even when 1099s are e-filed, because Connecticut auditors ask for it.
      </p>
      <Notice error={error} ok={ok} />
      {all.length === 0 && <p className="notice">No paid pay runs yet. Forms appear here after your first approved pay run.</p>}
      {all.map((p) => (
        <div className="card" key={p}>
          <div className="actions">
            <b>{p.includes("Q") ? `${p.slice(0, 4)} quarter ${p.slice(-1)}` : `${p} year end`}</b>
            <form action={generate} className="inline">
              <input type="hidden" name="companyId" value={companyId} />
              <input type="hidden" name="period" value={p} />
              <button type="submit" className="secondary">{byPeriod.has(p) ? "Regenerate" : "Generate forms"}</button>
            </form>
          </div>
          {(byPeriod.get(p) ?? []).length > 0 && (
            <table>
              <tbody>
                {byPeriod.get(p)!.map((f) => (
                  <tr key={f.id}>
                    <td><b>{f.form}</b>{f.recipient ? ` · ${f.recipient}` : ""}</td>
                    <td className="small muted">generated {prettyDate(f.generatedAt)}</td>
                    <td>{f.status === "filed" ? <span className="badge paid">filed {prettyDate(f.filedAt)}</span> : (
                      <form action={markFiled} className="inline">
                        <input type="hidden" name="companyId" value={companyId} />
                        <input type="hidden" name="filingId" value={f.id} />
                        <button type="submit" className="link small">Mark filed</button>
                      </form>
                    )}</td>
                    <td><a href={`/api/filings/${f.id}`}>Download PDF</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </>
  );
}
