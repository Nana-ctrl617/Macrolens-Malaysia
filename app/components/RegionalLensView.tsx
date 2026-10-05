"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { RegionalLens, RegionalSourceMetadata } from "@/app/lib/dashboard";
import type { RegionalPreview, HistoryDataMap } from "@/app/lib/dashboard-projection";
import {
  buildRegionalRecords, formatRegionalPeriod, formatRegionalValue, parseRegionalComparison,
  regionalComparisonQuery, regionalMetrics, resolveRegionalComparison,
  regionalGdpSource,
} from "@/app/lib/regional-data";
import type { RegionalComparison, RegionalLevel, RegionalMetric, RegionalObservation, RegionalRecord } from "@/app/lib/regional-data";
import "./RegionalLensView.css";

type Props = { dashboard: { regionalLens?: RegionalLens | RegionalPreview; usingFallback?: boolean } | null; loading?: boolean; initialComparison?: Partial<RegionalComparison>; loadDistricts?: () => Promise<HistoryDataMap["regional-districts"]> };

function observedLabel(item: RegionalObservation | undefined) {
  return item ? formatRegionalPeriod(item.observationPeriod, item.cadence) : "not recorded";
}
function retrievalLabel(value: string | null | undefined) {
  if (!value) return "not recorded";
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date.toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "not recorded";
}
function SourceNote({ item }: { item: RegionalObservation }) {
  return <small className="regional-observation-note">{item.sourceUrl ? <a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.sourceLabel} ↗</a> : item.sourceLabel} · {observedLabel(item)} · {item.dataStatus}</small>;
}
function MetricCell({ record, metric }: { record: RegionalRecord; metric: string }) {
  const item = record.metrics[metric];
  const source = item ? `${item.sourceLabel}. Unit: ${item.unit}. Observation period: ${observedLabel(item)}. Status: ${item.dataStatus}. Retrieved: ${retrievalLabel(item.retrievedAt)}.` : "No supplied observation";
  return <td title={source}>{formatRegionalValue(item?.value, item?.unit ?? "")}<small className="regional-cell-period">{item?.value == null ? "No supplied observation" : <>{observedLabel(item)} · {item.sourceUrl ? <a href={item.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Official source for ${record.label}, ${regionalMetrics[metric as RegionalMetric]?.label ?? metric}, ${observedLabel(item)}: ${item.sourceLabel}`}>{item.dataStatus} ↗</a> : item.dataStatus}</>}</small></td>;
}

export default function RegionalLensView({ dashboard, loading = false, initialComparison, loadDistricts }: Props) {
  const id = useId();
  const suppliedRegional = dashboard?.regionalLens;
  const [districtData, setDistrictData] = useState<HistoryDataMap["regional-districts"] | null>(null);
  const [districtLoading, setDistrictLoading] = useState(false);
  const [districtError, setDistrictError] = useState("");
  const districtReady = !suppliedRegional || "districtRecords" in suppliedRegional || Boolean(districtData);
  const regional = useMemo<RegionalLens | undefined>(() => suppliedRegional ? "districtRecords" in suppliedRegional ? suppliedRegional : { ...suppliedRegional, districtRecords: districtData?.districtRecords ?? [], districtLabourRecords: districtData?.districtLabourRecords ?? [], districtGdpRecords: districtData?.districtGdpRecords ?? [] } : undefined, [suppliedRegional, districtData]);
  const [comparison, setComparison] = useState<Partial<RegionalComparison>>(initialComparison ?? {});
  const [locationReady, setLocationReady] = useState(false);
  const [expandedChart, setExpandedChart] = useState(false);
  const [inspectionKey, setInspectionKey] = useState("");
  useEffect(() => {
    if (!initialComparison) setComparison(parseRegionalComparison(window.location.search));
    setLocationReady(true);
  }, [initialComparison]);
  const selected = useMemo(() => resolveRegionalComparison(regional, comparison), [regional, comparison]);
  const requestDistricts = async () => {
    if (!loadDistricts || districtReady || districtLoading) return;
    setDistrictLoading(true); setDistrictError("");
    try { setDistrictData(await loadDistricts()); }
    catch (error) { setDistrictError(error instanceof Error ? error.message : "District observations could not be loaded. Please retry."); }
    finally { setDistrictLoading(false); }
  };
  useEffect(() => {
    if (locationReady && comparison.level === "district" && !districtReady && !districtLoading && !districtError) void requestDistricts();
  }, [locationReady, comparison.level, districtReady, districtLoading, districtError]);
  useEffect(() => {
    if (!locationReady || !regional || selected.level === "district" && !districtReady) return;
    const url = new URL(window.location.href);
    for (const [key, value] of new URLSearchParams(regionalComparisonQuery(selected))) url.searchParams.set(key, value);
    window.history.replaceState(window.history.state, "", url);
  }, [selected, locationReady, regional, districtReady]);

  const records = useMemo(() => buildRegionalRecords(regional, selected.level), [regional, selected.level]);
  const ranked = useMemo(() => [...records].sort((a, b) => {
    const first = a.metrics[selected.metric]?.value, second = b.metrics[selected.metric]?.value;
    return (typeof second === "number" ? second : -Infinity) - (typeof first === "number" ? first : -Infinity) || a.label.localeCompare(b.label);
  }), [records, selected.metric]);
  const chartRecords = ranked.filter((record) => typeof record.metrics[selected.metric]?.value === "number");
  const displayedChartRecords = selected.level === "district" && !expandedChart ? chartRecords.filter((record, index) => index < 20 || record.key === selected.primary || record.key === selected.secondary) : chartRecords;
  const primary = records.find((record) => record.key === selected.primary);
  const secondary = records.find((record) => record.key === selected.secondary);
  const metricInfo = regionalMetrics[selected.metric];
  const companionColumns: Array<{ metric: RegionalMetric; label: string }> = [
    { metric: "incomeMedian", label: "Median income" },
    { metric: "expenditureMean", label: "Mean expenditure" },
    { metric: "poverty", label: "Poverty" },
    { metric: "unemploymentRate", label: "Unemployment" },
    { metric: "realGdp", label: "Real GDP" },
  ];
  const tableColumns = [{ metric: selected.metric, label: metricInfo.label }, ...companionColumns.filter((column) => column.metric !== selected.metric)];
  const maxValue = Math.max(...chartRecords.map((record) => Math.abs(record.metrics[selected.metric].value as number)), 1);
  const signed = chartRecords.some((record) => (record.metrics[selected.metric].value as number) < 0);
  const periods = [...new Set(chartRecords.map((record) => observedLabel(record.metrics[selected.metric])))];
  const sources = regional?.sources ?? {};
  const groups = regional?.incomeGroups;
  const primaryGroups = groups?.stateGroups.find((record) => record.state === primary?.state);
  const secondaryGroups = groups?.stateGroups.find((record) => record.state === secondary?.state);
  const groupRows = (["b40", "m40", "t20"] as const).map((id) => ({
    id, label: groups?.nationalGroups.find((group) => group.id === id)?.label ?? id.toUpperCase(),
    primary: primaryGroups?.groups.find((group) => group.id === id),
    secondary: secondaryGroups?.groups.find((group) => group.id === id),
    national: groups?.nationalGroups.find((group) => group.id === id),
  })).filter((row) => row.primary || row.secondary || row.national);
  const groupMax = Math.max(...groupRows.flatMap((row) => [row.primary?.meanIncome ?? 0, row.secondary?.meanIncome ?? 0, row.national?.meanIncome ?? 0]), 1);
  const describeRecord = (record: RegionalRecord) => {
    const item = record.metrics[selected.metric];
    return `${record.label}. ${metricInfo.label}: ${formatRegionalValue(item.value, item.unit)}. Observation period: ${observedLabel(item)}. Source: ${item.sourceLabel}. Data status: ${item.dataStatus}. Retrieved: ${retrievalLabel(item.retrievedAt)}.${record.key === selected.primary || record.key === selected.secondary ? " Selected for comparison." : ""}`;
  };
  const incomeRows = groupRows.map((row) => ({ ...row, entries: [
    { label: primary?.label ?? "Main region", item: row.primary, period: primaryGroups?.date, tone: "primary" },
    { label: secondary?.label ?? "Comparison region", item: row.secondary, period: secondaryGroups?.date, tone: "secondary" },
    { label: "Malaysia", item: row.national, period: groups?.observationPeriod, tone: "national" },
  ].map((entry) => {
    const period = formatRegionalPeriod(entry.period, "annual");
    const ranking = entry.tone === "national" ? "National ranking" : "Within-state ranking";
    const source = groups?.source ?? "DOSM HIES income percentiles";
    const status = entry.item?.meanIncome == null ? "unavailable" : groups?.status ?? "unknown";
    return { ...entry, key: `income:${row.id}:${entry.tone}`, periodLabel: period, ranking, source, status,
      sourceUrl: entry.tone === "national" ? groups?.nationalDatasetUrl ?? groups?.sourceUrl : groups?.stateDatasetUrl ?? groups?.sourceUrl,
      description: `${entry.label}. ${row.label} mean income: ${formatRegionalValue(entry.item?.meanIncome, "RM per household per month")}. Official income percentiles ${entry.item?.percentileRange ?? "unavailable"}. Observation period: ${period}. ${ranking}. Source: ${source}. Data status: ${status}. Retrieved: ${retrievalLabel(groups?.retrievedAt)}. State groups are ranked within each state and are not identical income bands across places.` };
  }) }));
  const inspectedRecord = records.find((record) => inspectionKey === `region:${record.key}`);
  const inspectedIncome = incomeRows.flatMap((row) => row.entries).find((entry) => entry.key === inspectionKey);
  const inspectionDescription = inspectedRecord ? describeRecord(inspectedRecord) : inspectedIncome?.description ?? (primary ? describeRecord(primary) : loading ? "Loading official regional observations." : "No official regional observations are available.");
  const update = (patch: Partial<RegionalComparison>) => { setComparison({ ...selected, ...(selected.level === "district" && !districtReady ? comparison : {}), ...patch }); setExpandedChart(false); setInspectionKey(""); };
  const changeLevel = (level: RegionalLevel) => {
    if (level === "district" && !districtReady) {
      setComparison({ ...selected, level, primary: primary?.state, secondary: secondary?.state }); setExpandedChart(false); setInspectionKey("");
      void requestDistricts();
    } else update(resolveRegionalComparison(regional, { ...selected, level, primary: primary?.state, secondary: secondary?.state }));
  };

  const stateGdp = regional ? regionalGdpSource(regional, "state") : undefined;
  const districtGdp = regional ? regionalGdpSource(regional, "district") : undefined;
  const sourceCards: Array<{ label: string; name: string; source?: RegionalSourceMetadata; period?: string | null; cadence?: "annual" | "monthly"; url?: string; csv?: string; extraCsv?: string }> = [
    { label: "State household survey", name: "DOSM HIES — income, expenditure, poverty and Gini", source: sources.hiesState, period: sources.hiesState?.observationPeriod },
    { label: "District household survey", name: "DOSM district HIES", source: sources.hiesDistrict, period: sources.hiesDistrict?.observationPeriod },
    { label: "Unemployment and labour force", name: "DOSM district labour force (weighted state aggregates)", source: sources.labour, period: sources.labour?.observationPeriod },
    { label: "State real GDP", name: "DOSM real GDP supply-side by state", source: stateGdp, period: regional?.stateRecords.find((record) => record.gdpPeriod)?.gdpPeriod ?? stateGdp?.observationPeriod },
    { label: "District real GDP", name: "DOSM real GDP supply-side by district", source: districtGdp ? { ...districtGdp, sourceUrl: districtGdp.districtSourceUrl ?? "", datasetUrl: districtGdp.districtDatasetUrl ?? "" } : undefined, period: regional?.districtGdpRecords?.[0]?.date },
    { label: "State inflation", name: "DOSM state headline CPI inflation", source: sources.cpi, period: sources.cpi?.observationPeriod, cadence: "monthly" as const },
    ...(groups ? [{ label: "B40, M40 and T20 income", name: groups.source, source: groups, period: groups.observationPeriod, csv: groups.stateDatasetUrl, extraCsv: groups.nationalDatasetUrl }] : []),
    ...["nationalIncome", "nationalPoverty", "nationalInequality", "nationalExpenditure"].filter((key) => sources[key]).map((key) => ({ label: key.replace(/([A-Z])/g, " $1"), name: "DOSM national comparison benchmark", source: sources[key], period: sources[key].observationPeriod })),
  ].filter((card) => card.source || card.csv);

  return <section className="section deep-section regional-section page-section regional-accurate" id="regional"><div className="shell">
    <div className="section-heading"><div><span className="section-number">11 / Regional Lens</span><h1>How different are Malaysia&apos;s states and districts?</h1></div><p>Compare official income, expenditure, poverty, jobs, inflation and GDP observations. District values appear only where the supplied official records support them.</p></div>
    <p id={`${id}-inspection`} className="chart-live-description" role="status" aria-live="polite" aria-atomic="true">{inspectionDescription}</p>
    {!regional ? <div className="deep-empty" role="status">{loading ? "Loading official regional observations…" : "Regional observations are unavailable in this data version."}</div> : <>
      <div className="regional-meta"><div><span className={`risk-pill ${dashboard?.usingFallback ? "fallback" : regional.status}`}>{dashboard?.usingFallback ? "Fallback snapshot" : regional.status}</span><span>{metricInfo.label} · {selected.level === "district" ? "district" : "state / federal territory"} observations{periods.length ? ` · ${periods.join(", ")}` : " · unavailable"}</span></div><a href={`/regional${regionalComparisonQuery(selected)}`}>Bookmark this comparison ↗</a></div>
      <div className="regional-controls">
        <label><span>Geography</span><select value={selected.level} onChange={(event) => changeLevel(event.target.value as RegionalLevel)}><option value="state">State / federal territory</option><option value="district">District where available</option></select></label>
        <label><span>Main {selected.level === "district" ? "district" : "region"}</span><select disabled={selected.level === "district" && !districtReady} value={selected.primary} onChange={(event) => update({ primary: event.target.value })}>{records.map((record) => <option key={record.key} value={record.key}>{record.label}</option>)}</select></label>
        <label><span>Compare with</span><select disabled={selected.level === "district" && !districtReady} value={selected.secondary} onChange={(event) => update({ secondary: event.target.value })}>{records.map((record) => <option key={record.key} value={record.key}>{record.label}</option>)}</select></label>
        <label><span>Metric</span><select value={selected.metric} onChange={(event) => update({ metric: event.target.value as RegionalMetric })}>{Object.entries(regionalMetrics).map(([key, metric]) => <option key={key} value={key}>{metric.label}{selected.level === "district" && key === "headlineInflation" ? " (state only)" : ""}</option>)}</select></label>
        <div className="segmented small" role="group" aria-label="Regional comparison view"><button className={selected.view === "chart" ? "active" : ""} aria-pressed={selected.view === "chart"} onClick={() => update({ view: "chart" })}>Chart</button><button className={selected.view === "table" ? "active" : ""} aria-pressed={selected.view === "table"} onClick={() => update({ view: "table" })}>Table</button></div>
      </div>
      {selected.level === "district" && !districtReady && <div className="dashboard-load-status" role="status" aria-live="polite"><p>{districtLoading ? "Loading official district observations…" : districtError || "District observations have not been loaded."}</p>{!districtLoading && <button type="button" onClick={requestDistricts}>Retry district observations</button>}</div>}
      <div className="regional-comparison">
        {[{ record: primary, role: "Main region" }, { record: secondary, role: "Comparison region" }].map(({ record, role }) => record ? <article key={role}>
          <span>{record.label}</span><strong>{formatRegionalValue(record.metrics[selected.metric].value, metricInfo.unit)}</strong><p>{metricInfo.description}</p><SourceNote item={record.metrics[selected.metric]} /><small className="regional-observation-note">Retrieved {retrievalLabel(record.metrics[selected.metric].retrievedAt)}</small>
        </article> : <article key={role}><span>{role}</span><strong>Unavailable</strong><p>{selected.level === "district" && !districtReady ? "District observations have not been loaded." : "No official records at this geography level."}</p></article>)}
      </div>
      <p className="regional-chart-note">Income minus expenditure and the income-to-expenditure ratio are an aggregate contrast between median income and mean spending; they do not measure household savings.</p>
      {selected.level === "district" && selected.metric === "headlineInflation" ? <p className="regional-unavailable" role="status">No official district CPI is supplied. Switch to state / federal territory for inflation; no state figure is substituted here.</p> : null}
      {selected.view === "chart" ? <>
        {chartRecords.length ? <div className="regional-bars" role="list" aria-label={`${metricInfo.label} by ${selected.level}`}>
          {displayedChartRecords.map((record) => {
            const item = record.metrics[selected.metric];
            const value = item.value as number;
            return <div key={record.key} className={`regional-bar ${record.key === selected.primary || record.key === selected.secondary ? "selected" : ""}`} role="listitem" tabIndex={0} aria-label={describeRecord(record)} aria-current={inspectionKey === `region:${record.key}` ? "true" : undefined} data-inspected={inspectionKey === `region:${record.key}` || undefined} onFocus={() => setInspectionKey(`region:${record.key}`)} onPointerMove={(event) => { if (event.pointerType !== "touch") setInspectionKey(`region:${record.key}`); }} onPointerDown={() => setInspectionKey(`region:${record.key}`)} onClick={() => setInspectionKey(`region:${record.key}`)}>
              <span>{record.label}</span><div className={`regional-bar-track ${signed ? "signed" : ""}`} aria-hidden="true"><i className={value < 0 ? "negative" : ""} style={{ width: `${Math.abs(value) / maxValue * (signed ? 50 : 100)}%`, ...(signed ? value < 0 ? { right: "50%" } : { left: "50%" } : {}) }} /></div><b>{formatRegionalValue(value, item.unit)}</b>
              <em>{item.sourceLabel} · {observedLabel(item)} · {item.dataStatus} · retrieved {retrievalLabel(item.retrievedAt)}</em>
            </div>;
          })}
        </div> : <div className="deep-empty" role="status">{selected.level === "district" && !districtReady ? "District observations have not been loaded." : <>No official {selected.level} values are supplied for {metricInfo.label.toLowerCase()}.</>}</div>}
        {selected.level === "district" && chartRecords.length > 20 ? <div className="regional-chart-expander"><p>{expandedChart ? `All ${chartRecords.length} available districts.` : `Top 20 available values, plus selected districts (${displayedChartRecords.length} shown).`}</p><button className="regional-show-all" aria-expanded={expandedChart} onClick={() => setExpandedChart(!expandedChart)}>{expandedChart ? "Show fewer districts" : `Show all ${chartRecords.length} districts`}</button></div> : null}
      </> : <div className="table-wrap"><table className="data-table"><caption>{selected.level === "district" ? "District" : "State / federal territory"} comparison. Each value shows its own observation year or month; unavailable cells are not state proxies. Official source links accompany each available value.</caption><thead><tr><th scope="col">{selected.level === "district" ? "District, state" : "State"}</th>{tableColumns.map((column) => <th key={column.metric} scope="col">{column.label}</th>)}</tr></thead><tbody>{ranked.map((record) => <tr key={record.key} className={record.key === selected.primary || record.key === selected.secondary ? "regional-selected-row" : undefined}><th scope="row">{record.label}</th>{tableColumns.map((column) => <MetricCell key={column.metric} record={record} metric={column.metric} />)}</tr>)}</tbody></table></div>}
      <p className="regional-chart-note">{selected.level === "district" ? "District" : "State / federal territory"} comparison · {chartRecords.length} of {records.length} supplied geographies have this metric. {signed ? "Bars use a zero baseline; values left of zero are negative." : "Bar length starts at zero."} Focus, hover or tap a chart row to inspect its value and source note. Comparisons can combine different reference years; see the per-value period.</p>
      {selected.level === "state" && groupRows.length ? <div className="income-group-panel">
        <div className="income-group-heading"><div><span>Income distribution</span><h2>B40, M40 and T20 income comparison</h2><p>State B40, M40 and T20 are ranked within each state; Malaysia’s groups are ranked nationally. These are not identical income bands or the same households across places.</p></div><small>Survey year {formatRegionalPeriod(groups?.observationPeriod, "annual")}</small></div>
        <div className="income-group-grid">{incomeRows.map((row) => <article key={row.id}><span>{row.label}</span><div className="income-group-bars">
          {row.entries.map((entry) => <div key={entry.tone} className={`income-group-row ${entry.tone}`} role="group" tabIndex={0} aria-label={entry.description} aria-current={inspectionKey === entry.key ? "true" : undefined} data-inspected={inspectionKey === entry.key || undefined} onFocus={() => setInspectionKey(entry.key)} onPointerMove={(event) => { if (event.pointerType !== "touch") setInspectionKey(entry.key); }} onPointerDown={() => setInspectionKey(entry.key)} onClick={() => setInspectionKey(entry.key)}><b>{entry.label}</b>{entry.item?.meanIncome != null && <i aria-hidden="true" style={{ width: `${entry.item.meanIncome / groupMax * 100}%` }} />}<strong>{formatRegionalValue(entry.item?.meanIncome, "RM per household per month")}</strong><em>{!entry.item ? "No supplied group" : entry.tone === "national" ? "National benchmark" : entry.item.vsNationalMean == null ? "Difference unavailable" : `${formatRegionalValue(entry.item.vsNationalMean, "RM per household per month")} vs Malaysia ${row.label}; state-relative ranks`}</em><small className="regional-observation-note">Official income percentiles {entry.item?.percentileRange ?? "unavailable"} · {entry.periodLabel} · {entry.ranking} · {entry.sourceUrl ? <a href={entry.sourceUrl} target="_blank" rel="noreferrer">{entry.source} ↗</a> : entry.source} · {entry.status} · retrieved {retrievalLabel(groups?.retrievedAt)}</small></div>)}
        </div></article>)}</div>
        <p className="income-group-note">{groups?.note} {groups?.sourceUrl ? <a href={groups.sourceUrl} target="_blank" rel="noreferrer">Catalogue ↗</a> : null} {groups?.stateDatasetUrl ? <a href={groups.stateDatasetUrl} target="_blank" rel="noreferrer">State CSV ↗</a> : null} {groups?.nationalDatasetUrl ? <a href={groups.nationalDatasetUrl} target="_blank" rel="noreferrer">Malaysia CSV ↗</a> : null}</p>
      </div> : null}
      <div className="regional-lower-grid">
        <article className="deep-card"><span>District coverage</span><h2>Same geography, different availability</h2><p>{regional.narratives.district}</p><p>District income, labour and GDP are joined by both state and district names. An unavailable district value stays unavailable; state data is never used in its place.</p></article>
        <article className="deep-card"><span>National-only indicators</span><h2>Some signals should not be split by state.</h2><p>{regional.narratives.nationalOnly}</p><div className="badge-row">{regional.coverage.nationalOnly.map((item) => <span key={item}>{item}</span>)}</div></article>
        <article className="deep-card"><span>Sector mix</span><h2>{primary?.label ?? "Selected region"}: {primary?.metrics.largestSector.value ?? "GDP unavailable"}</h2><p>Official GDP composition describes economic structure, not a causal prediction of regional outcomes. Reference year {observedLabel(primary?.metrics.realGdp)}.</p><div className="mini-rank-list">{primary?.sectorShares.length ? primary.sectorShares.slice(0, 5).map((sector) => <div key={sector.id}><span>{sector.name}</span><b>{formatRegionalValue(sector.share, "%")}</b><small>{formatRegionalValue(sector.value, regionalMetrics.realGdp.unit)}</small></div>) : <p>No official sector shares are supplied for this region.</p>}</div>{primary ? <SourceNote item={primary.metrics.realGdp} /> : null}</article>
      </div>
      <details className="dashboard-details regional-context"><summary>Income and spending context — KL, Sarawak and the national benchmark</summary>
        <div className="regional-hero"><div><span>{regional.narratives.headline}</span><h2>Regional income and spending can tell different stories.</h2><p>{regional.narratives.comparison}</p><p>{regional.disclaimer}</p></div></div>
        <div className="regional-summary-grid">{regional.summaryCards.map((card) => <article key={card.label}><span>{card.label}</span><strong>{card.value}</strong><p>{card.detail}</p><small>Source: DOSM HIES · {formatRegionalPeriod(sources.hiesState?.observationPeriod, "annual")}</small></article>)}</div>
      </details>
      <details className="dashboard-details regional-sources"><summary>Data sources for assignment, downloads and coverage notes</summary>
        <div className="regional-source-panel" aria-label="Regional Lens data sources for assignment citation"><div><span>Data sources for assignment</span><h2>Official sources and per-metric reference periods</h2><p>Use the original data links for citation. A missing source status is reported as unknown; a source’s retrieval date is not its observation period.</p></div>
          <div className="regional-source-grid">{sourceCards.map((card) => <details key={card.label}><summary><span>{card.label}</span><b className={`risk-pill ${card.source?.status ?? "unknown"}`}>{card.source?.status ?? "unknown"}</b></summary><p>{card.name}</p><small>Observation period: {formatRegionalPeriod(card.period, card.cadence ?? "annual")} · Retrieved: {retrievalLabel(card.source?.retrievedAt)}</small><div>{(card.url ?? card.source?.sourceUrl) ? <a href={card.url ?? card.source?.sourceUrl} target="_blank" rel="noreferrer">Catalogue ↗</a> : null}{(card.csv ?? card.source?.datasetUrl) ? <a href={card.csv ?? card.source?.datasetUrl} target="_blank" rel="noreferrer">Source CSV ↗</a> : null}{card.extraCsv ? <a href={card.extraCsv} target="_blank" rel="noreferrer">Malaysia CSV ↗</a> : null}</div>{card.source?.message ? <p>{card.source.message}</p> : null}</details>)}</div>
          {sources.hiesState?.nationalExpenditure ? <p>Malaysia expenditure benchmark: <strong>{formatRegionalValue(sources.hiesState.nationalExpenditure.value, "RM per household per month")}</strong> per household per month · survey {formatRegionalPeriod(sources.hiesState.nationalExpenditure.observationPeriod, "annual")} · {sources.hiesState.nationalExpenditure.status}. <a href={sources.hiesState.nationalExpenditure.sourceUrl} target="_blank" rel="noreferrer">DOSM expenditure report{sources.hiesState.nationalExpenditure.page ? `, page ${sources.hiesState.nationalExpenditure.page}` : ""} ↗</a>. This official national value is not an average of state averages.</p> : null}
        </div>
        <div className="regional-downloads">{regional.downloads.map((item) => <a key={item.href} href={item.href}>{item.label} ↗</a>)}</div>
        <div className="regional-method"><span>Coverage note</span><p>{regional.coverage.state}</p><p>{regional.coverage.district}</p><p>The long-form CSV gives each metric its own unit, observation period, source URL, data status and retrieval time. Missing observations are omitted, not replaced with zero or state estimates.</p><p>For assignments, cite DOSM/data.gov.my alongside the dashboard CSV/JSON. MacroLens is a cleaned presentation layer, not the original publisher.</p></div>
      </details>
    </>}
  </div></section>;
}
