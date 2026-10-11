import type { WorldConfig } from "../config.js";
import { fnv1aArray, fnv1aWords } from "../hash.js";
import type { KnobKey } from "../knobs.js";
import type { Rng } from "../rng.js";
import { SpatialHash } from "../spatial.js";
import { Biome, BIOME_NAMES } from "../terrain/biomes.js";
import { cellIndexAt } from "../terrain/lookup.js";
import type { TerrainData } from "../terrain/types.js";

/** Productivity at which the plant density and regrowth time knobs apply exactly: rainforest, in g/m²/yr. */
export const REFERENCE_PRODUCTIVITY = 2200;

/** The productivity knob of each biome. */
export const PRODUCTIVITY_KNOBS: Record<Exclude<Biome, typeof Biome.None>, KnobKey> = {
  [Biome.Tundra]: "productivityTundra",
  [Biome.Taiga]: "productivityTaiga",
  [Biome.Grassland]: "productivityGrassland",
  [Biome.TemperateForest]: "productivityTemperateForest",
  [Biome.TemperateRainforest]: "productivityTemperateRainforest",
  [Biome.Desert]: "productivityDesert",
  [Biome.Savanna]: "productivitySavanna",
  [Biome.Rainforest]: "productivityRainforest",
};

/** ln(81): logistic growth at rate r takes ln(81) / r to go from 10% to 90% of full. */
const LOGISTIC_10_TO_90 = 4.394449154672439;

/** Each plant grows, ages, and seeds once every this many ticks (see Plants.step). */
export const PLANT_UPDATE_STRIDE = 10;

const BIOME_COUNT = BIOME_NAMES.length;
const INITIAL_CAPACITY = 1024;

/** Plants as the renderer needs them, packed into typed arrays that can be transferred. */
export interface PlantSnapshot {
  count: number;
  x: Float32Array;
  y: Float32Array;
  /** Energy as a share of full energy, 0 to 255. */
  energy: Uint8Array;
}

export interface PlantStats {
  count: number;
  energy: number;
  /** Plants in each biome, indexed by Biome. */
  countByBiome: Float64Array;
  /** Plant energy in each biome, indexed by Biome. */
  energyByBiome: Float64Array;
}

/**
 * The plant layer (docs/DESIGN.md §5.1). Plants are fixed in place, stored as
 * a struct of arrays indexed by slot. Slots of dead plants are reused, newest
 * first, so iteration in slot order is deterministic.
 *
 * Each tick, every plant ages, regrows logistically toward full energy at its
 * biome's rate, and, once mature, may drop a seed nearby. A few seeds also land
 * at random anywhere (long-distance dispersal). A seed takes root only on land,
 * and only where the ground isn't already as crowded as its biome allows.
 * A plant grazed below its root reserve dies.
 */
export class Plants {
  /** Living plants. */
  count = 0;
  /** Slots in use: every living plant has a slot below this. */
  slots = 0;
  x = new Float32Array(INITIAL_CAPACITY);
  y = new Float32Array(INITIAL_CAPACITY);
  energy = new Float64Array(INITIAL_CAPACITY);
  /** Seconds lived. Frozen while plant lifespan is off. */
  age = new Float64Array(INITIAL_CAPACITY);
  /** Age in seconds at which each plant dies, drawn when it sprouts. */
  lifespan = new Float32Array(INITIAL_CAPACITY);
  biome = new Uint8Array(INITIAL_CAPACITY);
  alive = new Uint8Array(INITIAL_CAPACITY);
  /** Living plants by position. */
  readonly index: SpatialHash;

  private config: WorldConfig;
  private readonly free: number[] = [];
  /** Logistic growth rate per second in each biome. */
  private readonly growth = new Float64Array(BIOME_COUNT);
  /** Most plants within the crowding radius of a seed for it to take root, in each biome. */
  private readonly capacity = new Float64Array(BIOME_COUNT);
  /** Seed landing spots gathered during a tick, as x, y pairs. */
  private readonly seeds: number[] = [];
  private offsetX = 0;
  private offsetY = 0;

  constructor(
    private readonly terrain: TerrainData,
    config: WorldConfig,
    private readonly rng: Rng,
  ) {
    this.index = new SpatialHash(terrain.width, terrain.height);
    this.config = config;
    this.configure(config);
  }

