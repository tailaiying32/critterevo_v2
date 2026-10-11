import { makeConfig, type WorldConfig } from "./config.js";
import { Rng } from "./rng.js";
import { generateTerrain } from "./terrain/generate.js";
import type { TerrainData } from "./terrain/types.js";

/** The data the renderer needs each frame. Grows as features are added. */
export interface Snapshot {
  tick: number;
  time: number;
  width: number;
  height: number;
}

/**
 * The simulation. Owns all world state and advances it one fixed tick at a time.
 * It never reads the clock or the DOM, so the browser worker and the CLI run
 * identical code and produce identical results.
 */
export class Simulation {
  readonly config: WorldConfig;
  /** Static terrain grid, generated once per world (docs/DESIGN.md §4.2). */
  readonly terrain: TerrainData;
  private readonly rng: Rng;
  private readonly terrainHash: number;
  private tickCount = 0;

  constructor(config: Partial<WorldConfig> = {}) {
    this.config = makeConfig(config);
    this.rng = Rng.derive(this.config.seed, "simulation");
    this.terrain = generateTerrain(this.config);
    this.terrainHash = hashTerrain(this.terrain);
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
  }

  stepMany(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.step();
  }

  snapshot(): Snapshot {
    return {
      tick: this.tickCount,
      time: this.time,
      width: this.config.width,
      height: this.config.height,
    };
  }

  /**
   * A short fingerprint of the full world state. Two runs with the same seed and
   * config must produce the same hash at the same tick. Extend this as state grows.
   */
  stateHash(): string {
    const { a, b, c, d } = this.rng.getState();
    return toHex(fnv1aWords([this.tickCount, a, b, c, d, this.terrainHash]));
  }
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1aWords(values: readonly number[], seed = FNV_OFFSET): number {
  let hash = seed;
  for (const value of values) {
    let v = value | 0;
    for (let i = 0; i < 4; i++) {
      hash ^= v & 0xff;
      hash = Math.imul(hash, FNV_PRIME);
      v >>>= 8;
    }
  }
  return hash >>> 0;
}

function fnv1aBytes(bytes: Uint8Array, seed: number): number {
  let hash = seed;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/** Hash of every terrain field, computed once per world. */
function hashTerrain(terrain: TerrainData): number {
  const levels = terrain.levels;
  const levelBits = new Float64Array([
    levels.sea,
    levels.deep,
    levels.maxDepth,
    levels.mountain,
    levels.dry,
    levels.wet,
    levels.cold,
    levels.hot,
    levels.deepRiverWidth,
  ]);
  let hash = fnv1aWords([terrain.cols, terrain.rows, terrain.cellSize, terrain.width, terrain.height]);
  hash = fnv1aBytes(new Uint8Array(levelBits.buffer), hash);
  for (const field of [
    terrain.elevation,
    terrain.water,
    terrain.rivers,
    terrain.temperature,
    terrain.moisture,
    terrain.waterDistance,
    terrain.terrainType,
    terrain.biome,
  ]) {
    hash = fnv1aBytes(new Uint8Array(field.buffer, field.byteOffset, field.byteLength), hash);
  }
  return hash;
}

function toHex(hash: number): string {
  return hash.toString(16).padStart(8, "0");
}
