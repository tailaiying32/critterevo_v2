import { createNoise2D } from "simplex-noise";
import type { Rng } from "../rng.js";

const MAX_OCTAVES = 8;

export interface FractalNoiseOptions {
  /** Approximate visible size of the largest features, in world units. */
  featureSize: number;
  octaves: number;
  /** Amplitude multiplier from one octave to the next. */
  persistence: number;
  /** Frequency multiplier from one octave to the next. */
  lacunarity: number;
}

/**
 * Multi-octave simplex noise in world coordinates, with access to individual
 * octave ranges so callers can treat the broad shape and the fine detail
 * differently.
 *
 * The permutation table and per-octave offsets come from the given seeded Rng.
 * Offsets are drawn for MAX_OCTAVES regardless of the octave count, so changing
 * the octave count never reshuffles the octaves that remain.
 */
export interface OctaveNoise {
  readonly octaves: number;
  /** Amplitude of octave o (1 for the first octave). */
  amplitude(o: number): number;
  /** Sum of amplitude-weighted octaves [from, to). Each octave is in [-amplitude, amplitude]. */
  sum(x: number, y: number, from: number, to: number): number;
}

export function createOctaveNoise(rng: Rng, options: FractalNoiseOptions): OctaveNoise {
  const noise = createNoise2D(() => rng.next());
  const offsetX: number[] = [];
  const offsetY: number[] = [];
  for (let i = 0; i < MAX_OCTAVES; i++) {
    offsetX.push(rng.range(-10000, 10000));
    offsetY.push(rng.range(-10000, 10000));
  }

  const octaves = Math.max(1, Math.min(MAX_OCTAVES, Math.round(options.octaves)));
  // Simplex noise blobs span about half a wavelength, so a wavelength of twice the
  // feature size makes features appear roughly featureSize across.
  const frequencies: number[] = [];
  const amplitudes: number[] = [];
  let frequency = 1 / (2 * options.featureSize);
  let amplitude = 1;
  for (let o = 0; o < octaves; o++) {
    frequencies.push(frequency);
    amplitudes.push(amplitude);
    frequency *= options.lacunarity;
    amplitude *= options.persistence;
  }

  return {
    octaves,
    amplitude: (o) => amplitudes[o] ?? 0,
    sum(x, y, from, to) {
      let total = 0;
      for (let o = from; o < Math.min(to, octaves); o++) {
        total += amplitudes[o]! * noise(x * frequencies[o]! + offsetX[o]!, y * frequencies[o]! + offsetY[o]!);
      }
      return total;
    },
  };
}

/** Fractal (multi-octave) simplex noise in world coordinates, returning values in [-1, 1]. */
export function createFractalNoise(rng: Rng, options: FractalNoiseOptions): (x: number, y: number) => number {
  const octaveNoise = createOctaveNoise(rng, options);
  let norm = 0;
  for (let o = 0; o < octaveNoise.octaves; o++) norm += octaveNoise.amplitude(o);
  return (x, y) => octaveNoise.sum(x, y, 0, octaveNoise.octaves) / norm;
}

/** Cubic smoothstep from 0 at edge0 to 1 at edge1. Arithmetic only. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
