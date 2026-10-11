import { createNoise2D } from "simplex-noise";
import type { Rng } from "../rng.js";

export interface FractalNoiseSettings {
  /** Wavelength of the first octave in world units: roughly the size of the largest features. */
  wavelength: number;
  octaves: number;
  /** Amplitude of each octave relative to the one before. */
  persistence: number;
  /** Frequency of each octave relative to the one before. */
  lacunarity: number;
}

/** The simplex-noise library's permutation table repeats every 256 units. */
const NOISE_PERIOD = 256;

/**
 * Fractal simplex noise in world coordinates, normalized to 0 to 1
 * (docs/DESIGN.md §4.2.1 step 2). Each octave is shifted by its own random
 * offset, so the octaves don't all pass through the same point at the origin.
 * All randomness is drawn from rng up front.
 */
export function createFractalNoise(rng: Rng, settings: FractalNoiseSettings): (x: number, y: number) => number {
  const { wavelength, octaves, persistence, lacunarity } = settings;
  const noise2D = createNoise2D(() => rng.next());
  const offsetX = new Float64Array(octaves);
  const offsetY = new Float64Array(octaves);
  let totalAmplitude = 0;
  for (let o = 0, amplitude = 1; o < octaves; o++, amplitude *= persistence) {
    offsetX[o] = rng.next() * NOISE_PERIOD;
    offsetY[o] = rng.next() * NOISE_PERIOD;
    totalAmplitude += amplitude;
  }
  const baseFrequency = 1 / wavelength;

  return (x, y) => {
    let sum = 0;
    let amplitude = 1;
    let frequency = baseFrequency;
    for (let o = 0; o < octaves; o++) {
      sum += amplitude * noise2D(x * frequency + offsetX[o]!, y * frequency + offsetY[o]!);
      amplitude *= persistence;
      frequency *= lacunarity;
    }
    const value = (sum / totalAmplitude + 1) / 2;
    return value < 0 ? 0 : value > 1 ? 1 : value;
  };
}
