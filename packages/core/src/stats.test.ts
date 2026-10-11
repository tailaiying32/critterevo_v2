import { describe, expect, it } from "vitest";
import { StatsRecorder } from "./stats.js";

describe("StatsRecorder", () => {
  it("records rows when due", () => {
    const stats = new StatsRecorder(["tick", "value"], 10, 8);
    for (let tick = 0; tick <= 50; tick++) if (stats.due(tick)) stats.record([tick, tick * 2]);
    expect([...stats.column("tick")]).toEqual([0, 10, 20, 30, 40, 50]);
    expect([...stats.column("value")]).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it("thins to every other row and doubles the interval when full, keeping the whole history", () => {
    const stats = new StatsRecorder(["tick"], 10, 8);
    for (let tick = 0; tick <= 200; tick++) if (stats.due(tick)) stats.record([tick]);
    expect(stats.interval).toBe(40);
    expect(stats.epoch).toBe(2);
    expect([...stats.column("tick")]).toEqual([0, 40, 80, 120, 160, 200]);
  });

  it("returns rows from a start index, with the epoch to detect thinning", () => {
    const stats = new StatsRecorder(["tick"], 1, 4);
    for (let tick = 0; tick < 3; tick++) stats.record([tick]);
    const first = stats.rows(1);
    expect(first.start).toBe(1);
    expect([...first.data[0]!]).toEqual([1, 2]);
    stats.record([3]);
    stats.record([4]);
    const after = stats.rows(3);
    expect(after.epoch).not.toBe(first.epoch);
  });
});