  /**
   * Applies a new config. Called when live knobs change. Density and regrowth
   * both scale with the square root of a biome's productivity, so their
   * product, the plant energy produced per area, follows productivity.
   */
  configure(config: WorldConfig): void {
    this.config = config;
    const rate = LOGISTIC_10_TO_90 / config.regrowthTime;
    const r = config.crowdingRadius;
    const perArea = config.plantDensity / 10000;
    for (const [biome, knob] of Object.entries(PRODUCTIVITY_KNOBS)) {
      const scale = Math.sqrt((config[knob] as number) / REFERENCE_PRODUCTIVITY);
      this.growth[Number(biome)] = rate * scale;
      this.capacity[Number(biome)] = perArea * Math.PI * r * r * scale;
    }
  }

  /** Most plants within the crowding radius for a seed to take root in a biome. */
  capacityIn(biome: Biome): number {
    return this.capacity[biome]!;
  }

  /** Logistic growth rate per second in a biome. */
  growthRateIn(biome: Biome): number {
    return this.growth[biome]!;
  }

  /**
   * Scatters fully grown plants at random over the land, each at a random point
   * in its life so they don't all die at once. Makes a few attempts per plant,
   * since points on water or crowded ground fail.
   */
  scatter(count: number): number {
    const { width, height } = this.terrain;
    let placed = 0;
    for (let attempt = 0; attempt < count * 4 && placed < count; attempt++) {
      const slot = this.place(this.rng.range(0, width), this.rng.range(0, height), 1);
      if (slot < 0) continue;
      this.age[slot] = this.rng.next() * this.lifespan[slot]!;
      placed++;
    }
    return placed;
  }

  /**
   * Advances the plants by one tick. Plants change slowly, so each plant is
   * updated every PLANT_UPDATE_STRIDE ticks, by that many ticks' worth: a
   * different share of the slots each tick, so the work is spread evenly.
   * Long-distance seeds land every tick.
   */
  step(tick: number): void {
    const { config, rng, x, y, energy, age, lifespan, biome, alive, growth } = this;
    const dt = config.dt * PLANT_UPDATE_STRIDE;
    const full = config.plantEnergy;
    const aging = config.plantAging;
    const seedChance = config.localSeeding ? Math.min(1, dt / config.seedInterval) : 0;
    const mature = (config.seedingMaturity / 100) * full;
    const seeds = this.seeds;
    seeds.length = 0;

    for (let i = tick % PLANT_UPDATE_STRIDE; i < this.slots; i += PLANT_UPDATE_STRIDE) {
      if (!alive[i]) continue;
      if (aging) {
        const a = age[i]! + dt;
        age[i] = a;
        if (a >= lifespan[i]!) {
          this.kill(i);
          continue;
        }
      }
      const e = energy[i]!;
      const grown = e + growth[biome[i]!]! * e * (1 - e / full) * dt;
      energy[i] = grown;
      if (seedChance > 0 && grown >= mature && rng.next() < seedChance) {
        this.diskOffset(config.seedRadius);
        seeds.push(x[i]! + this.offsetX, y[i]! + this.offsetY);
      }
    }

    if (config.longDistanceDispersal) {
      const { width, height } = this.terrain;
      const expected = ((config.longDistanceRate * width * height) / 1e6) * config.dt;
      let landings = Math.floor(expected);
      if (rng.next() < expected - landings) landings++;
      for (let k = 0; k < landings; k++) seeds.push(rng.range(0, width), rng.range(0, height));
    }

    const seedling = config.seedlingEnergy / 100;
    for (let k = 0; k < seeds.length; k += 2) this.place(seeds[k]!, seeds[k + 1]!, seedling);
  }

  /**
   * Plants a new plant at a point with a share of full energy, if the point is
   * on land inside the world and the ground isn't too crowded for its biome.
   * Returns its slot, or -1 if it failed.
   */
  place(px: number, py: number, energyShare: number): number {
    const { terrain } = this;
    if (!(px >= 0 && py >= 0 && px < terrain.width && py < terrain.height)) return -1;
    const b = terrain.biome[cellIndexAt(terrain, px, py)] as Biome;
    if (b === Biome.None) return -1;
    const capacity = this.capacity[b]!;
    if (capacity <= 0) return -1;
    const crowd = this.index.countWithin(px, py, this.config.crowdingRadius, capacity);
    if (crowd >= capacity || this.rng.next() * capacity < crowd) return -1;

    const slot = this.free.length > 0 ? this.free.pop()! : this.allocate();
    this.x[slot] = px;
    this.y[slot] = py;
    this.energy[slot] = energyShare * this.config.plantEnergy;
    this.age[slot] = 0;
    this.lifespan[slot] = this.config.plantLifespan * (0.5 + this.rng.next());
    this.biome[slot] = b;
    this.alive[slot] = 1;
    this.index.insert(slot, this.x[slot]!, this.y[slot]!);
    this.count++;
    return slot;
  }

