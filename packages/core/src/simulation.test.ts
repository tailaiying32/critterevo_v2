import { describe, expect, it } from "vitest";
import { Simulation } from "./simulation.js";

describe("Simulation", () => {
  it("advances one tick per step", () => {
    const sim = new Simulation({ dt: 0.1 });
    sim.stepMany(10);
    expect(sim.tick).toBe(10);
    expect(sim.time).toBeCloseTo(1, 10);
  });

  it("is deterministic for a given seed", () => {
    const a = new Simulation({ seed: 123 });
    const b = new Simulation({ seed: 123 });
    a.stepMany(500);
    b.stepMany(500);
    expect(a.stateHash()).toBe(b.stateHash());
  });

  it("clamps config values to the knob ranges", () => {
    const sim = new Simulation({ dt: 5 });
    expect(sim.config.dt).toBe(0.2);
  });

  it("differs across seeds", () => {
    const a = new Simulation({ seed: 1 });
    const b = new Simulation({ seed: 2 });
    expect(a.stateHash()).not.toBe(b.stateHash());
  });
});
