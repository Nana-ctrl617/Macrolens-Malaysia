"use client";

import type { DashboardViewPayload } from "@/app/lib/dashboard-projection";

import { sectorColourTokens, chartColours, resolveChartColour } from "@/app/lib/chart-colours";
import { type EconomicSector } from "@/app/lib/dashboard";
import { useId, useRef, useState, useEffect, type PointerEvent as ReactPointerEvent, useMemo } from "react";
import { canvasContentWidth, chartFontSize, isChartInspectionKey, nextChartIndex, sectorShareObservations } from "@/app/lib/chart-inspection";
import { AccessibleCanvasChart } from "@/app/components/AccessibleCanvasChart";
import { PictureStrip } from "@/app/components/PictureStrip";
import { signedPercent, formatDate } from "@/app/lib/dashboard-format";
import { useDashboardData, type DashboardHistoryLoader } from "@/app/components/DashboardShell";
import { DeferredHistoryControl, useDeferredHistory } from "@/app/components/DeferredHistoryControl";

export const sectorColours = sectorColourTokens;

export const sectorCompositionNotes: Record<string, { title: string; short: string; includes: string[]; watch: string }> = {
  services: {
    title: "Services",
    short: "Activity where firms and institutions mainly provide services rather than physical goods.",
    includes: ["Wholesale and retail trade", "Food & beverages and accommodation", "Transport and storage", "Information and communication", "Finance, insurance, real estate and business services", "Government, education, health and other services"],
    watch: "This sector is often linked to household spending, tourism, wages, credit conditions and digital activity.",
  },
  manufacturing: {
    title: "Manufacturing",
    short: "Factory and processing activity that turns raw materials or components into finished or semi-finished goods.",
    includes: ["Electrical and electronics products", "Petroleum, chemical, rubber and plastic products", "Food, beverages and tobacco", "Transport equipment and machinery", "Wood, furniture, paper and printing", "Textiles, wearing apparel and other manufactured goods"],
    watch: "This sector is sensitive to export demand, semiconductor cycles, input costs, exchange rates and global supply chains.",
  },
  agriculture: {
    title: "Agriculture",
    short: "Farm, plantation, forestry and fishing-related production.",
    includes: ["Oil palm and rubber", "Livestock", "Fishing and aquaculture", "Forestry and logging", "Other crops"],
    watch: "Weather, commodity prices, labour supply and global food demand can matter.",
  },
  "mining-quarrying": {
    title: "Mining and quarrying",
    short: "Extraction of natural resources from land or offshore fields.",
    includes: ["Crude oil and condensate", "Natural gas", "Metal ores", "Stone, sand and quarry products"],
    watch: "Energy prices, production volumes and global commodity demand can move the current-price value strongly.",
  },
  construction: {
    title: "Construction",
    short: "Building and civil-engineering activity.",
    includes: ["Residential buildings", "Non-residential buildings", "Civil engineering and infrastructure", "Specialised construction work"],
    watch: "Interest rates, public infrastructure, property demand and material costs are important context.",
  },
  "import-duties": {
    title: "Import duties",
    short: "Taxes and duties on imported goods that are included when reconciling GDP at purchasers' prices.",
    includes: ["Customs duties", "Import-related taxes recorded in GDP reconciliation"],
    watch: "This is not an industry like services or manufacturing; it is a tax/reconciliation item.",
  },
};

export const growthEventNotes = [
  { year: 2015, title: "GST implementation", note: "Useful context when comparing nominal sector values because tax and price systems can affect current-price readings." },
  { year: 2018, title: "GST zero-rating and SST introduction", note: "A tax-system transition year; treat nominal changes around this period carefully." },
  { year: 2020, title: "Nationwide MCO / COVID shock", note: "A major activity shock. Sector changes around 2020 show timing, not proof of causation." },
  { year: 2022, title: "Reopening recovery", note: "Services, mobility-linked demand and external trade normalisation can make comparisons with 2020–2021 unusual." },
  { year: 2024, title: "Targeted diesel-subsidy implementation", note: "Relevant context for transport, business costs and current-price sector readings." },
];

