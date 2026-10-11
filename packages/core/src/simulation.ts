import { makeConfig, withLiveKnobs, type WorldConfig } from "./config.js";
import { fnv1aArray, fnv1aWords, toHex } from "./hash.js";
import { Plants, type PlantSnapshot } from "./plants/plants.js";
import { Rng } from "./rng.js";
import { STATS_BIOMES, STATS_COLUMNS, StatsRecorder } from "./stats.js";
import { generateTerrain } from "./terrain/generate.js";
import type { TerrainData } from "./terrain/types.js";

/** The data the renderer needs each frame. Grows as features are added. */
export interface Snapshot {
  tick: number;
  time: number;
  width: number;
  height: number;
  plants: PlantSnapshot;
}

/** Ticks between stats rows at the start of a run. Coarsens as the run grows (see StatsRecorder). */
export const STATS_INTERVAL = 30;

/**
 * The simulation. Owns all world state and advances it one fixed tick at a time.
 * It never reads the clock or the DOM, so the browser worker and the CLI run
 * identical code and produce identical results.
 */
export class Simulation {
  /** Static terrain grid, generated once per world (docs/DESIGN.md §4.2). */
  readonly terrain: TerrainData;
  readonly plants: Plants;
  readonly stats: StatsRecorder;
  private currentConfig: WorldConfig;
  private readonly rng: Rng;
  private readonly plantRng: Rng;
  private readonly terrainHash: number;
  private tickCount = 0;

  constructor(config: Partial<WorldConfig> = {}) {
    this.currentConfig = makeConfig(config);
    this.rng = Rng.derive(this.config.seed, "simulation");
    this.terrain = generateTerrain(this.config);
    this.terrainHash = hashTerrain(this.terrain);
    this.plantRng = Rng.derive(this.config.seed, "plants");
    this.plants = new Plants(this.terrain, this.config, this.plantRng);
    this.plants.scatter(this.config.startingPlants);
    this.stats = new StatsRecorder(statsColumns(), STATS_INTERVAL);
    this.recordStats();
  }

  /** The config in use. Live knobs can change it while the world runs; see updateConfig. */
  get config(): WorldConfig {
    return this.currentConfig;
  }

  get tick(): number {
    return this.tickCount;
  }

  /** Simulated seconds elapsed. */
  get time(): number {
    return this.tickCount * this.config.dt;
  }

  /** Advances the world by exactly one tick. */
  step(): void {
    // Systems run here in the order defined in docs/DESIGN.md §13:
    // sense, think, move, attack, eat, reproduce, metabolize, die, environment, index, stats.
    this.tickCount++;
    // Environment. Plants keep their spatial index up to date as they sprout and die.
    this.plants.step(this.tickCount);
    if (this.stats.due(this.tickCount)) this.recordStats();
  }

  stepMany(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.step();
  }

  /**
   * Applies changes to live knobs at once. Changes to knobs that need a new
   * world are ignored. Returns the config now in use.
   */
  updateConfig(changes: Partial<WorldConfig>): WorldConfig {
    this.currentConfig = withLiveKnobs(this.currentConfig, changes);
    this.plants.configure(this.currentConfig);
    return this.currentConfig;
  }

  /**
   * Graze brush: grazes every plant within radius down to at most a share of
   * full energy, killing those left below the root reserve. Returns the energy taken.
   */
  graze(x: number, y: number, radius: number, leave: number): number {
    return this.plants.graze(x, y, radius, leave);
  }

  /** Plant brush: sows fully grown plants within radius. Returns the number planted. */
  sow(x: number, y: number, radius: number): number {
    return this.plants.sow(x, y, radius);
  }

  snapshot(): Snapshot {
    return {
      tick: this.tickCount,
      time: this.time,
      width: this.config.width,
      height: this.config.height,
      plants: this.plants.snapshot(),
    };
  }

  /**
   * A short fingerprint of the full world state. Two runs with the same seed and
   * config must produce the same hash at the same tick. Extend this as state grows.
   */
  stateHash(): string {
    const rngWords = [this.rng, this.plantRng].flatMap((rng) => {
      const { a, b, c, d } = rng.getState();
      return [a, b, c, d];
    });
    const hash = fnv1aWords([this.tickCount, ...rngWords, this.terrainHash]);
    return toHex(this.plants.hash(hash));
  }

  private recordStats(): void {
    const plants = this.plants.stats();
    this.stats.record([
      this.tickCount,
      plants.count,
      plants.energy,
      ...STATS_BIOMES.map((biome) => plants.countByBiome[biome]!),
      ...STATS_BIOMES.map((biome) => plants.energyByBiome[biome]!),
    ]);
  }
}

/** Stats columns, in the order recordStats writes them. */
function statsColumns(): string[] {
  return [
    STATS_COLUMNS.tick,
    STATS_COLUMNS.plants,
    STATS_COLUMNS.plantEnergy,
    ...STATS_BIOMES.map(STATS_COLUMNS.plantsIn),
    ...STATS_BIOMES.map(STATS_COLUMNS.plantEnergyIn),
  ];
}

/** Hash of every terrain field, computed once per world. */
function hashTerrain(terrain: TerrainData): number {
  const { sea, shallow, mountain, peak } = terrain.levels;
  const levelBits = new Float64Array([sea, shallow, mountain, peak, terrain.peakHeight, terrain.lowlandFlatness]);
  let hash = fnv1aWords([terrain.cols, terrain.rows, terrain.cellSize, terrain.width, terrain.height, terrain.landformSize]);
  hash = fnv1aArray(levelBits, hash);
  const { elevation, terrainType, temperature, distanceToWater, rainfall, biome } = terrain;
  for (const field of [elevation, terrainType, temperature, distanceToWater, rainfall, biome]) {
    hash = fnv1aArray(field, hash);
  }
  return hash;
}
