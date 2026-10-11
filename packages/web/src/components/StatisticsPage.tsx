import { Biome, BIOME_NAMES, STATS_BIOMES, STATS_COLUMNS, type TerrainData } from "@critter-evo/core";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { SimClient, StatsHistory } from "../sim/SimClient";
import { TimeChart, type ChartSeries } from "./TimeChart";

type Mode = "total" | "biome";

/** Line color for totals. */
const TOTAL_COLOR = "#7cc47f";
/**
 * Line color for each biome: the dataviz reference categorical palette's dark
 * steps, in slot order. Checked with its validator against the panel surface
 * (#161a1f): every adjacent pair clears ΔE 8 under color vision deficiency and
 * ΔE 15 with normal vision, and every color has 3:1 contrast.
 */
const BIOME_LINE_COLORS: Record<(typeof STATS_BIOMES)[number], string> = {
  [Biome.Tundra]: "#3987e5",
  [Biome.Taiga]: "#d95926",
  [Biome.Grassland]: "#199e70",
  [Biome.TemperateForest]: "#c98500",
  [Biome.TemperateRainforest]: "#d55181",
  [Biome.Desert]: "#008300",
  [Biome.Savanna]: "#9085e9",
  [Biome.Rainforest]: "#e66767",
};
/** How often the charts redraw while stats stream in. */
const REFRESH_MS = 250;
const CHART_HEIGHT = 220;

interface Chart {
  title: string;
  series: ChartSeries[];
  format: (value: number) => string;
}

/**
 * Charts of the run over time (docs/DESIGN.md §15), on their own page. The
 * world keeps running underneath, so it can be played and paused from here.
 */
export function StatisticsPage({ client }: { client: SimClient }) {
  return (
    <div className="stats-page">
      <header className="settings-header">
        <div className="settings-title">
          <h1>Statistics</h1>
          <RunStatus client={client} />
        </div>
      </header>
      <PlantCharts client={client} />
    </div>
  );
}

/** Play and pause, with the current tick and sim time. */
function RunStatus({ client }: { client: SimClient }) {
  const { running, snapshot } = useSyncExternalStore(client.subscribe, client.getStatus);
  return (
    <div className="run-status">
      <button onClick={() => (running ? client.pause() : client.play())}>{running ? "Pause" : "Play"}</button>
      <span>
        Tick {snapshot?.tick.toLocaleString() ?? "–"} · {snapshot ? formatSimTime(snapshot.time) : "–"}
      </span>
    </div>
  );
}

/**
 * Plant count and energy over time, for the whole world or per biome. Per
 * biome, both are shown per area of that biome's land, so sparse and dense
 * biomes share one scale.
 */
function PlantCharts({ client }: { client: SimClient }) {
  const [mode, setMode] = useState<Mode>("total");
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const rows = useStatsRows(client, REFRESH_MS);
  const terrain = useSyncExternalStore(client.subscribe, () => client.getStatus().terrain);
  const dt = useSyncExternalStore(client.subscribe, () => client.getStatus().activeConfig?.dt ?? 1);

  const x = useMemo(() => rows.column(STATS_COLUMNS.tick).map((tick) => tick * dt), [rows, dt]);
  const charts = useMemo(() => (terrain ? buildCharts(rows, terrain, mode) : []), [rows, terrain, mode]);
  const legend = mode === "biome" ? (charts[0]?.series ?? []) : [];

  return (
    <section className="settings-card stats-section">
      <header className="stats-section-header">
        <h2>Plants</h2>
        <div className="segmented" role="radiogroup" aria-label="Breakdown">
          {(["total", "biome"] as const).map((m) => (
            <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? "active" : ""} onClick={() => setMode(m)}>
              {m === "total" ? "Total" : "By biome"}
            </button>
          ))}
        </div>
      </header>
      {legend.length > 0 && (
        <ul className="chart-legend" onMouseLeave={() => setFocused(null)}>
          {legend.map((s) => (
            <li key={s.label}>
              <button
                className={hidden.has(s.label) ? "off" : ""}
                aria-pressed={!hidden.has(s.label)}
                title={`${hidden.has(s.label) ? "Show" : "Hide"} ${s.label.toLowerCase()}`}
                onMouseEnter={() => setFocused(hidden.has(s.label) ? null : s.label)}
                onClick={() => setHidden(toggled(hidden, s.label))}
              >
                <span className="line-key" style={{ background: s.color }} />
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="stats-charts">
        {charts.map((chart) => (
          <TimeChart
            key={chart.title}
            title={chart.title}
            x={x}
            series={chart.series}
            hidden={hidden}
            focused={focused}
            format={chart.format}
            height={CHART_HEIGHT}
            syncKey="plants"
          />
        ))}
      </div>
    </section>
  );
}

function buildCharts(rows: StatsHistory, terrain: TerrainData, mode: Mode): Chart[] {
  if (mode === "total") {
    return [
      { title: "Plants", format: formatCompact, series: [{ label: "Plants", color: TOTAL_COLOR, values: rows.column(STATS_COLUMNS.plants) }] },
      {
        title: "Plant energy",
        format: formatCompact,
        series: [{ label: "Plant energy", color: TOTAL_COLOR, values: rows.column(STATS_COLUMNS.plantEnergy) }],
      },
    ];
  }
  // Land area of each biome, in units of 100 by 100.
  const cells = new Float64Array(BIOME_NAMES.length);
  for (const biome of terrain.biome) cells[biome]!++;
  const patches = (biome: Biome) => (cells[biome]! * terrain.cellSize * terrain.cellSize) / 10000;
  const present = STATS_BIOMES.filter((biome) => cells[biome]! > 0);
  const perArea = (column: (biome: Biome) => string) =>
    present.map((biome) => ({
      label: BIOME_NAMES[biome]!,
      color: BIOME_LINE_COLORS[biome],
      values: rows.column(column(biome)).map((v) => v / patches(biome)),
    }));
  return [
    { title: "Plants per 100 × 100 u", format: formatDensity, series: perArea(STATS_COLUMNS.plantsIn) },
    { title: "Plant energy per 100 × 100 u", format: formatCompact, series: perArea(STATS_COLUMNS.plantEnergyIn) },
  ];
}

/**
 * A copy of the stats history, refreshed at most every intervalMs while rows
 * stream in, so the charts redraw a few times a second rather than every frame.
 */
function useStatsRows(client: SimClient, intervalMs: number): StatsHistory {
  const [rows, setRows] = useState(() => client.stats.copy());
  useEffect(() => {
    let seen = client.getStatus().statsVersion;
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      timer = undefined;
      last = performance.now();
      setRows(client.stats.copy());
    };
    const unsubscribe = client.subscribe(() => {
      const version = client.getStatus().statsVersion;
      if (version === seen) return;
      seen = version;
      if (timer !== undefined) return;
      const wait = intervalMs - (performance.now() - last);
      if (wait <= 0) refresh();
      else timer = setTimeout(refresh, wait);
    });
    return () => {
      unsubscribe();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [client, intervalMs]);
  return rows;
}

function toggled(set: ReadonlySet<string>, item: string): Set<string> {
  const next = new Set(set);
  if (!next.delete(item)) next.add(item);
  return next;
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumSignificantDigits: 3 });

function formatCompact(value: number): string {
  return compact.format(value);
}

function formatSimTime(seconds: number): string {
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} min`;
  return `${(seconds / 3600).toFixed(2)} h`;
}

function formatDensity(value: number): string {
  return Number.isInteger(value) || value >= 10 ? value.toFixed(0) : value.toFixed(1);
}
