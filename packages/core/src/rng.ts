/**
 * Seeded pseudo-random number generator (sfc32, 128-bit state).
 *
 * This is the ONLY source of randomness allowed in core. ESLint bans Math.random
 * there. Given the same seed, every run produces the same sequence, which makes
 * whole simulations replayable (docs/DESIGN.md §3.3).
 */

export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

const UINT32_RANGE = 4294967296; // 2^32

export class Rng {
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 0;

  constructor(seed: number) {
    // Expand one 32-bit seed into 128 bits of state with splitmix32.
    let s = seed >>> 0;
    const splitmix32 = (): number => {
      s = (s + 0x9e3779b9) | 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      return (z ^ (z >>> 16)) | 0;
    };
    this.a = splitmix32();
    this.b = splitmix32();
    this.c = splitmix32();
    this.d = splitmix32();
    // Discard early outputs so similar seeds diverge fully.
    for (let i = 0; i < 12; i++) this.nextUint32();
  }

  /**
   * Creates an independent stream for one system, derived from the world seed
   * and a label such as "terrain.elevation". Each system draws from its own
   * stream, so adding or changing one system never shifts another's randomness.
   */
  static derive(seed: number, label: string): Rng {
    let hash = 0x811c9dc5;
    const mix = (byte: number) => {
      hash ^= byte & 0xff;
      hash = Math.imul(hash, 0x01000193);
    };
    let s = seed >>> 0;
    for (let i = 0; i < 4; i++) {
      mix(s);
      s >>>= 8;
    }
    for (let i = 0; i < label.length; i++) {
      const code = label.charCodeAt(i);
      mix(code);
      mix(code >>> 8);
    }
    return new Rng(hash >>> 0);
  }

  /** Restores a generator from a saved state, for save/load. */
  static fromState(state: RngState): Rng {
    const rng = new Rng(0);
    rng.a = state.a | 0;
    rng.b = state.b | 0;
    rng.c = state.c | 0;
    rng.d = state.d | 0;
    return rng;
  }

  getState(): RngState {
    return { a: this.a, b: this.b, c: this.c, d: this.d };
  }

  /** Uniform integer in [0, 2^32). */
  nextUint32(): number {
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextUint32() / UINT32_RANGE;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }
}
