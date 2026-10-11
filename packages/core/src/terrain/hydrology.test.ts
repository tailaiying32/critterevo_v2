import { describe, expect, it } from "vitest";
import { flowAccumulation, priorityFlood } from "./hydrology.js";

// A 7x7 bowl: rim at height 5, a pit of height 1 in the middle, a gap in the rim at (3, 0) of height 2.
function bowl(): { elevation: Float64Array; cols: number; rows: number } {
  const cols = 7;
  const rows = 7;
  const elevation = new Float64Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const edge = r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
      elevation[r * cols + c] = edge ? 5 : 3;
    }
  }
  elevation[3 * cols + 3] = 1;
  elevation[0 * cols + 3] = 2;
  return { elevation, cols, rows };
}

describe("priorityFlood", () => {
  const { elevation, cols, rows } = bowl();
  const isEdge = (i: number) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    return r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
  };
  const drainage = priorityFlood(elevation, cols, rows, isEdge);

  it("floods every sample", () => {
    expect(drainage.order.length).toBe(cols * rows);
  });

  it("fills the pit up to the level it spills at", () => {
    const pit = drainage.filled[3 * cols + 3]!;
    expect(pit).toBeGreaterThanOrEqual(3);
    expect(pit).toBeLessThan(3.001);
  });

  it("routes every sample to an outlet without cycles", () => {
    for (let i = 0; i < cols * rows; i++) {
      let cur = i;
      let steps = 0;
      while (drainage.receiver[cur]! >= 0) {
        cur = drainage.receiver[cur]!;
        expect(++steps).toBeLessThan(cols * rows);
      }
      expect(isEdge(cur)).toBe(true);
    }
  });

  it("drains the bowl out through the gap in the rim", () => {
    let cur = 3 * cols + 3;
    while (drainage.receiver[cur]! >= 0) cur = drainage.receiver[cur]!;
    // The interior drains to an outlet next to its lowest way out, which is the gap at (3, 0).
    expect(cur).toBe(0 * cols + 3);
  });

  it("accumulates all interior flow at that outlet", () => {
    const flow = flowAccumulation(drainage, cols * rows);
    // 5x5 interior samples plus the gap itself.
    expect(flow[0 * cols + 3]).toBe(26);
  });
});
