"use client";

import type { DashboardViewPayload } from "@/app/lib/dashboard-projection";

import { type BalancePayments } from "@/app/lib/dashboard";
import { formatObservationDate } from "@/app/lib/visual-data";
import BalancePaymentsVisual from "@/app/components/BalancePaymentsVisual";
import { formatDate } from "@/app/lib/dashboard-format";
import { useDashboardData } from "@/app/components/DashboardShell";
import { useState } from "react";

export function BalancePaymentsSection({ dashboard, loadQuarters }: { dashboard: DashboardViewPayload<"bop"> | null; loadQuarters?: () => Promise<BalancePayments["quarters"]> }) {
  const [tableOpen, setTableOpen] = useState(false);
  const bop = dashboard?.balancePayments;
  const latest = bop?.quarters.at(-1);
  const fmt = (value: number | null | undefined) => value == null ? "—" : `RM ${value > 0 ? "+" : ""}${value.toFixed(1)}bn`;
  const account = (row: BalancePayments["quarters"][number] | undefined, id: string) => row?.accounts.find((item) => item.id === id)?.balance ?? null;
  return <section className="section deep-section bop-section page-section" id="bop"><div className="shell">
    <div className="section-heading light"><div><span className="section-number">08 / Balance of payments</span><h1>External financing position</h1></div><p>Trade in goods is only one part of the external story. The balance of payments adds income flows, services, capital and financial-account movements.</p></div>
    {!bop || !latest ? <div className="deep-empty">{dashboard ? "No validated data is available for this section in the current dataset." : "Loading validated data…"}</div> : <>
      <div className="deep-hero"><div><span>Latest quarter</span><strong>{formatObservationDate(latest.date, "quarterly")}</strong><b className={`risk-pill ${bop.status}`}>{bop.status}</b></div><p>{bop.narratives.externalPosition}</p></div>
      <BalancePaymentsVisual data={bop} usingFallback={dashboard?.usingFallback} loadQuarters={loadQuarters} />
      <div className="deep-card-grid">
        <article><span>Current account</span><strong>{fmt(bop.summary.currentAccount)}</strong><p>{bop.summary.reading} · change from previous quarter {fmt(bop.summary.currentAccountChange)}</p></article>
        <article><span>Financial account</span><strong>{fmt(bop.summary.financialAccount)}</strong><p>Largest latest component: {bop.summary.largestAbsoluteComponent}.</p></article>
        <article><span>Reserve assets</span><strong>{fmt(bop.summary.reserveAccount)}</strong><p>{bop.narratives.ringgitContext}</p></article>
      </div>
      <details className="dashboard-details visual-audit" onToggle={event => setTableOpen(event.currentTarget.open)}><summary>Latest 12 quarters — full account table</summary>{tableOpen && <div className="deep-table-wrap"><table><thead><tr><th>Quarter</th><th>Current account</th><th>Capital account</th><th>Financial account</th><th>Reserve assets</th><th>Net errors</th></tr></thead><tbody>{[...bop.quarters].slice(-12).reverse().map((row) => <tr key={row.date}><td>{formatObservationDate(row.date, "quarterly")}</td><td>{fmt(account(row, "ca"))}</td><td>{fmt(account(row, "ka"))}</td><td>{fmt(account(row, "fa"))}</td><td>{fmt(account(row, "reserves"))}</td><td>{fmt(account(row, "neo"))}</td></tr>)}</tbody></table></div>}</details>
      <div className="external-sources"><p>{bop.message} · Retrieved {formatDate(bop.retrievedAt.slice(0, 10))}</p><a href={bop.sourceUrl} target="_blank" rel="noreferrer">Official data catalogue</a><a href={bop.datasetUrl} target="_blank" rel="noreferrer">Source CSV</a></div>
      <p className="deep-disclaimer">Balance-of-payments components are accounting flows, not a causal model of exchange-rate movements.</p>
    </>}
  </div></section>;
}


export default function BopView() { const { dashboard, loadHistory } = useDashboardData("bop"); const ref = dashboard?.deferred["bop-history"]; return <BalancePaymentsSection dashboard={dashboard} loadQuarters={ref ? async () => (await loadHistory(ref)).data.quarters : undefined} />; }
