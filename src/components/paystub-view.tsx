import type { Paystub } from "@/lib/app/paystub";
import { prettyDate, usd } from "./ui";

export function PaystubView({ p }: { p: Paystub }) {
  const r = p.line.payRun;
  const rows = (xs: { label: string; current: number; ytd?: number }[]) =>
    xs.map((x) => (
      <tr key={x.label}><td>{x.label}</td><td className="num">{usd(x.current)}</td><td className="num muted">{x.ytd === undefined ? "" : usd(x.ytd)}</td></tr>
    ));
  return (
    <>
      <h1>Paystub: {p.employee.firstName} {p.employee.lastName}</h1>
      <p className="muted">{p.company.legalName} · payday {prettyDate(r.payday)} · period {prettyDate(r.periodStart)} to {prettyDate(r.periodEnd)}</p>
      <p><a href={`/api/paystubs/${p.line.id}`}>Download PDF</a></p>
      <div className="stats">
        <div className="stat"><b>{usd(p.gross.current)}</b>gross</div>
        <div className="stat"><b>{usd(p.net.current)}</b>net pay</div>
      </div>
      <table>
        <thead><tr><th></th><th className="num">This check</th><th className="num">Year to date</th></tr></thead>
        <tbody>
          <tr><th colSpan={3}>Earnings</th></tr>
          {rows(p.earnings)}
          <tr><td><b>Gross pay</b></td><td className="num"><b>{usd(p.gross.current)}</b></td><td className="num">{usd(p.gross.ytd)}</td></tr>
          <tr><th colSpan={3}>Taxes withheld</th></tr>
          {rows(p.taxes)}
          {p.deductions.length > 0 && <tr><th colSpan={3}>Deductions</th></tr>}
          {rows(p.deductions)}
          <tr><td><b>Net pay</b> <span className="small muted">({p.paidBy})</span></td><td className="num"><b>{usd(p.net.current)}</b></td><td className="num">{usd(p.net.ytd)}</td></tr>
          <tr><th colSpan={3}>Paid by your employer</th></tr>
          {rows(p.employerTaxes)}
        </tbody>
      </table>
    </>
  );
}
