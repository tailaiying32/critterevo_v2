import type { WorldConfig } from "../config.js";
import { fnv1aArray, fnv1aWords } from "../hash.js";
import { SpatialHash } from "../spatial.js";
import type { TerrainData } from "../terrain/types.js";

/** A corpse is gone once its energy falls below this share of what it started with. */
export const CORPSE_REMAINDER = 0.05;

const INITIAL_CAPACITY = 256;

/** Corpses as the renderer needs them, packed into typed arrays that can be transferred. */
export interface CorpseSnapshot {
  count: number;
  x: Float32Array;
  y: Float32Array;
  /** Body radius of the critter it was. */
  radius: Float32Array;
  /** Energy as a share of what it started with, 0 to 255. */
  energy: Uint8Array;
}

export interface CorpseStats {
  count: number;
  energy: number;
}

/**
 * Corpses (docs/DESIGN.md §5.2): what a critter leaves where it dies, with
 * energy in proportion to its mass. Stored as a struct of arrays indexed by
 * slot like plants, with their own spatial hash for eating later on. Each tick
 * a corpse loses a fixed share of its energy, so it halves every half-life,
 * and it is gone once only CORPSE_REMAINDER of its starting energy is left.
 * Corpses can't be eaten until diets arrive (Phase 10).
 */
export class Corpses {
  count = 0;
  slots = 0;
  x = new Float64Array(INITIAL_CAPACITY);
  y = new Float64Array(INITIAL_CAPACITY);
  radius = new Float64Array(INITIAL_CAPACITY);
  energy = new Float64Array(INITIAL_CAPACITY);
  /** Energy it started with. */
  initial = new Float64Array(INITIAL_CAPACITY);
  alive = new Uint8Array(INITIAL_CAPACITY);
  readonly index: SpatialHash;

  /** Share of its energy a corpse keeps each tick. */
  private keep = 1;
  private readonly free: number[] = [];

  constructor(terrain: TerrainData, config: WorldConfig) {
    this.index = new SpatialHash(terrain.width, terrain.height);
    this.configure(config);
  }

  /** Applies a new config. Called when live knobs change. */
  configure(config: WorldConfig): void {
    this.keep = config.corpseDecay ? Math.pow(0.5, config.dt / config.corpseHalfLife) : 1;
  }

  /** Leaves a corpse at a point. Returns its slot, or -1 if it would hold no energy. */
  add(px: number, py: number, radius: number, energy: number): number {
    if (!(energy > 0)) return -1;
    const slot = this.free.length > 0 ? this.free.pop()! : this.allocate();
    this.x[slot] = px;
    this.y[slot] = py;
    this.radius[slot] = radius;
    this.energy[slot] = energy;
    this.initial[slot] = energy;
    this.alive[slot] = 1;
    this.index.insert(slot, px, py);
    this.count++;
    return slot;
  }

  /** Decays every corpse by one tick and removes those that are gone. */
  step(): void {
    const { keep, energy, initial, alive } = this;
    if (keep === 1) return;
    for (let i = 0; i < this.slots; i++) {
      if (!alive[i]) continue;
      const e = energy[i]! * keep;
      if (e < CORPSE_REMAINDER * initial[i]!) this.remove(i);
      else energy[i] = e;
    }
  }

  remove(slot: number): void {
    if (!this.alive[slot]) return;
    this.alive[slot] = 0;
    this.energy[slot] = 0;
    this.index.remove(slot);
    this.free.push(slot);
    this.count--;
  }

  stats(): CorpseStats {
    let energy = 0;
    for (let i = 0; i < this.slots; i++) if (this.alive[i]) energy += this.energy[i]!;
    return { count: this.count, energy };
  }

  snapshot(): CorpseSnapshot {
    const n = this.count;
    const snapshot: CorpseSnapshot = {
      count: n,
      x: new Float32Array(n),
      y: new Float32Array(n),
      radius: new Float32Array(n),
      energy: new Uint8Array(n),
    };
    let k = 0;
    for (let i = 0; i < this.slots; i++) {
      if (!this.alive[i]) continue;
      snapshot.x[k] = this.x[i]!;
      snapshot.y[k] = this.y[i]!;
      snapshot.radius[k] = this.radius[i]!;
      snapshot.energy[k] = Math.round((this.energy[i]! / this.initial[i]!) * 255);
      k++;
    }
    return snapshot;
  }

  /** Hash of all corpse state, for the state hash. */
  hash(seed: number): number {
    const n = this.slots;
    let hash = fnv1aWords([this.count, n, ...this.free], seed);
    const fields: ArrayBufferView[] = [
      this.x.subarray(0, n),
      this.y.subarray(0, n),
      this.radius.subarray(0, n),
      this.energy.subarray(0, n),
      this.initial.subarray(0, n),
      this.alive.subarray(0, n),
    ];
    for (const field of fields) hash = fnv1aArray(field, hash);
    return hash;
  }

  private allocate(): number {
    if (this.slots === this.alive.length) {
      const capacity = this.alive.length * 2;
      const grow = <T extends Float64Array | Uint8Array>(old: T, make: (n: number) => T): T => {
        const array = make(capacity);
        array.set(old);
        return array;
      };
      const f64 = (n: number) => new Float64Array(n);
      this.x = grow(this.x, f64);
      this.y = grow(this.y, f64);
      this.radius = grow(this.radius, f64);
      this.energy = grow(this.energy, f64);
      this.initial = grow(this.initial, f64);
      this.alive = grow(this.alive, (n) => new Uint8Array(n));
    }
    return this.slots++;
  }
}
