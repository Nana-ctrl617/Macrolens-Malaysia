"use client";

import { type InspectionPoint, type ChartFrequency, canvasContentWidth, chartFontSize, chartSegments, nearestChartIndex, isChartInspectionKey, nextChartIndex } from "@/app/lib/chart-inspection";
import { type StructuralCandidate } from "@/app/lib/dashboard";
import { useId, useRef, useState, useEffect, type PointerEvent as ReactPointerEvent } from "react";
import { formatObservationDate, pointEpoch } from "@/app/lib/visual-data";
import { chartColours, resolveChartColour } from "@/app/lib/chart-colours";
import { formatDate } from "@/app/lib/dashboard-format";

export type ChartInspectionProps = {
  points: InspectionPoint[];
  title: string;
  valueLabel: (value: number) => string;
  axisLabel?: (value: number) => string;
  className: string;
  frequency?: ChartFrequency;
  height?: number;
  colour?: string;
  dark?: boolean;
  fill?: boolean;
  includeZero?: boolean;
  minimumSpread?: number;
  candidates?: StructuralCandidate[];
};

export function AccessibleCanvasChart({
  points, title, valueLabel, axisLabel = valueLabel, className, frequency = "monthly",
  height: preferredHeight = 330, colour = "var(--series-headline)", dark = false, fill = false,
  includeZero = false, minimumSpread = 0.5, candidates = [],
}: ChartInspectionProps) {
  const id = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const geometry = useRef<number[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const pointLabel = (point: InspectionPoint) => point.label ?? formatObservationDate(point.date, frequency);
  const reading = selected == null || !points[selected] ? "No observation selected." : `${pointLabel(points[selected])}: ${points[selected].value == null || !Number.isFinite(points[selected].value) ? "Unavailable" : valueLabel(points[selected].value)}`;

  useEffect(() => { setSelected((current) => current == null || !points.length ? null : Math.min(current, points.length - 1)); }, [points.length]);
  useEffect(() => {
    const canvas = canvasRef.current, container = canvas?.parentElement;
    if (!canvas || !container) return;
    const draw = () => {
      const style = getComputedStyle(container), bodyStyle = getComputedStyle(document.body);
      const colours = chartColours(style, dark), seriesColour = resolveChartColour(style, colour);
      const width = canvasContentWidth(container.clientWidth, parseFloat(style.paddingLeft) || 0, parseFloat(style.paddingRight) || 0);
      const font = chartFontSize(parseFloat(bodyStyle.fontSize));
      const height = Math.max(preferredHeight, font * 13);
      const ratio = window.devicePixelRatio || 1;
      canvas.width = width * ratio; canvas.height = height * ratio;
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      const context = canvas.getContext("2d"); if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height);
      context.font = `500 ${font}px ${bodyStyle.fontFamily}`;
      const validValues = points.map((point) => point.value).filter((value): value is number => value != null && Number.isFinite(value));
      const times = points.map((point) => pointEpoch(point.date) ?? NaN);
      const validTimes = times.filter(Number.isFinite);
      if (!validValues.length || !validTimes.length) {
        geometry.current = [];
        context.fillStyle = colours.text;
        context.fillText("No published observations", 8, font * 2); return;
      }
      let min = Math.min(...validValues), max = Math.max(...validValues);
      if (includeZero) { min = Math.min(min, 0); max = Math.max(max, 0); }
      const spread = Math.max(max - min, minimumSpread);
      min -= spread * .14; max += spread * .14;
      const axisValues = Array.from({ length: 5 }, (_, index) => max - index / 4 * (max - min));
      const labelWidth = Math.max(...axisValues.map((value) => context.measureText(axisLabel(value)).width));
      const padding = { top: candidates.length ? font * 4 : font * 2, right: Math.min(24, width * .08), bottom: font * 3, left: Math.min(labelWidth + 12, width * .45) };
      const plotWidth = Math.max(1, width - padding.left - padding.right), plotHeight = Math.max(1, height - padding.top - padding.bottom);
      const firstTime = Math.min(...validTimes), lastTime = Math.max(...validTimes);
      const xTime = (time: number) => padding.left + (lastTime === firstTime ? .5 : (time - firstTime) / (lastTime - firstTime)) * plotWidth;
      const y = (value: number) => padding.top + (max - value) / (max - min) * plotHeight;
      geometry.current = times.map(xTime);
      const visibleBreaks = candidates.filter((candidate) => {
        const time = Date.parse(`${candidate.breakPeriod}T00:00:00Z`);
        return time >= firstTime && time <= lastTime;
      });
      const edges = [firstTime, ...visibleBreaks.map((candidate) => Date.parse(`${candidate.breakPeriod}T00:00:00Z`)), lastTime];
      edges.slice(0, -1).forEach((edge, index) => {
        if (!candidates.length) return;
        context.fillStyle = index % 2 ? "rgba(223,91,54,.045)" : "rgba(28,107,97,.035)";
        context.fillRect(xTime(edge), padding.top, xTime(edges[index + 1]) - xTime(edge), plotHeight);
      });
      axisValues.forEach((value) => {
        context.strokeStyle = colours.grid; context.lineWidth = 1;
        context.beginPath(); context.moveTo(padding.left, y(value)); context.lineTo(width - padding.right, y(value)); context.stroke();
        context.fillStyle = colours.text; context.fillText(axisLabel(value), 2, y(value) + font / 3);
      });
      if (includeZero) {
        context.strokeStyle = colours.zero; context.setLineDash([5, 5]);
        context.beginPath(); context.moveTo(padding.left, y(0)); context.lineTo(width - padding.right, y(0)); context.stroke(); context.setLineDash([]);
      }
      const segments = chartSegments(points, frequency);
      const traceSegment = (segment: number[]) => segment.forEach((index, order) => {
        const x = geometry.current[index], value = points[index].value!;
        if (!order) context.moveTo(x, y(value));
        else {
          if (frequency === "policy") context.lineTo(x, y(points[segment[order - 1]].value!));
          context.lineTo(x, y(value));
        }
      });
      segments.forEach((segment) => {
        if (fill && segment.length > 1) {
          const gradient = context.createLinearGradient(0, padding.top, 0, height - padding.bottom);
          gradient.addColorStop(0, colours.fill); gradient.addColorStop(1, "rgba(0,0,0,0)");
          context.beginPath();
          traceSegment(segment);
          context.lineTo(geometry.current[segment.at(-1)!], height - padding.bottom);
          context.lineTo(geometry.current[segment[0]], height - padding.bottom); context.closePath(); context.fillStyle = gradient; context.fill();
        }
        context.beginPath();
        traceSegment(segment);
        context.strokeStyle = seriesColour; context.lineWidth = 3; context.lineJoin = "round"; context.stroke();
        if (segment.length === 1) {
          const index = segment[0]; context.beginPath(); context.arc(geometry.current[index], y(points[index].value!), 4, 0, Math.PI * 2); context.fillStyle = seriesColour; context.fill();
        }
      });
      visibleBreaks.forEach((candidate, index) => {
        const x = xTime(Date.parse(`${candidate.breakPeriod}T00:00:00Z`));
        context.strokeStyle = candidate.status === "supported" ? colours.supported : candidate.status === "possible" ? colours.possible : colours.unsupported;
        context.setLineDash([6, 5]); context.lineWidth = 2; context.beginPath(); context.moveTo(x, padding.top); context.lineTo(x, height - padding.bottom); context.stroke(); context.setLineDash([]);
        context.fillStyle = context.strokeStyle;
        const label = formatDate(candidate.breakPeriod);
        context.fillText(label, Math.max(0, Math.min(x + 5, width - context.measureText(label).width)), font * (index % 2 ? 2.7 : 1.4));
        if (candidate.nearbyEvents.length) { context.beginPath(); context.arc(x, padding.top + 8, 4, 0, Math.PI * 2); context.fill(); }
      });
      const dateIndices = [...new Set([0, points.length - 1])];
      // Labels are staggered when space is narrow or text has been enlarged.
      dateIndices.forEach((index, order) => {
        const label = pointLabel(points[index]), labelSize = context.measureText(label).width;
        context.fillStyle = colours.text;
        const left = dateIndices.length === 1 ? (width - labelSize) / 2 : order ? width - labelSize - 2 : padding.left;
        context.fillText(label, Math.max(0, Math.min(left, width - labelSize)), height - font * (order ? .25 : 1.4));
      });
      const active = selected == null ? null : points[selected];
      if (active && active.value != null && Number.isFinite(active.value)) {
        const x = geometry.current[selected!];
        context.strokeStyle = colours.selection; context.lineWidth = 1.5; context.setLineDash([3, 4]);
        context.beginPath(); context.moveTo(x, padding.top); context.lineTo(x, height - padding.bottom); context.stroke(); context.setLineDash([]);
        context.beginPath(); context.arc(x, y(active.value), 5, 0, Math.PI * 2); context.fillStyle = seriesColour; context.fill(); context.lineWidth = 2; context.stroke();
      }
    };
    draw(); const observer = new ResizeObserver(draw); observer.observe(container);
    return () => observer.disconnect();
  }, [points, selected, candidates, valueLabel, axisLabel, colour, dark, fill, includeZero, minimumSpread, frequency, preferredHeight]);

  const selectPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => setSelected(nearestChartIndex(geometry.current, event.clientX - event.currentTarget.getBoundingClientRect().left));
  return <div className={className} role="group" aria-label={title}>
    <canvas ref={canvasRef} role="img" tabIndex={0} aria-label={`${title}. ${points.length} observations. Inspect exact values using the controls below.`}
      aria-describedby={`${id}-help ${id}-reading`} style={{ display: "block", maxWidth: "100%" }}
      onPointerMove={selectPointer} onPointerDown={selectPointer}
      onFocus={() => setSelected((current) => current ?? (points.length ? points.length - 1 : null))}
      onKeyDown={(event) => { if (!isChartInspectionKey(event.key)) return; event.preventDefault(); event.stopPropagation(); setSelected((current) => nextChartIndex(event.key, current, points.length)); }} />
    <p id={`${id}-help`} className="chart-inspection-help">Hover or tap the chart, use Left/Right arrows, Home/End, or the observation slider. Escape clears the selection. Gaps mean no published observation, not zero.</p>
    <p id={`${id}-reading`} className="chart-inspection-status" role="status" aria-live="polite" aria-atomic="true">{reading}</p>
    {points.length > 0 && <label className="chart-inspection-controls">Observation
      <input type="range" min={0} max={points.length - 1} value={selected ?? points.length - 1} aria-label={`${title} observation`} aria-valuetext={reading}
        onChange={(event) => setSelected(Number(event.currentTarget.value))} />
    </label>}
    {candidates.length > 0 && <div className="structural-legend"><span><i className="supported" />Supported</span><span><i className="possible" />Possible</span><span><b />Nearby official event</span></div>}
  </div>;
}


export default AccessibleCanvasChart;