  /**
   * Takes up to amount of energy from a plant and returns what was taken. A
   * plant left below its root reserve dies.
   */
  bite(slot: number, amount: number): number {
    const e = this.energy[slot]!;
    const taken = Math.min(e, Math.max(0, amount));
    const left = e - taken;
    if (left <= 0 || left < (this.config.rootReserve / 100) * this.config.plantEnergy) this.kill(slot);
    else this.energy[slot] = left;
    return taken;
  }

  /**
   * Grazes every plant within radius of a point down to at most a share of full
   * energy. Below the root reserve, that kills it. Returns the energy taken.
   */
  graze(px: number, py: number, radius: number, leave: number): number {
    const limit = leave * this.config.plantEnergy;
    let taken = 0;
    for (const slot of this.index.queryRadius(px, py, radius)) {
      const excess = this.energy[slot]! - limit;
      if (excess > 0) taken += this.bite(slot, excess);
    }
    return taken;
  }

  /**
   * Sows fully grown plants at random points within radius of a point, about as
   * many as rainforest could hold there. Each follows the usual rules for
   * taking root. Returns the number planted.
   */
  sow(px: number, py: number, radius: number): number {
    const attempts = Math.max(1, Math.round((Math.PI * radius * radius * this.config.plantDensity) / 10000));
    let planted = 0;
    for (let k = 0; k < attempts; k++) {
      this.diskOffset(radius);
      if (this.place(px + this.offsetX, py + this.offsetY, 1) >= 0) planted++;
    }
    return planted;
  }

  stats(): PlantStats {
    const countByBiome = new Float64Array(BIOME_COUNT);
    const energyByBiome = new Float64Array(BIOME_COUNT);
    let energy = 0;
    for (let i = 0; i < this.slots; i++) {
      if (!this.alive[i]) continue;
      const b = this.biome[i]!;
      countByBiome[b]!++;
      energyByBiome[b]! += this.energy[i]!;
      energy += this.energy[i]!;
    }
    return { count: this.count, energy, countByBiome, energyByBiome };
  }

  snapshot(): PlantSnapshot {
    const n = this.count;
    const x = new Float32Array(n);
    const y = new Float32Array(n);
    const energy = new Uint8Array(n);
    const toByte = 255 / this.config.plantEnergy;
    let k = 0;
    for (let i = 0; i < this.slots; i++) {
      if (!this.alive[i]) continue;
      x[k] = this.x[i]!;
      y[k] = this.y[i]!;
      energy[k] = Math.round(this.energy[i]! * toByte);
      k++;
    }
    return { count: n, x, y, energy };
  }

  /** Hash of all plant state, for the state hash. */
  hash(seed: number): number {
    const n = this.slots;
    let hash = fnv1aWords([this.count, n, ...this.free], seed);
    const fields: ArrayBufferView[] = [
      this.x.subarray(0, n),
      this.y.subarray(0, n),
      this.energy.subarray(0, n),
      this.age.subarray(0, n),
      this.lifespan.subarray(0, n),
      this.biome.subarray(0, n),
      this.alive.subarray(0, n),
    ];
    for (const field of fields) hash = fnv1aArray(field, hash);
    return hash;
  }

  private kill(slot: number): void {
    this.alive[slot] = 0;
    this.index.remove(slot);
    this.free.push(slot);
    this.count--;
  }

  private allocate(): number {
    if (this.slots === this.alive.length) {
      const capacity = this.alive.length * 2;
      const grow = <T extends Float32Array | Float64Array | Uint8Array>(old: T, make: (n: number) => T): T => {
        const array = make(capacity);
        array.set(old);
        return array;
      };
      this.x = grow(this.x, (n) => new Float32Array(n));
      this.y = grow(this.y, (n) => new Float32Array(n));
      this.energy = grow(this.energy, (n) => new Float64Array(n));
      this.age = grow(this.age, (n) => new Float64Array(n));
      this.lifespan = grow(this.lifespan, (n) => new Float32Array(n));
      this.biome = grow(this.biome, (n) => new Uint8Array(n));
      this.alive = grow(this.alive, (n) => new Uint8Array(n));
    }
    return this.slots++;
  }

  /**
   * A uniform random point in a disk of radius r around the origin, left in
   * offsetX and offsetY. Rejection sampling, so no trigonometry: the result is
   * the same on every JavaScript engine.
   */
  private diskOffset(r: number): void {
    let dx: number;
    let dy: number;
    do {
      dx = 2 * this.rng.next() - 1;
      dy = 2 * this.rng.next() - 1;
    } while (dx * dx + dy * dy > 1);
    this.offsetX = dx * r;
    this.offsetY = dy * r;
  }
}
