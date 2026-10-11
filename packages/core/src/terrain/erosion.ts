import type { Rng } from "../rng.js";

/**
 * Droplet-based hydraulic erosion (docs/DESIGN.md §4.2.1).
 *
 * Simulated raindrops start at random points and run downhill. A drop picks up
 * sediment where it is fast and the ground is steep, and drops it where it slows
 * or the ground flattens. Many drops together carve gullies and valleys and leave
 * smooth slopes and plains, which plain fractal noise cannot produce.
 *
 * Heights are in sample units: one unit of height equals one sample spacing.
 * Arithmetic, Math.floor, and Math.sqrt only, so results are identical on every engine.
 */
export interface ErosionParams {
  drops: number;
  /** How much a drop keeps its previous direction, 0..1. */
  inertia: number;
  /** Sediment a drop can carry, per unit of slope, speed, and water. */
  capacity: number;
  /** Floor on slope used for capacity, so drops on flat ground still carry some sediment. */
  minSlope: number;
  /** Share of surplus sediment deposited per step. */
  deposit: number;
  /** Share of spare capacity eroded per step. */
  erode: number;
  /** Share of water lost per step. */
  evaporate: number;
  gravity: number;
  maxSteps: number;
  /** Radius in samples over which erosion is spread. */
  radius: number;
}

export const DEFAULT_EROSION: Omit<ErosionParams, "drops"> = {
  inertia: 0.05,
  capacity: 4,
  minSlope: 0.01,
  deposit: 0.3,
  erode: 0.3,
  evaporate: 0.02,
  gravity: 4,
  maxSteps: 64,
  radius: 3,
};

/**
 * @param stopAt Optional mask of samples (lake basins) where drops stop. A drop
 * that reaches one drops all its sediment at the shore, building a small delta,
 * so basins are not filled in and still hold lakes afterwards.
 */
export function erode(
  height: Float64Array,
  cols: number,
  rows: number,
  rng: Rng,
  params: ErosionParams,
  stopAt?: Uint8Array,
): void {
  const { inertia, capacity: capacityK, minSlope, deposit, erode: erodeK, evaporate, gravity, maxSteps, radius } = params;

  // Erosion brush: cells within the radius, weighted by closeness, weights summing to 1.
  const brushDc: number[] = [];
  const brushDr: number[] = [];
  const brushW: number[] = [];
  let weightSum = 0;
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      const d = Math.sqrt(dc * dc + dr * dr);
      if (d > radius) continue;
      const w = 1 - d / radius;
      brushDc.push(dc);
      brushDr.push(dr);
      brushW.push(w);
      weightSum += w;
    }
  }
  for (let k = 0; k < brushW.length; k++) brushW[k]! /= weightSum;

  const maxX = cols - 1;
  const maxY = rows - 1;

  for (let drop = 0; drop < params.drops; drop++) {
    let px = rng.range(0, maxX);
    let py = rng.range(0, maxY);
    let dirX = 0;
    let dirY = 0;
    let speed = 1;
    let water = 1;
    let sediment = 0;

    for (let step = 0; step < maxSteps; step++) {
      const c = Math.floor(px);
      const r = Math.floor(py);
      const u = px - c;
      const v = py - r;
      const i = r * cols + c;
      const hA = height[i]!;
      const hB = height[i + 1]!;
      const hC = height[i + cols]!;
      const hD = height[i + cols + 1]!;
      const heightHere = hA * (1 - u) * (1 - v) + hB * u * (1 - v) + hC * (1 - u) * v + hD * u * v;
      const gx = (hB - hA) * (1 - v) + (hD - hC) * v;
      const gy = (hC - hA) * (1 - u) + (hD - hB) * u;

      dirX = dirX * inertia - gx * (1 - inertia);
      dirY = dirY * inertia - gy * (1 - inertia);
      const len = Math.sqrt(dirX * dirX + dirY * dirY);
      if (len === 0) break;
      dirX /= len;
      dirY /= len;
      px += dirX;
      py += dirY;
      if (px < 0 || py < 0 || px >= maxX || py >= maxY) break;

      const c2 = Math.floor(px);
      const r2 = Math.floor(py);
      if (stopAt && stopAt[r2 * cols + c2]) {
        // Reached a lake basin: spread all sediment over the brush at the shore and stop.
        // Spreading it (rather than dropping it on one point) builds smooth deltas.
        for (let k = 0; k < brushW.length; k++) {
          const cc = c + brushDc[k]!;
          const rr = r + brushDr[k]!;
          if (cc < 0 || rr < 0 || cc > maxX || rr > maxY) continue;
          const b = rr * cols + cc;
          height[b] = height[b]! + sediment * brushW[k]!;
        }
        break;
      }

      // Height at the new position.
      const u2 = px - c2;
      const v2 = py - r2;
      const j = r2 * cols + c2;
      const heightNext =
        height[j]! * (1 - u2) * (1 - v2) +
        height[j + 1]! * u2 * (1 - v2) +
        height[j + cols]! * (1 - u2) * v2 +
        height[j + cols + 1]! * u2 * v2;
      const dh = heightNext - heightHere;

      const capacity = Math.max(-dh, minSlope) * speed * water * capacityK;
      if (sediment > capacity || dh > 0) {
        // Deposit at the previous position, split over its 4 corners. Uphill: fill the pit.
        const amount = dh > 0 ? Math.min(dh, sediment) : (sediment - capacity) * deposit;
        sediment -= amount;
        height[i] = hA + amount * (1 - u) * (1 - v);
        height[i + 1] = height[i + 1]! + amount * u * (1 - v);
        height[i + cols] = height[i + cols]! + amount * (1 - u) * v;
        height[i + cols + 1] = height[i + cols + 1]! + amount * u * v;
      } else {
        // Erode around the previous position, never digging deeper than the drop descended.
        const amount = Math.min((capacity - sediment) * erodeK, -dh);
        for (let k = 0; k < brushW.length; k++) {
          const cc = c + brushDc[k]!;
          const rr = r + brushDr[k]!;
          if (cc < 0 || rr < 0 || cc > maxX || rr > maxY) continue;
          const b = rr * cols + cc;
          const take = Math.min(height[b]!, amount * brushW[k]!);
          height[b] = height[b]! - take;
          sediment += take;
        }
      }

      speed = Math.sqrt(Math.max(0, speed * speed + dh * gravity));
      water *= 1 - evaporate;
    }
  }
}
