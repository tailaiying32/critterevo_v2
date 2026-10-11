import { Biome } from "./terrain/biomes.js";

/** Biomes that plants grow in, in the order their stats columns appear. */
export const STATS_BIOMES = [
  Biome.Tundra,
  Biome.Taiga,
  Biome.Grassland,
  Biome.TemperateForest,
  Biome.TemperateRainforest,
  Biome.Desert,
  Biome.Savanna,
  Biome.Rainforest,
] as const;

/** Short names of the energy cost terms, indexed by CostTerm, for their stats columns. */
export const STATS_COST_TERMS: readonly string[] = ["basal", "brain", "senses", "traits", "movement", "terrain", "thermal"];

/** Short names of the death causes, indexed by DeathCause, for their stats columns. */
export const STATS_DEATH_CAUSES: readonly string[] = ["starvation", "dehydration", "injury", "oldAge"];

/**
 * Column names of the recorded stats (docs/DESIGN.md §15). Grows as features
 * are added. Energy eaten, energy spent, and deaths are running totals since
 * the start of the run, so they stay exact when rows are thinned out; the
 * difference between two rows is what happened in between.
 */
export const STATS_COLUMNS = {
  tick: "tick",
  plants: "plants",
  plantEnergy: "plantEnergy",
  plantsIn: (biome: Biome) => `plants.${biome}`,
  plantEnergyIn: (biome: Biome) => `plantEnergy.${biome}`,
  critters: "critters",
  critterEnergy: "critterEnergy",
  corpses: "corpses",
  corpseEnergy: "corpseEnergy",
  eaten: "eaten",
  spentOn: (term: number) => `spent.${STATS_COST_TERMS[term]}`,
  deathsBy: (cause: number) => `deaths.${STATS_DEATH_CAUSES[cause]}`,
} as const;

/** Rows from some point on, one array per column. */
export interface StatsRows {
  /** Changes whenever older rows are thinned out, so earlier rows must be fetched again. */
  epoch: number;
  /** Index of the first row. */
  start: number;
  /** Ticks between rows. */
  interval: number;
  columns: readonly string[];
  data: Float64Array[];
}

/**
 * Stats recorded every `interval` ticks, stored by column. When full, every
 * other row is dropped and the interval doubles, so a long run keeps its whole
 * history at a coarser resolution in bounded memory. Rows are always at ticks
 * that are multiples of the interval, starting from tick 0.
 */
export class StatsRecorder {
  readonly columns: readonly string[];
  interval: number;
  epoch = 0;
  private readonly data: Float64Array[];
  private size = 0;

  constructor(columns: readonly string[], interval: number, readonly capacity = 2048) {
    if (capacity < 2 || capacity % 2 !== 0) throw new Error("StatsRecorder capacity must be even");
    this.columns = columns;
    this.interval = interval;
    this.data = columns.map(() => new Float64Array(capacity));
  }

  get length(): number {
    return this.size;
  }

  /** True if a row is due at this tick. */
  due(tick: number): boolean {
    return tick % this.interval === 0;
  }

  /** Appends a row, one value per column. */
  record(values: ArrayLike<number>): void {
    if (this.size === this.capacity) this.thin();
    for (let c = 0; c < this.columns.length; c++) this.data[c]![this.size] = values[c]!;
    this.size++;
  }

  /** Copies of the rows from start on. */
  rows(start = 0): StatsRows {
    const from = Math.min(start, this.size);
    return {
      epoch: this.epoch,
      start: from,
      interval: this.interval,
      columns: this.columns,
      data: this.data.map((column) => column.slice(from, this.size)),
    };
  }

  /** One column's values so far. */
  column(name: string): Float64Array {
    const c = this.columns.indexOf(name);
    if (c < 0) throw new Error(`Unknown stats column "${name}"`);
    return this.data[c]!.slice(0, this.size);
  }

  /** Keeps every other row and doubles the interval. */
  private thin(): void {
    for (const column of this.data) {
      for (let k = 0; k < this.size / 2; k++) column[k] = column[2 * k]!;
    }
    this.size /= 2;
    this.interval *= 2;
    this.epoch++;
  }
}
