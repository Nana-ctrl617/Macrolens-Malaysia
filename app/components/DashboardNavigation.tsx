"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type { DashboardSection } from "@/app/lib/dashboard-ui-types";

type NavigationItem = { id: DashboardSection; label: string; href: string; keywords: string };
type NavigationGroup = { label: string; items: NavigationItem[] };

export const dashboardNavigationGroups: NavigationGroup[] = [
  { label: "Overview", items: [
    { id: "snapshot", label: "Snapshot", href: "/", keywords: "overview latest indicators summary inflation prices cpi jobs employment labour wages gdp markets" },
    { id: "brief", label: "Brief", href: "/brief", keywords: "monthly report changes explanation latest economy inflation prices jobs wages" },
    { id: "news", label: "News", href: "/news", keywords: "headlines current affairs economy inflation jobs employment labour wages ringgit trade markets" },
    { id: "risk", label: "Risk heatmap", href: "/risk", keywords: "pressure score warning exposure risk inflation jobs markets" },
  ] },
  { label: "Prices and outlook", items: [
    { id: "forecast", label: "Forecast", href: "/forecast", keywords: "inflation prediction future estimate prices cpi" },
    { id: "drivers", label: "Inflation drivers", href: "/drivers", keywords: "prices cpi inflation causes factors" },
  ] },
  { label: "Growth and trade", items: [
    { id: "structure", label: "Growth drivers", href: "/structure", keywords: "gdp composition services manufacturing sector demand" },
    { id: "external", label: "External sector", href: "/external", keywords: "exchange rate exports imports trade balance ringgit" },
    { id: "bop", label: "Balance of payments", href: "/bop", keywords: "bop current account capital financial account" },
    { id: "sectors", label: "Industry mix", href: "/sectors", keywords: "sectors industry manufacturing services agriculture" },
  ] },
  { label: "People and places", items: [
    { id: "household", label: "Households", href: "/household", keywords: "income spending cost living jobs employment labour wages salary savings" },
    { id: "regional", label: "Regional Lens", href: "/regional", keywords: "states districts location salary wages jobs employment labour income cost living cpi inflation" },
    { id: "decisions", label: "Decision guide", href: "/decisions", keywords: "personal company household actions jobs employment labour wages salary career" },
  ] },
  { label: "Markets / research", items: [
    { id: "bursa", label: "Bursa", href: "/bursa", keywords: "stock exchange klci shares equities" },
    { id: "timeline", label: "Timeline", href: "/timeline", keywords: "history events malaysia" },
    { id: "structural", label: "Structural shifts", href: "/structural", keywords: "breakpoint chow test stability" },
    { id: "report", label: "Report", href: "/report", keywords: "download csv json export" },
    { id: "health", label: "Data health", href: "/health", keywords: "source freshness quality missing data" },
    { id: "methodology", label: "Methodology", href: "/methodology", keywords: "methods definitions sources" },
  ] },
];

const searchSynonyms: Record<string, string[]> = {
  job: ["job", "jobs", "employment", "unemployment", "labour", "labor", "wage", "wages", "salary", "salaries", "career", "careers"],
  jobs: ["job", "jobs", "employment", "unemployment", "labour", "labor", "wage", "wages", "salary", "salaries", "career", "careers"],
  employment: ["job", "jobs", "employment", "unemployment", "labour", "labor", "wage", "wages", "salary", "salaries", "career", "careers"],
  inflation: ["inflation", "cpi", "price", "prices", "cost of living"],
  cpi: ["inflation", "cpi", "price", "prices", "cost of living"],
  price: ["inflation", "cpi", "price", "prices", "cost of living"],
  prices: ["inflation", "cpi", "price", "prices", "cost of living"],
};
const ignoredSearchWords = new Set(["a", "an", "and", "for", "in", "of", "the", "to"]);

function matchesNavigationSearch(group: NavigationGroup, item: NavigationItem, query: string) {
  const text = `${group.label} ${item.label} ${item.keywords}`.toLocaleLowerCase();
  const terms = query.split(/\s+/).filter((term) => term && !ignoredSearchWords.has(term));
  return terms.length > 0 && terms.every((term) => (searchSynonyms[term] ?? [term]).some((variant) => text.includes(variant)));
}

function ExternalLinkIcon() {
  return <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
    <path d="M7 5H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-2M10 3h7v7M17 3l-9 9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

export function DashboardNavigation({ active }: { active: DashboardSection }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const toggleRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const currentGroup = dashboardNavigationGroups.find((group) => group.items.some((item) => item.id === active)) ?? dashboardNavigationGroups[0];
  const currentPage = currentGroup.items.find((item) => item.id === active) ?? currentGroup.items[0];
  const normalizedQuery = query.normalize("NFKC").trim().toLocaleLowerCase();
  const visibleGroups = dashboardNavigationGroups.map((group) => ({
    ...group,
    items: group.items.filter((item) => !normalizedQuery || matchesNavigationSearch(group, item, normalizedQuery)),
  })).filter((group) => group.items.length > 0);
  const visibleCount = visibleGroups.reduce((count, group) => count + group.items.length, 0);

  useEffect(() => {
    if (!open) return;
    const focusFrame = requestAnimationFrame(() => searchRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => { cancelAnimationFrame(focusFrame); document.removeEventListener("keydown", handleKeyDown); };
  }, [open]);

  return <div className="dashboard-navigation">
    <header className="dashboard-navigation-header">
      <Link className="dashboard-navigation-brand" href="/" aria-label="MacroLens Malaysia home">
        <Image src="/macrolens-logo.png" alt="" width={30} height={30} priority unoptimized />
        <span>MacroLens Malaysia</span>
      </Link>
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
      <label className="dashboard-navigation-search-label" htmlFor={`${panelId}-search`}>Find a page</label>
      <input ref={searchRef} id={`${panelId}-search`} className="dashboard-navigation-search" type="search" aria-label="Find a page" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Inflation, jobs, trade…" autoComplete="off" />
      {normalizedQuery && <p className="dashboard-navigation-search-count" role="status" aria-live="polite">{visibleCount ? `${visibleCount} ${visibleCount === 1 ? "page" : "pages"} found` : "No pages match that search. Try a page name or topic such as inflation, jobs, trade or markets."}</p>}
      {visibleGroups.map((group) => <details className="dashboard-navigation-group" key={group.label} open={Boolean(normalizedQuery) || group.label === currentGroup.label}>
        <summary><span>{group.label}</span><svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true"><path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg></summary>
        <ul>{group.items.map((item) => <li key={item.id}>
          <Link aria-current={active === item.id ? "page" : undefined} href={item.href} onClick={() => setOpen(false)}>{item.label}</Link>
        </li>)}</ul>
      </details>)}
    </nav>
  </div>;
}
