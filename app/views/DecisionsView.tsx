"use client";

import type { DashboardViewPayload } from "@/app/lib/dashboard-projection";

import { type DecisionCard } from "@/app/lib/dashboard";
import { useState } from "react";
import { PictureStrip } from "@/app/components/PictureStrip";
import { healthStatusLabel, formatDate } from "@/app/lib/dashboard-format";
import { InputHealthNotice } from "@/app/components/InputHealthNotice";
import { useDashboardData } from "@/app/components/DashboardShell";

export function DecisionCardView({ card }: { card: DecisionCard }) {
  return <article className="decision-card">
    <div className="decision-card-top"><span>{card.theme}</span><b>{card.stance}</b></div>
    <h2>{card.title}</h2>
    <p className="decision-evidence">{card.evidence}</p>
    <div className="decision-actions"><span>Practical considerations</span><ul>{card.actions.map((action) => <li key={action}>{action}</li>)}</ul></div>
    <p className="decision-watch"><b>Important limit</b>{card.watch}</p>
  </article>;
}

export function DecisionGuideSection({ dashboard }: { dashboard: DashboardViewPayload<"decisions"> | null }) {
  const [audience, setAudience] = useState<"individuals" | "companies">("individuals");
  const guide = dashboard?.decisionGuide;
  const cards = guide?.audiences[audience] ?? [];
  return <section className="section decision-section page-section" id="decisions"><div className="shell">
    <div className="section-heading"><div><span className="section-number">09 / Decision guide</span><h1>What the signals may mean for decisions</h1></div><p>Translate the latest Malaysian economic readings into questions and safeguards. These are conditional scenarios—not instructions to buy, sell, borrow, hire or change jobs.</p></div>
    <PictureStrip pictures={["household", "markets", "research"]} />
    {!guide ? <div className="decision-empty">{dashboard ? "No validated data is available for this section in the current dataset." : "Loading validated data…"}</div> : <>
      <div className="decision-summary"><div><span>Current economic frame</span><p>{guide.summary}</p></div><em className={dashboard?.inputHealth?.decisionGuide?.status ?? guide.status}>{healthStatusLabel(dashboard?.usingFallback ? "fallback" : dashboard?.inputHealth?.decisionGuide?.status ?? guide.status)}</em></div>
      <InputHealthNotice health={dashboard?.inputHealth?.decisionGuide} />
      <div className="decision-signals" aria-label="Economic signals used in the decision guide">{guide.signals.map((signal) => <article key={signal.label}><span>{signal.label}</span><strong>{signal.value}</strong><p>{signal.reading}</p><small>{formatDate(signal.period)}</small></article>)}</div>
      <div className="audience-switch" role="group" aria-label="Choose decision-guide audience"><button className={audience === "individuals" ? "active" : ""} aria-pressed={audience === "individuals"} onClick={() => setAudience("individuals")}>For individuals</button><button className={audience === "companies" ? "active" : ""} aria-pressed={audience === "companies"} onClick={() => setAudience("companies")}>For companies</button></div>
      <div className="decision-grid">{cards.map((card) => <DecisionCardView key={card.id} card={card} />)}</div>
      <div className="decision-framework"><div><span>How to use this page</span><ol><li>Start with the evidence shown on each card.</li><li>Compare it with your own cash flow, commitments and time horizon.</li><li>Stress-test what happens if the signal moves against you.</li><li>Use a licensed professional for decisions with material consequences.</li></ol></div><div><span>Official learning resources</span>{guide.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.name} ↗</a>)}</div></div>
      <p className="decision-disclaimer">{guide.disclaimer}</p>
    </>}
  </div></section>;
}


export default function DecisionsView() { const { dashboard } = useDashboardData("decisions"); return <DecisionGuideSection dashboard={dashboard} />; }
