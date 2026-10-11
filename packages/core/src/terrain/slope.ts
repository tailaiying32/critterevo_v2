import type { ClimateGrid } from "./climate.js";
import { heightOf, isWater, TerrainType, type TerrainData } from "./types.js";

/**
 * Slope of each cell in feet of height per world unit, toward +x (east) and +y
 * (south), from the exact heights of its neighbors (docs/DESIGN.md §4.3.1):
 * central differences inside the grid, one-sided at its edges. Water is at
 * height 0, so the coast rises from it, and water's own surface is flat.
 * Movement reads these; the map's relief shading is drawing only.
 */
export function slopeField(grid: ClimateGrid, terrainType: Uint8Array): { slopeX: Float32Array; slopeY: Float32Array } {
  const { cols, rows, cellSize, elevation } = grid;
  const height = Float64Array.from(elevation, (e) => heightOf(grid, e));
  const slopeX = new Float32Array(cols * rows);
  const slopeY = new Float32Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    const up = Math.max(0, row - 1);
    const down = Math.min(rows - 1, row + 1);
    for (let col = 0; col < cols; col++) {
      const left = Math.max(0, col - 1);
      const right = Math.min(cols - 1, col + 1);
      const i = row * cols + col;
      if (isWater(terrainType[i] as TerrainType)) continue;
      if (right > left) slopeX[i] = (height[row * cols + right]! - height[row * cols + left]!) / ((right - left) * cellSize);
      if (down > up) slopeY[i] = (height[down * cols + col]! - height[up * cols + col]!) / ((down - up) * cellSize);
    }
  }
  return { slopeX, slopeY };
}

/**
 * Depth of a shallow water cell as a share of the shallow band: 0 at sea level
 * (the shore), approaching 1 at the deep-water boundary. 0 for land and 1 for
 * deep water.
 */
export function depthShare(terrain: Pick<TerrainData, "levels" | "elevation" | "terrainType">, cell: number): number {
  const type = terrain.terrainType[cell]!;
  if (type === TerrainType.DeepWater) return 1;
  if (type !== TerrainType.ShallowWater) return 0;
  const { sea, shallow } = terrain.levels;
  return sea > shallow ? Math.min(1, Math.max(0, (sea - terrain.elevation[cell]!) / (sea - shallow))) : 0;
}
