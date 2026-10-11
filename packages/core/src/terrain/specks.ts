import { TERRAIN_TYPE_NAMES, type TerrainData } from "./types.js";

/** Patches smaller than this many square world units count as specks: about 3 critters across. */
export const SPECK_AREA = 900;

export interface SpeckCount {
  total: number;
  /** Specks of each terrain type, indexed by TerrainType. */
  byType: number[];
}

/**
 * Counts specks: connected patches of one terrain type smaller than maxArea
 * (docs/DESIGN.md §4.2.2). Cells touching at an edge or a corner are connected,
 * so a stair-stepped coastline doesn't break off single cells. A smooth world
 * has few specks.
 */
export function countSpecks(terrain: TerrainData, maxArea = SPECK_AREA): SpeckCount {
  const { cols, rows, terrainType } = terrain;
  const n = cols * rows;
  const cellArea = terrain.cellSize * terrain.cellSize;
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  const byType = new Array<number>(TERRAIN_TYPE_NAMES.length).fill(0);

  for (let start = 0; start < n; start++) {
    if (seen[start]) continue;
    const type = terrainType[start]!;
    seen[start] = 1;
    queue[0] = start;
    let head = 0;
    let size = 1;
    while (head < size) {
      const i = queue[head++]!;
      const col = i % cols;
      const row = (i - col) / cols;
      for (let r = Math.max(0, row - 1); r <= Math.min(rows - 1, row + 1); r++) {
        for (let c = Math.max(0, col - 1); c <= Math.min(cols - 1, col + 1); c++) {
          const j = r * cols + c;
          if (!seen[j] && terrainType[j] === type) {
            seen[j] = 1;
            queue[size++] = j;
          }
        }
      }
    }
    if (size * cellArea < maxArea) byType[type]!++;
  }

  return { total: byType.reduce((sum, count) => sum + count, 0), byType };
}
