import { describe, expect, it } from "vitest";
import { Rng } from "./rng.js";

describe("Rng", () => {
  it("produces the same sequence for the same seed", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 1000; i++) expect(a.nextUint32()).toBe(b.nextUint32());
  });

  it("produces different sequences for different seeds", () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const same = Array.from({ length: 100 }, () => a.nextUint32() === b.nextUint32()).filter(Boolean);
    expect(same.length).toBeLessThan(3);
  });

  it("returns floats in [0, 1) with a roughly uniform mean", () => {
    const rng = new Rng(7);
    let sum = 0;
    const n = 100_000;
    for (let i = 0; i < n; i++) {
      const x = rng.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      sum += x;
    }
    expect(sum / n).toBeCloseTo(0.5, 2);
  });

  it("resumes exactly from a saved state", () => {
    const rng = new Rng(99);
    for (let i = 0; i < 50; i++) rng.next();
    const restored = Rng.fromState(rng.getState());
    for (let i = 0; i < 100; i++) expect(restored.nextUint32()).toBe(rng.nextUint32());
  });

  it("int() stays within bounds", () => {
    const rng = new Rng(3);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.int(6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
    }
  });
});