export function formatRm(value: number) {
  return `RM ${value.toLocaleString("en-MY", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}bn`;
}

export function buildProductionCsv(year: number, sectors: EconomicSector[]) {
  const rows = [["year", "rank", "sector", "share_percent", "value_rm_bn", "nominal_change_percent", "share_of_annual_rm_change_percent"]];
  sectors.forEach((sector) => rows.push([
    String(year),
    String(sector.rank),
    sector.name,
    sector.share.toFixed(2),
    sector.value.toFixed(1),
    sector.changeYoY == null ? "" : sector.changeYoY.toFixed(2),
    sector.growthContribution == null ? "" : sector.growthContribution.toFixed(2),
  ]));
  return `data:text/csv;charset=utf-8,${encodeURIComponent(rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n"))}`;
}

export function buildDemandCsv(year: number, components: { id: string; name: string; share: number; value: number; changeYoY: number | null; signedContribution: number | null }[]) {
  const rows = [["year", "component", "share_percent", "value_rm_bn", "nominal_change_percent", "contribution_to_gdp_change_percent"]];
  components.forEach((component) => rows.push([
    String(year),
    component.name,
    component.share.toFixed(2),
    component.value.toFixed(1),
    component.changeYoY == null ? "" : component.changeYoY.toFixed(2),
    component.signedContribution == null ? "" : component.signedContribution.toFixed(2),
  ]));
  return `data:text/csv;charset=utf-8,${encodeURIComponent(rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n"))}`;
}

