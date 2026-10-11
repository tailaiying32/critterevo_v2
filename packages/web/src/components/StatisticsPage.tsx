import { Biome, BIOME_NAMES, COST_TERM_NAMES, DeathCause, DEATH_CAUSE_NAMES, STATS_BIOMES, STATS_COLUMNS, type TerrainData } from "@critter-evo/core";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { SimClient, StatsHistory } from "../sim/SimClient";
import { COST_TERM_COLORS, EATEN_COLOR, SERIES_COLORS, shownCostTerms, SPENT_COLOR } from "./seriesColors";
import { ChartLegend, TimeChart, type ChartSeries } from "./TimeChart";

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
/** Deaths by cause in legend order, each with the next series slot. Thirst first, since it is usually the most. */
const DEATH_SERIES = [DeathCause.Dehydration, DeathCause.Starvation, DeathCause.OldAge, DeathCause.Injury].map((cause, k) => ({
  cause,
  color: SERIES_COLORS[k]!,
}));
/** Living critters, and corpses beside them: a validated pair. */
const CRITTER_COLOR = SERIES_COLORS[0];
const CORPSE_COLOR = SERIES_COLORS[7];
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
      <CritterCharts client={client} />
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
      {legend.length > 0 && <ChartLegend series={legend} hidden={hidden} onHiddenChange={setHidden} onFocus={setFocused} />}
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
            syncKey="stats"
          />
        ))}
      </div>
    </section>
  );
}

/**
 * Critter population, deaths by cause, where their energy comes from and goes,
 * and the energy held in living critters and in corpses.
 */
function CritterCharts({ client }: { client: SimClient }) {
  const rows = useStatsRows(client, REFRESH_MS);
  const dt = useSyncExternalStore(client.subscribe, () => client.getStatus().activeConfig?.dt ?? 1);
  const x = useMemo(() => rows.column(STATS_COLUMNS.tick).map((tick) => tick * dt), [rows, dt]);
  const charts = useMemo(() => buildCritterCharts(rows, x), [rows, x]);
  return (
    <section className="settings-card stats-section">
      <header className="stats-section-header">
        <h2>Critters</h2>
      </header>
      <div className="stats-charts">
        {charts.map((chart) => (
          <TimeChart
            key={chart.title}
            title={chart.title}
            x={x}
            series={chart.series}
            format={chart.format}
            height={CHART_HEIGHT}
            syncKey="stats"
            legend
          />
        ))}
      </div>
    </section>
  );
}

function buildCritterCharts(rows: StatsHistory, x: number[]): Chart[] {
  if (rows.column(STATS_COLUMNS.critters).length === 0) return [];
  const spent = Array.from(COST_TERM_NAMES, (_, term) => rateOf(rows.column(STATS_COLUMNS.spentOn(term)), x));
  const peaks = spent.map((values) => values.reduce((a, b) => Math.max(a, b), 0));
  const totalSpent = x.map((_, k) => spent.reduce((sum, values) => sum + values[k]!, 0));
  return [
    {
      title: "Critters",
      format: formatCompact,
      series: [{ label: "Critters", color: CRITTER_COLOR, values: rows.column(STATS_COLUMNS.critters) }],
    },
    {
      title: "Deaths so far, by cause",
      format: formatCompact,
      series: DEATH_SERIES.map(({ cause, color }) => ({ label: DEATH_CAUSE_NAMES[cause]!, color, values: rows.column(STATS_COLUMNS.deathsBy(cause)) })),
    },
    {
      title: "Energy eaten and spent per second, all critters",
      format: formatCompact,
      series: [
        { label: "Eaten", color: EATEN_COLOR, values: rateOf(rows.column(STATS_COLUMNS.eaten), x) },
        { label: "Spent", color: SPENT_COLOR, values: totalSpent },
      ],
    },
    {
      title: "Energy spent per second, by cost",
      format: formatCompact,
      series: shownCostTerms(peaks).map((term) => ({ label: COST_TERM_NAMES[term]!, color: COST_TERM_COLORS[term], values: spent[term]! })),
    },
    {
      title: "Energy held",
      format: formatCompact,
      series: [
        { label: "In critters", color: CRITTER_COLOR, values: rows.column(STATS_COLUMNS.critterEnergy) },
        { label: "In corpses", color: CORPSE_COLOR, values: rows.column(STATS_COLUMNS.corpseEnergy) },
      ],
    },
  ];
}

/**
 * Average rate per second between each row and the one before, from a running
 * total. Exact even after rows are thinned out. The first row copies the second.
 */
function rateOf(total: number[], x: number[]): number[] {
  const rate = total.map((value, k) => (k > 0 && x[k]! > x[k - 1]! ? (value - total[k - 1]!) / (x[k]! - x[k - 1]!) : 0));
  if (rate.length > 1) rate[0] = rate[1]!;
  return rate;
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
