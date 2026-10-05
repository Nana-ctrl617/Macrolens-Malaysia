"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { DashboardSection } from "@/app/page";

type NavigationItem = { id: DashboardSection; label: string; href: string };
type NavigationGroup = { label: string; items: NavigationItem[] };

export const dashboardNavigationGroups: NavigationGroup[] = [
  { label: "Overview", items: [
    { id: "snapshot", label: "Snapshot", href: "/" },
    { id: "brief", label: "Brief", href: "/brief" },
    { id: "news", label: "News", href: "/news" },
    { id: "risk", label: "Risk heatmap", href: "/risk" },
  ] },
  { label: "Prices / forecasts", items: [
    { id: "forecast", label: "Forecast", href: "/forecast" },
    { id: "drivers", label: "Drivers", href: "/drivers" },
  ] },
  { label: "Growth / trade", items: [
    { id: "structure", label: "Growth drivers", href: "/structure" },
    { id: "external", label: "External sector", href: "/external" },
    { id: "bop", label: "BOP", href: "/bop" },
    { id: "sectors", label: "Sectors", href: "/sectors" },
  ] },
  { label: "Households / regions", items: [
    { id: "household", label: "Households", href: "/household" },
    { id: "regional", label: "Regional Lens", href: "/regional" },
    { id: "decisions", label: "Decision guide", href: "/decisions" },
  ] },
  { label: "Markets / research", items: [
    { id: "bursa", label: "Bursa", href: "/bursa" },
    { id: "timeline", label: "Timeline", href: "/timeline" },
    { id: "structural", label: "Structural shifts", href: "/structural" },
    { id: "report", label: "Report", href: "/report" },
    { id: "health", label: "Data health", href: "/health" },
    { id: "methodology", label: "Methodology", href: "/methodology" },
  ] },
];

function ExternalLinkIcon() {
  return <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
    <path d="M7 5H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-2M10 3h7v7M17 3l-9 9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

export function DashboardNavigation({ active }: { active: DashboardSection }) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const currentGroup = dashboardNavigationGroups.find((group) => group.items.some((item) => item.id === active)) ?? dashboardNavigationGroups[0];
  const currentPage = currentGroup.items.find((item) => item.id === active) ?? currentGroup.items[0];

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return <div className="dashboard-navigation">
    <header className="dashboard-navigation-header">
      <a className="dashboard-navigation-brand" href="/" aria-label="MacroLens Malaysia home">
        <img src="/macrolens-logo.png" alt="" width="30" height="30" />
        <span>MacroLens Malaysia</span>
      </a>
      <div className="dashboard-navigation-current" aria-label={`Current page: ${currentPage.label}, ${currentGroup.label}`}>
        <strong>{currentPage.label}</strong>
        <span>{currentGroup.label}</span>
      </div>
      <a className="dashboard-navigation-source" href="https://data.gov.my/" target="_blank" rel="noreferrer" aria-label="Official sources">
        <span className="dashboard-navigation-source-full">Official sources</span><span className="dashboard-navigation-source-short" aria-hidden="true">Sources</span><ExternalLinkIcon />
      </a>
    </header>
    <button
      ref={toggleRef}
      className="dashboard-navigation-toggle"
      type="button"
      aria-expanded={open}
      aria-controls={panelId}
      aria-label={`Sections. Current page: ${currentPage.label}. Group: ${currentGroup.label}`}
      onClick={() => setOpen((value) => !value)}
    >
      <span className="dashboard-navigation-toggle-label">Sections</span>
      <span className="dashboard-navigation-toggle-current"><strong>{currentPage.label}</strong><span>{currentGroup.label}</span></span>
      <svg viewBox="0 0 20 20" width="20" height="20" fill="none" aria-hidden="true"><path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    <nav id={panelId} className="dashboard-navigation-panel" aria-label="Primary navigation" data-open={open}>
      {dashboardNavigationGroups.map((group, groupIndex) => <section className="dashboard-navigation-group" key={group.label} aria-labelledby={`${panelId}-group-${groupIndex}`}>
        <h2 id={`${panelId}-group-${groupIndex}`}>{group.label}</h2>
        <ul>{group.items.map((item) => <li key={item.id}>
          <a aria-current={active === item.id ? "page" : undefined} href={item.href} onClick={() => setOpen(false)}>{item.label}</a>
        </li>)}</ul>
      </section>)}
    </nav>
  </div>;
}
