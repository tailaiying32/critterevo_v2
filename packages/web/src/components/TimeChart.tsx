import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

export interface ChartSeries {
  label: string;
  color: string;
  values: ArrayLike<number>;
}

interface TimeChartProps {
  title: string;
  /** Sim time of each row, in seconds. */
  x: ArrayLike<number>;
  series: ChartSeries[];
  /** Labels of series to hide. */
  hidden?: ReadonlySet<string>;
  /** Label of a series to bring forward, dimming the rest. */
  focused?: string | null;
  format: (value: number) => string;
  /** Charts with the same key share a crosshair. */
  syncKey: string;
}

const HEIGHT = 130;
/** Time axis steps in seconds, so ticks land on round seconds, minutes, and hours. */
const TIME_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 172800, 432000];
const AXIS_TEXT = "#8a949e";
const GRID = "#262c33";

/**
 * A line chart of values over sim time, drawn with uPlot. The plot is rebuilt
 * only when the set of series changes; new data is swapped in place, so it can
 * update many times a second.
 */
export function TimeChart({ title, x, series, hidden, focused = null, format, syncKey }: TimeChartProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  // The plot reads the latest props through this ref, so its hooks never go stale.
  const latest = useRef({ x, series, format });
  useEffect(() => {
    latest.current = { x, series, format };
  });
  const signature = series.map((s) => `${s.label}:${s.color}`).join("|");

  useEffect(() => {
    const host = hostRef.current;
    const tooltip = tooltipRef.current;
    if (!host || !tooltip) return;
    const { series: initial } = latest.current;
    const axis: uPlot.Axis = {
      stroke: AXIS_TEXT,
      grid: { stroke: GRID, width: 1 },
      ticks: { stroke: GRID, width: 1, size: 4 },
      font: "11px system-ui, sans-serif",
    };
    const plot = new uPlot(
      {
        width: Math.max(100, host.clientWidth),
        height: HEIGHT,
        legend: { show: false },
        focus: { alpha: 0.2 },
        cursor: { sync: { key: syncKey }, points: { show: false }, drag: { x: false, y: false } },
        scales: {
          x: { time: false, range: (_u, min, max) => [min, Math.max(max, min + 1)] },
          y: { range: (_u, _min, max) => [0, max > 0 ? max * 1.08 : 1] },
        },
        axes: [
          { ...axis, incrs: TIME_STEPS, values: (_u, splits) => splits.map(formatTime) },
          { ...axis, size: 48, values: (_u, splits) => splits.map((v) => latest.current.format(v)) },
        ],
        series: [{}, ...initial.map((s) => ({ label: s.label, stroke: s.color, width: 2, points: { show: false } }))],
        hooks: { setCursor: [(u) => showTooltip(u, host, tooltip, latest.current)] },
      },
      toData(latest.current),
      host,
    );
    plotRef.current = plot;
    const resize = new ResizeObserver(() => plot.setSize({ width: Math.max(100, host.clientWidth), height: HEIGHT }));
    resize.observe(host);
    return () => {
      resize.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
  }, [signature, syncKey]);

  useEffect(() => {
    plotRef.current?.setData(toData({ x, series }));
  }, [x, series]);

  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    series.forEach((s, i) => {
      const show = !hidden?.has(s.label);
      if (plot.series[i + 1]!.show !== show) plot.setSeries(i + 1, { show });
    });
    const index = series.findIndex((s) => s.label === focused);
    plot.setSeries(index >= 0 ? index + 1 : null, { focus: true });
  }, [hidden, focused, series, signature]);

  return (
    <figure className="time-chart">
      <figcaption>{title}</figcaption>
      <div ref={hostRef} className="time-chart-plot">
        <div ref={tooltipRef} className="chart-tooltip" />
      </div>
    </figure>
  );
}

function toData({ x, series }: { x: ArrayLike<number>; series: ChartSeries[] }): uPlot.AlignedData {
  return [x as number[], ...series.map((s) => s.values as number[])];
}

/** The crosshair's readout: the time, then every visible series' value, value first. */
function showTooltip(
  u: uPlot,
  host: HTMLElement,
  tooltip: HTMLElement,
  { x, series, format }: { x: ArrayLike<number>; series: ChartSeries[]; format: (value: number) => string },
): void {
  const idx = u.cursor.idx;
  if (idx == null || u.cursor.left == null || u.cursor.left < 0) {
    tooltip.style.display = "none";
    return;
  }
  tooltip.replaceChildren();
  const time = document.createElement("div");
  time.className = "chart-tooltip-time";
  time.textContent = formatTime(x[idx] ?? 0);
  tooltip.append(time);
  series.forEach((s, i) => {
    if (!u.series[i + 1]?.show) return;
    const row = document.createElement("div");
    row.className = "chart-tooltip-row";
    const key = document.createElement("span");
    key.className = "line-key";
    key.style.background = s.color;
    const value = document.createElement("strong");
    value.textContent = format(s.values[idx] ?? 0);
    const label = document.createElement("span");
    label.textContent = s.label;
    row.append(key, value, label);
    tooltip.append(row);
  });
  tooltip.style.display = "block";
  // Place it beside the crosshair, flipping to the left near the right edge.
  const over = u.over.getBoundingClientRect();
  const box = host.getBoundingClientRect();
  const left = over.left - box.left + u.cursor.left;
  const flip = left + 16 + tooltip.offsetWidth > box.width;
  tooltip.style.left = `${flip ? left - 12 - tooltip.offsetWidth : left + 12}px`;
  tooltip.style.top = `${over.top - box.top + 4}px`;
}

/** Sim time for axes and tooltips: seconds, then minutes, then hours. */
function formatTime(seconds: number): string {
  if (seconds < 120) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${+(seconds / 60).toFixed(1)} min`;
  if (seconds < 172800) return `${+(seconds / 3600).toFixed(1)} h`;
  return `${+(seconds / 86400).toFixed(1)} d`;
}
