import { makeConfig, withLiveKnobs, type WorldConfig } from "./config.js";
import type { ControllerKind } from "./critters/controllers.js";
import { Critters, type CritterInfo, type CritterSnapshot, type CritterTraits } from "./critters/critters.js";
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
  critters: CritterSnapshot;
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
  readonly critters: Critters;
  readonly stats: StatsRecorder;
  private currentConfig: WorldConfig;
  private readonly rng: Rng;
  private readonly plantRng: Rng;
  private readonly critterRng: Rng;
  private readonly wanderRng: Rng;
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
    this.critterRng = Rng.derive(this.config.seed, "critters");
    this.wanderRng = Rng.derive(this.config.seed, "wander");
    this.critters = new Critters(this.terrain, this.config, this.critterRng, this.wanderRng);
    this.critters.scatter(this.config.startingCritters);
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
    // Critters keep their spatial index up to date as they move.
    this.tickCount++;
    this.critters.think();
    this.critters.move();
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
    this.critters.configure(this.currentConfig);
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

  /**
   * Spawn tool: adds a critter at a point with chosen traits, if its body fits
   * there. Returns its id, or -1 if it didn't fit.
   */
  spawnCritter(x: number, y: number, traits: CritterTraits, controller: ControllerKind): number {
    const slot = this.critters.spawn(x, y, traits, controller);
    return slot >= 0 ? this.critters.id[slot]! : -1;
  }

  /** Removes the critter with an id. Returns whether it was there. */
  removeCritter(id: number): boolean {
    const slot = this.critters.slotOf(id);
    if (slot >= 0) this.critters.remove(slot);
    return slot >= 0;
  }

  /** Changes what drives the critter with an id. */
  setController(id: number, controller: ControllerKind): void {
    const slot = this.critters.slotOf(id);
    if (slot >= 0) this.critters.setController(slot, controller);
  }

  /** Keyboard controller: sets the outputs of every critter driven by keyboard. */
  drive(turn: number, thrust: number): void {
    this.critters.keyboard.set(turn, thrust);
  }

  /** Id of the critter whose body is nearest a point, within tolerance of its edge, or -1. */
  critterAt(x: number, y: number, tolerance: number): number {
    const slot = this.critters.slotAt(x, y, tolerance);
    return slot >= 0 ? this.critters.id[slot]! : -1;
  }

  /** Everything the inspector shows about the critter with an id, or null if there is none. */
  critterInfo(id: number): CritterInfo | null {
    const slot = this.critters.slotOf(id);
    return slot >= 0 ? this.critters.info(slot) : null;
  }

  snapshot(): Snapshot {
    return {
      tick: this.tickCount,
      time: this.time,
      width: this.config.width,
      height: this.config.height,
      plants: this.plants.snapshot(),
      critters: this.critters.snapshot(),
    };
  }

  /**
   * A short fingerprint of the full world state. Two runs with the same seed and
   * config must produce the same hash at the same tick. Extend this as state grows.
   */
  stateHash(): string {
    const rngWords = [this.rng, this.plantRng, this.critterRng, this.wanderRng].flatMap((rng) => {
      const { a, b, c, d } = rng.getState();
      return [a, b, c, d];
    });
    const hash = fnv1aWords([this.tickCount, ...rngWords, this.terrainHash]);
    return toHex(this.critters.hash(this.plants.hash(hash)));
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
  const { elevation, terrainType, temperature, distanceToWater, rainfall, biome, slopeX, slopeY } = terrain;
  for (const field of [elevation, terrainType, temperature, distanceToWater, rainfall, biome, slopeX, slopeY]) {
    hash = fnv1aArray(field, hash);
  }
  return hash;
}
