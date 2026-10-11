import { describe, expect, it } from "vitest";
import { Rng } from "./rng.js";
import { SpatialHash } from "./spatial.js";

/** Ids within r of (x, y) by checking every point, sorted. */
function bruteForce(points: Map<number, { x: number; y: number }>, x: number, y: number, r: number): number[] {
  const found: number[] = [];
  for (const [id, p] of points) if ((p.x - x) ** 2 + (p.y - y) ** 2 <= r * r) found.push(id);
  return found.sort((a, b) => a - b);
}

describe("SpatialHash", () => {
  it("matches a brute-force search on random data, through inserts, moves, and removes", () => {
    const rng = new Rng(11);
    const width = 1000;
    const height = 700;
    const hash = new SpatialHash(width, height, 32, 4);
    const points = new Map<number, { x: number; y: number }>();
    const check = () => {
      for (let q = 0; q < 50; q++) {
        const x = rng.range(-50, width + 50);
        const y = rng.range(-50, height + 50);
        const r = rng.range(0, 150);
        expect(hash.queryRadius(x, y, r).sort((a, b) => a - b)).toEqual(bruteForce(points, x, y, r));
        expect(hash.countWithin(x, y, r)).toBe(bruteForce(points, x, y, r).length);
      }
    };

    for (let id = 0; id < 2000; id++) {
      const p = { x: rng.range(0, width), y: rng.range(0, height) };
      points.set(id, p);
      hash.insert(id, p.x, p.y);
    }
    expect(hash.count).toBe(2000);
    check();

    for (let id = 0; id < 2000; id += 3) {
      const p = { x: rng.range(-20, width + 20), y: rng.range(-20, height + 20) };
      points.set(id, p);
      hash.move(id, p.x, p.y);
    }
    check();

    for (let id = 1; id < 2000; id += 2) {
      points.delete(id);
      hash.remove(id);
    }
    expect(hash.count).toBe(points.size);
    check();
  });

  it("includes points exactly on the edge of the circle", () => {
    const hash = new SpatialHash(100, 100, 10);
    hash.insert(0, 30, 50);
    hash.insert(1, 50, 50);
    expect(hash.queryRadius(50, 50, 20).sort()).toEqual([0, 1]);
    expect(hash.queryRadius(50, 50, 19.99)).toEqual([1]);
  });

  it("stops counting at the limit", () => {
    const hash = new SpatialHash(100, 100, 10);
    for (let id = 0; id < 10; id++) hash.insert(id, 50, 50);
    expect(hash.countWithin(50, 50, 5, 3)).toBe(3);
    expect(hash.countWithin(50, 50, 5)).toBe(10);
  });

  it("reuses ids after they are removed and rejects duplicates", () => {
    const hash = new SpatialHash(100, 100, 10);
    hash.insert(5, 10, 10);
    expect(() => hash.insert(5, 20, 20)).toThrow();
    hash.remove(5);
    expect(hash.has(5)).toBe(false);
    hash.insert(5, 90, 90);
    expect(hash.queryRadius(90, 90, 1)).toEqual([5]);
    expect(hash.queryRadius(10, 10, 1)).toEqual([]);
  });
});
