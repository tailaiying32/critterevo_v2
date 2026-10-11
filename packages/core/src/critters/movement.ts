import type { WorldConfig } from "../config.js";
import { cellIndexAt } from "../terrain/lookup.js";
import { depthShare } from "../terrain/slope.js";
import { TerrainType, type TerrainData } from "../terrain/types.js";

/** Body radius in world units per unit of size: a size 1 critter is 10 units across. */
export const RADIUS_PER_SIZE = 5;

/** Tobler's hiking function is fastest at this grade: a slight downhill. */
const TOBLER_OFFSET = 0.05;

/** Body radius of a critter of a size, in world units. */
export function radiusOf(size: number): number {
  return RADIUS_PER_SIZE * size;
}

/** Mass of a critter of a size: it grows with volume, so size 1 has mass 1. */
export function massOf(size: number): number {
  return size * size * size;
}

/**
 * Most acceleration a critter of a size can reach, in u/s². Muscle force grows
 * with cross-section, mass^(2/3), so acceleration falls as mass^(−1/3), which
 * is 1 / size (docs/DESIGN.md §8).
 */
export function accelerationOf(size: number, config: Pick<WorldConfig, "acceleration">): number {
  return config.acceleration / size;
}

/**
 * Share of full speed a critter can reach wading in water of a depth share,
 * 0 at the shore and 1 at deep water: (1 − depth)^(drag / size), so bigger
 * critters wade deeper water more easily (docs/DESIGN.md §4.3.1).
 */
export function wadingFactor(depth: number, size: number, drag: number): number {
  if (depth <= 0) return 1;
  if (depth >= 1) return 0;
  return Math.pow(1 - depth, drag / size);
}

/**
 * Share of flat-ground speed a critter can reach at a grade along its heading,
 * rise over run, positive uphill: Tobler's hiking function relative to flat
 * ground, capped at 1 (docs/DESIGN.md §4.3.1). Uphill is slower than the same
 * grade downhill, and steep downhill is slow too.
 */
export function slopeFactor(grade: number, sensitivity: number): number {
  return Math.min(1, Math.exp(-sensitivity * (Math.abs(grade + TOBLER_OFFSET) - TOBLER_OFFSET)));
}

/** How the terrain under a critter limits its speed. Each part is a share of full speed, 0 to 1. */
export interface TerrainEffect {
  /** From water depth. 1 on land. */
  wading: number;
  /** From the grade along the heading. 1 on flat ground and in water. */
  slope: number;
  /** Grade along the heading as the critter feels it: rise over run, scaled by its size. */
  grade: number;
}

/**
 * The terrain's effect on a critter of a size at a point, heading along
 * (cos, sin). Both parts come from the cell under its center. Turned-off
 * slowdowns count as 1.
 */
export function terrainEffect(
  terrain: TerrainData,
  config: Pick<WorldConfig, "wadingSlowdown" | "wadingDrag" | "slopeSlowdown" | "slopeSensitivity" | "mapScale">,
  x: number,
  y: number,
  cos: number,
  sin: number,
  size: number,
  out: TerrainEffect,
): TerrainEffect {
  const cell = cellIndexAt(terrain, x, y);
  const grade = ((terrain.slopeX[cell]! * cos + terrain.slopeY[cell]! * sin) / config.mapScale) * size;
  out.wading = config.wadingSlowdown ? wadingFactor(depthShare(terrain, cell), size, config.wadingDrag) : 1;
  out.slope = config.slopeSlowdown ? slopeFactor(grade, config.slopeSensitivity) : 1;
  out.grade = grade;
  return out;
}

/**
 * Whether a body of radius r centered at (x, y) fits: entirely inside the
 * world, and overlapping no deep-water cell. Touching counts as fitting.
 */
export function bodyFits(terrain: TerrainData, x: number, y: number, r: number): boolean {
  if (!(x >= r && y >= r && x <= terrain.width - r && y <= terrain.height - r)) return false;
  const { cellSize: s, cols, rows, terrainType } = terrain;
  const c0 = Math.max(0, Math.floor((x - r) / s));
  const c1 = Math.min(cols - 1, Math.floor((x + r) / s));
  const r0 = Math.max(0, Math.floor((y - r) / s));
  const r1 = Math.min(rows - 1, Math.floor((y + r) / s));
  const rSq = r * r;
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      if (terrainType[row * cols + col] !== TerrainType.DeepWater) continue;
      // The point of the cell nearest the center.
      const nx = Math.min((col + 1) * s, Math.max(col * s, x));
      const ny = Math.min((row + 1) * s, Math.max(row * s, y));
      const dx = x - nx;
      const dy = y - ny;
      if (dx * dx + dy * dy < rSq) return false;
    }
  }
  return true;
}
