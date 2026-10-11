import { makeConfig, type WorldConfig } from "./config.js";
import { Rng } from "./rng.js";

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
  private readonly rng: Rng;
  private tickCount = 0;

  constructor(config: Partial<WorldConfig> = {}) {
    this.config = makeConfig(config);
    this.rng = new Rng(this.config.seed);
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
    return fnv1a([this.tickCount, a, b, c, d]);
  }
}

function fnv1a(values: readonly number[]): string {
  let hash = 0x811c9dc5;
  for (const value of values) {
    let v = value | 0;
    for (let i = 0; i < 4; i++) {
      hash ^= v & 0xff;
      hash = Math.imul(hash, 0x01000193);
      v >>>= 8;
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