export function EconomicDonut({ sectors }: { sectors: EconomicSector[] }) {
  const id = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selected, setSelected] = useState<number | null>(0);
  const active = selected == null ? null : sectors[selected];
  const reading = active ? `${active.name}: ${active.share.toFixed(2)}% of nominal GDP, RM ${active.value.toFixed(1)} billion.` : "No sector selected.";
  useEffect(() => {
    const canvas = canvasRef.current, container = canvas?.parentElement;
    if (!canvas || !container) return;
    const draw = () => {
      const style = getComputedStyle(container), bodyStyle = getComputedStyle(document.body);
      const colours = chartColours(style);
      const size = Math.min(520, canvasContentWidth(container.clientWidth, parseFloat(style.paddingLeft) || 0, parseFloat(style.paddingRight) || 0));
      const font = chartFontSize(parseFloat(bodyStyle.fontSize)), ratio = window.devicePixelRatio || 1;
      canvas.width = size * ratio; canvas.height = size * ratio;
      canvas.style.width = `${size}px`; canvas.style.height = `${size}px`;
      const context = canvas.getContext("2d"); if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, size, size);
      const centre = size / 2, outer = size * .405, inner = size * .24;
      let angle = -Math.PI / 2;
      sectors.forEach((sector, index) => {
        const sweep = sector.share / 100 * Math.PI * 2;
        if (sweep > 0 && Number.isFinite(sweep)) {
          const gap = Math.min(.012, sweep / 4);
          context.beginPath(); context.arc(centre, centre, outer + (selected === index ? Math.min(7, size * .02) : 0), angle + gap, angle + sweep - gap);
          context.arc(centre, centre, inner, angle + sweep - gap, angle + gap, true); context.closePath();
          context.fillStyle = resolveChartColour(style, sectorColours[index % sectorColours.length]); context.fill();
          context.strokeStyle = colours.surface; context.lineWidth = 2; context.stroke();
        }
        angle += Number.isFinite(sweep) ? sweep : 0;
      });
      const displayed = selected == null ? null : sectors[selected];
      context.textAlign = "center"; context.fillStyle = colours.primary;
      context.font = `700 ${Math.max(font * 1.8, size * .085)}px ${bodyStyle.fontFamily}`;
      context.fillText(displayed ? `${displayed.share.toFixed(1)}%` : "—", centre, centre);
      // Sector names stay in resizable HTML below instead of being squeezed into raster text.
    };
    draw(); const observer = new ResizeObserver(draw); observer.observe(container); return () => observer.disconnect();
  }, [sectors, selected]);
  const selectFromPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left - bounds.width / 2, y = event.clientY - bounds.top - bounds.height / 2;
    const radius = Math.sqrt(x * x + y * y);
    if (radius < bounds.width * .20 || radius > bounds.width * .45) return;
    let angle = Math.atan2(y, x) + Math.PI / 2; if (angle < 0) angle += Math.PI * 2;
    let cumulative = 0;
    const index = sectors.findIndex((sector) => { cumulative += sector.share / 100 * Math.PI * 2; return angle <= cumulative; });
    if (index >= 0) setSelected(index);
  };
  return <div className="structure-chart" data-chart-kind="donut" role="group" aria-label="GDP sector shares">
    <canvas ref={canvasRef} role="img" tabIndex={0} aria-label="GDP sector pie chart; exact shares and values are available in the sector controls below."
      aria-describedby={`${id}-help ${id}-reading`} onPointerMove={selectFromPointer} onPointerDown={selectFromPointer}
      onFocus={() => setSelected((current) => current ?? (sectors.length ? 0 : null))}
      onKeyDown={(event) => { if (!isChartInspectionKey(event.key)) return; event.preventDefault(); setSelected((current) => nextChartIndex(event.key, current, sectors.length)); }} />
    <p id={`${id}-help`} className="chart-inspection-help">Hover or tap a slice, choose a sector below, or use arrow keys and Home/End. Escape clears the selection.</p>
    <p id={`${id}-reading`} className="chart-inspection-status" role="status" aria-live="polite" aria-atomic="true">{sectors.length ? reading : "No published sectors available."}</p>
    <div className="sector-legend" role="group" aria-label="GDP sector legend">{sectors.map((sector, index) => <button key={sector.id} className={selected === index ? "active" : ""} aria-pressed={selected === index}
      aria-label={`${sector.name}, ${sector.share.toFixed(2)} percent of GDP, RM ${sector.value.toFixed(1)} billion`} onFocus={() => setSelected(index)} onPointerMove={() => setSelected(index)} onClick={() => setSelected(index)}>
      <i aria-hidden="true" style={{ background: sectorColours[index % sectorColours.length] }} /><span>{sector.name}</span><b>{sector.share.toFixed(2)}%</b></button>)}</div>
  </div>;
}

export function SectorShareTrend({ years }: { years: Array<{ year: number; sectors: EconomicSector[] }> }) {
  const [activeId, setActiveId] = useState(years.at(-1)?.sectors[0]?.id ?? "");
  const sectorList = years.at(-1)?.sectors ?? [];
  const selected = sectorList.find((sector) => sector.id === activeId) ?? sectorList[0];
  const points = useMemo(() => sectorShareObservations(years, selected?.id ?? ""), [years, selected?.id]);
  if (!selected) return null;
  const firstShare = points[0]?.value, latestShare = points.at(-1)?.value;
  const shareLabel = (value: number | null | undefined) => value == null ? "Unavailable" : `${value.toFixed(1)}%`;
  return <article className="structure-trend-card">
    <div className="structure-subheading"><span>Share over time</span><h2>{selected.name}: {shareLabel(firstShare)} → {shareLabel(latestShare)}</h2><p>Shows one sector&apos;s share of nominal GDP across annual observations. Missing years remain gaps; their share is not assumed to be zero.</p></div>
    <div className="sector-chip-row" role="group" aria-label="Choose sector trend">{sectorList.map((sector, index) => <button key={sector.id} className={selected.id === sector.id ? "active" : ""} aria-pressed={selected.id === sector.id} onClick={() => setActiveId(sector.id)}><i style={{ background: sectorColours[index % sectorColours.length] }} />{sector.name}</button>)}</div>
    <AccessibleCanvasChart title={`${selected.name} share of Malaysian nominal GDP`} points={points}
      valueLabel={(value) => `${value.toFixed(2)}%`} axisLabel={(value) => `${value.toFixed(0)}%`}
      className="structure-line-chart" height={320} frequency="annual" minimumSpread={3}
      colour={sectorColours[Math.max(0, sectorList.findIndex((sector) => sector.id === selected.id)) % sectorColours.length]} />
  </article>;
}

