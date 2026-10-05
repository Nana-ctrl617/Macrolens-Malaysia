"use client";

import { createContext, Fragment, useContext, useEffect, useState, type ReactNode } from "react";
import { DashboardNavigation } from "./DashboardNavigation";
import { DashboardArtifactChangedError, loadDashboardHistory, loadDashboardView, retryDashboardView } from "@/app/lib/dashboard-view-client";
import type { DashboardView, DashboardViewPayload, DashboardHistoryPayload, DeferredHistory, HistoryId } from "@/app/lib/dashboard-projection";
import type { DashboardSection } from "@/app/lib/dashboard-ui-types";

export type DashboardHistoryLoader = <H extends HistoryId>(ref: DeferredHistory<H>) => Promise<DashboardHistoryPayload<H>>;
export type DashboardDataState<S extends DashboardView = DashboardView> = { dashboard: DashboardViewPayload<S> | null; loading: boolean; error: string; retry: () => void; refreshSummary: () => void; loadHistory: DashboardHistoryLoader };
export const DashboardDataContext = createContext<DashboardDataState | null>(null);
export function useDashboardData<S extends DashboardView>(section: S): DashboardDataState<S> {
  const value = useContext(DashboardDataContext);
  if (!value) throw new Error("Dashboard views must be rendered inside DashboardShell.");
  if (value.dashboard && value.dashboard.view !== section) throw new Error("The dashboard response belongs to a different view.");
  return value as DashboardDataState<S>;
}

export default function DashboardShell({ section, children }: { section: DashboardSection; children: ReactNode }) {
  const [dashboard, setDashboard] = useState<DashboardViewPayload | null>(null);
  const [dashboardError, setDashboardError] = useState("");
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardRefresh, setDashboardRefresh] = useState(0);
  useEffect(() => {
    if (section === "news") return;
    let active = true;
    setDashboardLoading(true); setDashboardError("");
    const request = dashboardRefresh ? retryDashboardView(section) : loadDashboardView(section);
    request.then(payload => { if (active) setDashboard(payload); })
      .catch(() => { if (active) setDashboardError("The dashboard could not be loaded. Retry to retrieve validated data; missing values are never replaced with estimates."); })
      .finally(() => { if (active) setDashboardLoading(false); });
    return () => { active = false; };
  }, [dashboardRefresh, section]);
  const retry = () => setDashboardRefresh(value => value + 1);
  const refreshSummary = () => { setDashboard(null); setDashboardRefresh(value => value + 1); };
  const loadHistory: DashboardHistoryLoader = async ref => {
    if (!dashboard || ref.view !== section || ref.artifactId !== dashboard.artifactId) throw new Error("Refresh the summary before loading this detail.");
    try { return await loadDashboardHistory(ref); }
    catch (error) { if (error instanceof DashboardArtifactChangedError) refreshSummary(); throw error; }
  };
  const initialDataUnavailable = section !== "news" && !dashboard && !dashboardLoading && Boolean(dashboardError);
  return <DashboardDataContext.Provider value={{ dashboard, loading: dashboardLoading, error: dashboardError, retry, refreshSummary, loadHistory }}>
    <div className="dashboard-app">
      <a className="skip-link" href="#top">Skip to main content</a>
      <DashboardNavigation active={section} />
      <main id="top" tabIndex={-1}>
      {section !== "news" && <div className="dashboard-load-status shell" role="status" aria-live="polite" aria-atomic="true">{dashboardLoading ? "Loading validated economic data…" : dashboardError ? "Data could not be loaded. Retry below." : dashboard?.usingFallback ? "Saved validated data loaded. The upstream artifact is unavailable; source periods and fallback labels remain visible." : "Validated data loaded. Check individual source periods and freshness labels."}</div>}
      {section !== "news" && dashboardError && <div className="dashboard-load-error shell" role="alert"><p>{dashboardError}</p><button type="button" onClick={retry}>Retry dashboard</button></div>}
      {section !== "news" && !dashboardLoading && !dashboardError && dashboard?.usingFallback && <div className="dashboard-load-status shell"><button type="button" onClick={retry}>Try latest data again</button></div>}
      {initialDataUnavailable ? <section className="section shell"><h1>Economic data is temporarily unavailable</h1><p>Use “Retry dashboard” above to try again. No figures, forecasts or source dates are estimated while the validated dataset is unavailable.</p></section> : <Fragment key={dashboard?.artifactId ?? "loading"}>{children}</Fragment>}
      <footer className="shell"><div className="brand"><img className="brand-logo" src="/macrolens-logo.png" alt="" width="30" height="30" /><span>MacroLens Malaysia</span></div><p>Educational analysis, not investment advice.</p><div><a href="https://data.gov.my/" target="_blank" rel="noreferrer">data.gov.my ↗</a><a href="https://apikijangportal.bnm.gov.my/" target="_blank" rel="noreferrer">BNM OpenAPI ↗</a></div></footer>
      </main>
    </div>
  </DashboardDataContext.Provider>;
}