export function GrowthContributionBars({ items, title, subtitle }: { items: Array<{ id: string; name: string; contribution: number | null; change: number | null }>; title: string; subtitle: string }) {
  const valid = items.filter((item) => item.contribution != null);
  const max = Math.max(...valid.map((item) => Math.abs(item.contribution ?? 0)), 1);
  return <article className="structure-contribution-card">
    <div className="structure-subheading"><span>Growth contribution</span><h2>{title}</h2><p>{subtitle}</p></div>
    <div className="contribution-bars">{items.map((item, index) => {
      const value = item.contribution;
      const width = value == null || value === 0 ? 0 : Math.max(3, Math.abs(value) / max * 100);
      return <div className="contribution-row" key={item.id}>
        <span>{item.name}</span>
        <div><i className={(value ?? 0) < 0 ? "negative" : "positive"} style={{ width: `${width}%`, background: sectorColours[index % sectorColours.length] }} /></div>
        <b>{value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`}</b>
        <small>{item.change == null ? "YoY n/a" : `${item.change > 0 ? "+" : ""}${item.change.toFixed(1)}% YoY`}</small>
      </div>;
    })}</div>
  </article>;
}

export function EconomicStructureSection({ dashboard, loadHistory }: { dashboard: DashboardViewPayload<"structure"> | null; loadHistory?: DashboardHistoryLoader }) {
  const history = useDeferredHistory(dashboard?.deferred?.["gdp-years"], loadHistory);
  const preview = dashboard?.economicStructure;
  const structure = history.data?.economicStructure ?? preview;
  const growth = history.data?.growthDrivers ?? dashboard?.growthDrivers;
  const sectorDeepDive = dashboard?.sectorDeepDive;
  const [year, setYear] = useState<number | null>(null);
  const [view, setView] = useState<"production" | "expenditure">("production");
  const selectedYear = structure?.years.find((item) => item.year === year) ?? structure?.years.at(-1);
  const selectedDemandYear = growth?.demand.years.find((item) => item.year === selectedYear?.year);
  const matchingEvents = growthEventNotes.filter((event) => selectedYear && Math.abs(event.year - selectedYear.year) <= 1);
  const demandAvailable = !!selectedDemandYear?.components.length;
  const productionCsv = selectedYear ? buildProductionCsv(selectedYear.year, selectedYear.sectors) : "#";
  const demandCsv = selectedDemandYear ? buildDemandCsv(selectedDemandYear.year, selectedDemandYear.components) : "#";
  const oneMinuteReading = selectedYear ? `${selectedYear.summary.largestSector} is the largest production sector at ${selectedYear.summary.largestShare.toFixed(1)}% of nominal GDP. ${selectedYear.summary.fastestGrowth == null ? "A prior-year growth comparison is not available for this selected year." : `${selectedYear.summary.fastestGrowingSector} shows the fastest current-price increase at ${selectedYear.summary.fastestGrowth > 0 ? "+" : ""}${selectedYear.summary.fastestGrowth.toFixed(1)}%.`} ${selectedDemandYear ? `On the spending side, the selected-year classification is ${selectedDemandYear.summary.demandType.toLowerCase()}, led by ${selectedDemandYear.summary.largestGrowthDriver}.` : "Expenditure-side detail is not available for this selected year."}` : "";
  useEffect(() => { if (structure && year == null) setYear(structure.latestYear); }, [structure, year]);
  return <section className="section structure-section page-section" id="structure"><div className="shell">
    <div className="section-heading"><div><span className="section-number">06 / Growth drivers</span><h1>What drives Malaysia&apos;s economic value?</h1></div><p>Choose a year to compare the production side of GDP with the expenditure side: consumption, investment, exports, imports and inventories.</p></div>
    <PictureStrip pictures={["city", "trade", "household"]} />
    {!structure || !selectedYear ? <div className="structure-empty">{dashboard ? "No validated data is available for this section in the current dataset." : "Loading validated data…"}</div> : <>
      <div className="growth-brief-card"><span>One-minute conclusion</span><p>{oneMinuteReading}</p><small>Current-price GDP is useful for economic value and sector size. It is not the same as real output growth after removing price effects.</small></div>
      {preview?.history && <DeferredHistoryControl complete={Boolean(history.data) || preview.history.complete} returnedRows={preview.history.returnedRows} totalRows={preview.history.totalRows} loading={history.loading} error={history.error} onLoad={history.load} label="Load earlier years and complete trend" />}
      <div className="structure-toolbar"><div><label htmlFor="structure-year">Calendar year</label><select id="structure-year" value={selectedYear.year} onChange={(event) => setYear(Number(event.target.value))}>{[...structure.years].reverse().map((item) => <option key={item.year} value={item.year}>{item.year}</option>)}</select></div><div className="driver-view-switch" role="group" aria-label="Choose GDP view"><button className={view === "production" ? "active" : ""} aria-pressed={view === "production"} onClick={() => setView("production")}>Production side</button><button className={view === "expenditure" ? "active" : ""} aria-pressed={view === "expenditure"} onClick={() => setView("expenditure")}>Expenditure side</button></div><p><span className={`structure-status ${growth?.status ?? structure.status}`}>{dashboard?.usingFallback ? "Bundled fallback" : (growth?.status ?? structure.status) === "fresh" ? "Official data refreshed" : "Using last validated data"}</span>Complete years only · latest {structure.latestYear}</p></div>
      {view === "production" && <div className="structure-overview">
        <EconomicDonut sectors={selectedYear.sectors} />
        <div className="structure-reading"><span className="mini-label">Production view · {selectedYear.year}</span><h2>RM {selectedYear.total.toLocaleString("en-MY", { maximumFractionDigits: 1 })} billion</h2><p className="structure-definition">Total GDP at purchasers&apos; prices. The six slices reconcile five production sectors plus import duties.</p><div className="structure-highlights"><article><span>Largest sector</span><strong>{selectedYear.summary.largestSector}</strong><small>{selectedYear.summary.largestShare.toFixed(1)}% of nominal GDP</small></article><article><span>Fastest current-price increase</span><strong>{selectedYear.summary.fastestGrowingSector}</strong><small>{selectedYear.summary.fastestGrowth == null ? "Prior-year comparison unavailable" : `${selectedYear.summary.fastestGrowth > 0 ? "+" : ""}${selectedYear.summary.fastestGrowth.toFixed(1)}% year on year`}</small></article><article><span>Largest RM addition</span><strong>{selectedYear.summary.largestGrowthContributor}</strong><small>{selectedYear.summary.largestContributionValue == null ? "Prior-year comparison unavailable" : `RM ${selectedYear.summary.largestContributionValue > 0 ? "+" : ""}${selectedYear.summary.largestContributionValue.toFixed(1)} billion`}</small></article></div></div>
      </div>}
      {view === "expenditure" && selectedDemandYear && <div className="demand-view"><div className="structure-reading"><span className="mini-label">Expenditure view · {selectedDemandYear.year}</span><h2>RM {selectedDemandYear.total.toLocaleString("en-MY", { maximumFractionDigits: 1 })} billion</h2><p className="structure-definition">Expenditure GDP adds consumption, investment and exports, deducts imports, and includes inventory changes and statistical adjustments.</p><div className="structure-highlights"><article><span>Largest component</span><strong>{selectedDemandYear.summary.largestComponent}</strong><small>{selectedDemandYear.summary.largestShare.toFixed(1)}% of GDP</small></article><article><span>Main annual driver</span><strong>{selectedDemandYear.summary.largestGrowthDriver}</strong><small>{selectedDemandYear.summary.largestContribution == null ? "Prior-year comparison unavailable" : `${selectedDemandYear.summary.largestContribution > 0 ? "+" : ""}${selectedDemandYear.summary.largestContribution.toFixed(1)}% of GDP change`}</small></article><article><span>Reading</span><strong>{selectedDemandYear.summary.demandType}</strong><small>Current-price expenditure screen</small></article></div></div></div>}
      <div className="structure-analysis"><span>What drove the year</span><p>{view === "production" ? selectedYear.narrative : selectedDemandYear?.narrative ?? "Expenditure-side GDP is not available for this selected year."}</p></div>
      <div className="growth-detail-grid">
        <SectorShareTrend years={structure.years} />
        <GrowthContributionBars
          title={view === "production" ? `Sector contribution · ${selectedYear.year}` : `Spending contribution · ${selectedDemandYear?.year ?? selectedYear.year}`}
          subtitle={view === "production" ? "Shows which sectors added the largest share of the annual nominal GDP change." : "Shows which expenditure components contributed most to the annual current-price GDP change."}
          items={view === "production" ? selectedYear.sectors.map((sector) => ({ id: sector.id, name: sector.name, contribution: sector.growthContribution, change: sector.changeYoY })) : (selectedDemandYear?.components ?? []).map((component) => ({ id: component.id, name: component.name, contribution: component.signedContribution, change: component.changeYoY }))}
        />
      </div>
      <div className="growth-method-grid">
        <article><span>Nominal vs real GDP</span><p>This page uses current-price GDP, so values reflect both output volume and price changes. For “real growth”, use constant-price GDP when that official series is added.</p></article>
        <article><span>Production vs expenditure</span><p>Production asks which industries create value. Expenditure asks who buys the output: households, government, investors or foreign buyers.</p></article>
        <article><span>How to read contribution</span><p>A high contribution means that sector or spending component explains a large share of the annual RM change. It is descriptive, not a causal estimate.</p></article>
      </div>
      {view === "production" ? <div className="structure-table-wrap"><table><thead><tr><th>Rank</th><th>Sector</th><th>Share</th><th>Value</th><th>Nominal change</th><th>Share of annual RM change</th></tr></thead><tbody>{selectedYear.sectors.map((sector, index) => <tr key={sector.id}><td>{sector.rank}</td><td><i style={{ background: sectorColours[index] }} /><strong>{sector.name}</strong></td><td>{sector.share.toFixed(2)}%</td><td>RM {sector.value.toLocaleString("en-MY", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}bn</td><td className={(sector.changeYoY ?? 0) < 0 ? "down" : "up"}>{sector.changeYoY == null ? "—" : `${sector.changeYoY > 0 ? "+" : ""}${sector.changeYoY.toFixed(2)}%`}</td><td>{sector.growthContribution == null ? "—" : `${sector.growthContribution > 0 ? "+" : ""}${sector.growthContribution.toFixed(1)}%`}</td></tr>)}</tbody></table></div> : <div className="structure-table-wrap"><table><thead><tr><th>Component</th><th>Share of GDP</th><th>Value</th><th>Nominal change</th><th>Contribution to GDP change</th></tr></thead><tbody>{(selectedDemandYear?.components ?? []).map((component) => <tr key={component.id}><td><strong>{component.name}</strong></td><td>{component.share.toFixed(2)}%</td><td>RM {component.value.toLocaleString("en-MY", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}bn</td><td className={(component.changeYoY ?? 0) < 0 ? "down" : "up"}>{component.changeYoY == null ? "—" : `${component.changeYoY > 0 ? "+" : ""}${component.changeYoY.toFixed(2)}%`}</td><td>{component.signedContribution == null ? "—" : `${component.signedContribution > 0 ? "+" : ""}${component.signedContribution.toFixed(1)}%`}</td></tr>)}</tbody></table></div>}
      <div className="growth-card-grid">{selectedYear.sectors.map((sector, index) => {
        const deep = sectorDeepDive?.year === selectedYear.year ? sectorDeepDive.sectors.find((item) => item.id === sector.id) : undefined;
        return <article key={sector.id} className="growth-sector-card">
          <span>{sector.name}</span>
          <div><strong>{sector.share.toFixed(1)}%</strong><b>{formatRm(sector.value)}</b></div>
          <p>{deep?.narrative ?? `${sector.name} accounts for ${sector.share.toFixed(1)}% of nominal GDP in ${selectedYear.year}.`}</p>
          <dl><div><dt>YoY change</dt><dd>{sector.changeYoY == null ? "—" : signedPercent(sector.changeYoY)}</dd></div><div><dt>Contribution</dt><dd>{sector.growthContribution == null ? "—" : `${sector.growthContribution.toFixed(1)}%`}</dd></div><div><dt>Watch</dt><dd>{deep?.exportLink ?? "Domestic demand and price effects"}</dd></div><div><dt>Market link</dt><dd>{deep?.marketLink ?? "Broad macro exposure"}</dd></div></dl>
          <i style={{ background: sectorColours[index % sectorColours.length] }} />
        </article>;
      })}</div>
      <div className="sector-composition-panel">
        <div className="structure-subheading"><span>What is inside each sector?</span><h2>Broad GDP sectors are groups of many activities</h2><p>These descriptions explain the usual production-side meaning of each category. The chart still uses the official aggregate sector totals above.</p></div>
        <div className="sector-composition-grid">{selectedYear.sectors.map((sector, index) => {
          const note = sectorCompositionNotes[sector.id] ?? { title: sector.name, short: "Official production-side GDP category.", includes: ["See the official dataset methodology for the detailed classification."], watch: "Interpret as a broad economic category." };
          return <article key={sector.id}>
            <i style={{ background: sectorColours[index % sectorColours.length] }} />
            <span>{note.title}</span>
            <p>{note.short}</p>
            <ul>{note.includes.map((item) => <li key={item}>{item}</li>)}</ul>
            <small>{note.watch}</small>
          </article>;
        })}</div>
      </div>
      <div className="growth-events-card"><div><span>Context near selected year</span><h2>{matchingEvents.length ? "Relevant historical markers" : "No nearby event marker in the catalogue"}</h2><p>Event notes provide context only. They do not prove that the event caused the GDP change.</p></div>{matchingEvents.length ? matchingEvents.map((event) => <article key={event.title}><time>{event.year}</time><strong>{event.title}</strong><p>{event.note}</p></article>) : <article><time>{selectedYear.year}</time><strong>Statistical reading only</strong><p>The page reports the official GDP structure without adding an unsupported explanation for this year.</p></article>}</div>
      <div className="growth-downloads"><a href={productionCsv} download={`macrolens-production-gdp-${selectedYear.year}.csv`}><span>CSV</span>Download selected production table</a>{demandAvailable && <a href={demandCsv} download={`macrolens-expenditure-gdp-${selectedDemandYear.year}.csv`}><span>CSV</span>Download selected expenditure table</a>}<a href={structure.datasetUrl} target="_blank" rel="noreferrer"><span>Source</span>Official production CSV</a>{growth?.demand.datasetUrl && <a href={growth.demand.datasetUrl} target="_blank" rel="noreferrer"><span>Source</span>Official expenditure CSV</a>}</div>
      <div className="structure-notes"><p><b>Important distinction.</b> {structure.note}</p><p>{structure.message} · Retrieved {formatDate(structure.retrievedAt.slice(0, 10))}</p><div><a href={structure.sourceUrl} target="_blank" rel="noreferrer">Official dataset and methodology ↗</a><a href={structure.datasetUrl} target="_blank" rel="noreferrer">Download source CSV ↗</a></div></div>
    </>}
  </div></section>;
}


export default function StructureView() { const { dashboard, loadHistory } = useDashboardData("structure"); return <EconomicStructureSection dashboard={dashboard} loadHistory={loadHistory} />; }
