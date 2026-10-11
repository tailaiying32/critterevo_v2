import { describe, expect, it } from "vitest";
import { makeConfig, type WorldConfig } from "../config.js";
import { Rng } from "../rng.js";
import { Simulation } from "../simulation.js";
import { slopeField } from "../terrain/slope.js";
import { TerrainType, type TerrainData } from "../terrain/types.js";
import { ControllerKind } from "./controllers.js";
import { Critters, type CritterTraits } from "./critters.js";
import { bodyFits, slopeFactor, wadingFactor } from "./movement.js";

const TRAITS: CritterTraits = { size: 1, maxSpeed: 40, turnRate: 180 };

/**
 * A 2000 by 600 unit world of one terrain type with 10 unit cells. Elevation
 * rises evenly to the east by `rise` per column, so with lowland flatness 0 the
 * land climbs 1000 × rise ft per cell.
 */
function plainWorld(type: TerrainType, rise = 0): TerrainData {
  const cols = 200;
  const rows = 60;
  const cellSize = 10;
  const n = cols * rows;
  const levels = { sea: 0.5, shallow: 0.25, mountain: 2, peak: 1.5 };
  // Shallow water sits halfway down the shallow band.
  const base = type === TerrainType.ShallowWater ? 0.375 : 0.5;
  const elevation = Float32Array.from({ length: n }, (_, i) => base + (i % cols) * rise);
  const terrainType = new Uint8Array(n).fill(type);
  const grid = { cols, rows, cellSize, levels, peakHeight: 1000, lowlandFlatness: 0, elevation };
  return {
    ...grid,
    width: cols * cellSize,
    height: rows * cellSize,
    landformSize: 100,
    terrainType,
    temperature: new Float32Array(n),
    distanceToWater: new Float32Array(n),
    rainfall: new Float32Array(n),
    biome: new Uint8Array(n),
    ...slopeField(grid, terrainType),
  };
}

/** The center of a cell at least 100 units from any water. */
function inland(sim: Simulation): { x: number; y: number } {
  const { terrain } = sim;
  const i = terrain.distanceToWater.findIndex((d) => d > 100);
  if (i < 0) throw new Error("no inland cell");
  return { x: ((i % terrain.cols) + 0.5) * terrain.cellSize, y: (Math.floor(i / terrain.cols) + 0.5) * terrain.cellSize };
}

function critters(terrain: TerrainData, overrides: Partial<WorldConfig> = {}): Critters {
  return new Critters(terrain, makeConfig({ width: terrain.width, height: terrain.height, ...overrides }), new Rng(1), new Rng(2));
}

/** Drives the critter in a slot straight ahead at full thrust for a number of ticks, and returns its speed. */
function topSpeed(c: Critters, slot: number, heading: number, ticks = 45): number {
  c.heading[slot] = heading;
  c.setController(slot, ControllerKind.Keyboard);
  c.keyboard.set(0, 1);
  for (let t = 0; t < ticks; t++) {
    c.think();
    c.move();
  }
  return Math.hypot(c.vx[slot]!, c.vy[slot]!);
}

describe("critters", () => {
  it("never end up inside walls or deep water", () => {
    const sim = new Simulation({
      width: 800,
      height: 800,
      landformSize: 300,
      waterCoverage: 50,
      shallowWaterShare: 20,
      startingPlants: 0,
      startingCritters: 300,
      traitVariety: 150,
    });
    const { critters: c, terrain } = sim;
    expect(c.count).toBeGreaterThan(250);
    for (let t = 0; t < 30 * 40; t++) {
      sim.step();
      for (let i = 0; i < c.slots; i++) {
        if (c.alive[i] && !bodyFits(terrain, c.x[i]!, c.y[i]!, c.radius[i]!)) {
          throw new Error(`critter ${c.id[i]} at ${c.x[i]}, ${c.y[i]} overlaps a wall or deep water at tick ${sim.tick}`);
        }
      }
    }
  });

  it("follow the same trajectory from the same inputs", () => {
    const run = () => {
      const sim = new Simulation({ seed: 7, startingCritters: 50 });
      const spot = inland(sim);
      const id = sim.spawnCritter(spot.x, spot.y, TRAITS, ControllerKind.Keyboard);
      expect(id).toBeGreaterThan(0);
      const path: number[] = [];
      for (let t = 0; t < 600; t++) {
        sim.drive(Math.sin(t / 40), (t % 200) / 200);
        sim.step();
        const info = sim.critterInfo(id);
        path.push(info?.x ?? NaN, info?.y ?? NaN);
      }
      return { path, hash: sim.stateHash() };
    };
    const a = run();
    const b = run();
    expect(a.path).toEqual(b.path);
    expect(a.hash).toBe(b.hash);
  });

  it("turn by turn rate × dt at full turn", () => {
    const c = critters(plainWorld(TerrainType.Land));
    const slot = c.spawn(1000, 300, TRAITS, ControllerKind.Keyboard);
    c.heading[slot] = 1;
    c.keyboard.set(1, 0);
    for (let t = 0; t < 10; t++) {
      c.think();
      c.move();
    }
    expect(c.heading[slot]).toBeCloseTo(1 + 10 * Math.PI * (1 / 30), 10);
  });

  it("reach max speed on flat ground, and bigger critters take longer to get there", () => {
    const timeToSpeed = (size: number) => {
      const c = critters(plainWorld(TerrainType.Land));
      const slot = c.spawn(400, 300, { ...TRAITS, size }, ControllerKind.Keyboard);
      c.heading[slot] = 0;
      c.keyboard.set(0, 1);
      let ticks = 0;
      while (Math.hypot(c.vx[slot]!, c.vy[slot]!) < 40 - 1e-9 && ticks < 1000) {
        c.think();
        c.move();
        ticks++;
      }
      return ticks;
    };
    // 120 u/s² / size to reach 40 u/s: 10 ticks at size 1, 20 at size 2.
    expect(timeToSpeed(1)).toBe(10);
    expect(timeToSpeed(2)).toBe(20);
    expect(timeToSpeed(0.5)).toBe(5);
  });

  it("slow down on slopes by Tobler's function, uphill more than downhill", () => {
    // 0.02 elevation per cell is 20 ft per 10 units: a 2 ft/u slope, or 20% at a map scale of 10 ft/u.
    // Elevation is stored as Float32, so the slope is that to about 5 digits.
    const c = critters(plainWorld(TerrainType.Land, 0.02), { mapScale: 10 });
    const up = c.spawn(1000, 150, TRAITS, ControllerKind.Keyboard);
    const down = c.spawn(1000, 300, TRAITS, ControllerKind.Keyboard);
    const across = c.spawn(1000, 450, TRAITS, ControllerKind.Keyboard);
    c.heading[up] = 0;
    c.heading[down] = Math.PI;
    c.heading[across] = Math.PI / 2;
    topSpeed(c, up, 0);
    expect(Math.hypot(c.vx[up]!, c.vy[up]!)).toBeCloseTo(40 * slopeFactor(0.2, 3.5), 3);
    expect(Math.hypot(c.vx[down]!, c.vy[down]!)).toBeCloseTo(40 * slopeFactor(-0.2, 3.5), 3);
    expect(Math.hypot(c.vx[across]!, c.vy[across]!)).toBeCloseTo(40, 6);
  });

  it("wade more slowly the smaller they are", () => {
    const c = critters(plainWorld(TerrainType.ShallowWater));
    const small = c.spawn(1000, 150, { ...TRAITS, size: 0.5 }, ControllerKind.Keyboard);
    const large = c.spawn(1000, 400, { ...TRAITS, size: 2 }, ControllerKind.Keyboard);
    c.heading[small] = c.heading[large] = 0;
    topSpeed(c, small, 0, 60);
    expect(Math.hypot(c.vx[small]!, c.vy[small]!)).toBeCloseTo(40 * wadingFactor(0.5, 0.5, 1), 6);
    expect(Math.hypot(c.vx[large]!, c.vy[large]!)).toBeCloseTo(40 * wadingFactor(0.5, 2, 1), 6);
  });

  it("ignore turned-off slowdowns", () => {
    const c = critters(plainWorld(TerrainType.ShallowWater), { wadingSlowdown: false });
    const slot = c.spawn(1000, 300, TRAITS, ControllerKind.Keyboard);
    expect(topSpeed(c, slot, 0)).toBeCloseTo(40, 6);
  });

  it("slide along a wall instead of stopping dead", () => {
    const c = critters(plainWorld(TerrainType.Land));
    const slot = c.spawn(1000, 20, TRAITS, ControllerKind.Keyboard);
    // Heading northeast, into the top wall.
    topSpeed(c, slot, -Math.PI / 4, 60);
    expect(c.y[slot]).toBeCloseTo(5, 0);
    expect(c.vy[slot]).toBe(0);
    expect(c.vx[slot]).toBeGreaterThan(20);
    expect(c.blocked[slot]).toBe(1);
  });
});

describe("collisions", () => {
  const pair = (sizeA: number, sizeB: number, overrides: Partial<WorldConfig> = {}) => {
    const c = critters(plainWorld(TerrainType.Land), overrides);
    const a = c.spawn(1000, 300, { ...TRAITS, size: sizeA }, ControllerKind.Idle);
    const b = c.spawn(1004, 300, { ...TRAITS, size: sizeB }, ControllerKind.Idle);
    c.think();
    c.move();
    return { moveA: 1000 - c.x[a]!, moveB: c.x[b]! - 1004, c, a, b };
  };

  it("push overlapping critters apart, evenly when they weigh the same", () => {
    const { moveA, moveB } = pair(1, 1);
    expect(moveA).toBeGreaterThan(0);
    expect(moveB).toBeCloseTo(moveA, 12);
    // Overlap 6, and about half of it goes in one tick at the default push-apart time.
    expect(moveA + moveB).toBeCloseTo(6 * (1 - Math.exp(-1 / 30 / 0.05)), 10);
  });

  it("move the heavier critter less, by the ratio of their masses", () => {
    const { moveA, moveB } = pair(2, 1);
    expect(moveB / moveA).toBeCloseTo(8, 8);
  });

  it("separate overlapping critters fully over time", () => {
    const c = critters(plainWorld(TerrainType.Land));
    const a = c.spawn(1000, 300, TRAITS, ControllerKind.Idle);
    const b = c.spawn(1001, 300.5, TRAITS, ControllerKind.Idle);
    for (let t = 0; t < 60; t++) {
      c.think();
      c.move();
    }
    expect(Math.hypot(c.x[b]! - c.x[a]!, c.y[b]! - c.y[a]!)).toBeGreaterThan(9.99);
  });

  it("let critters pass through each other when off", () => {
    const { moveA, moveB } = pair(1, 1, { collisions: false });
    expect(moveA).toBe(0);
    expect(moveB).toBe(0);
  });

  it("don't depend on the order critters were added", () => {
    const run = (order: number[]) => {
      const c = critters(plainWorld(TerrainType.Land));
      const spots = [
        [1000, 300],
        [1006, 302],
        [1003, 307],
      ];
      for (const k of order) c.spawn(spots[k]![0]!, spots[k]![1]!, TRAITS, ControllerKind.Idle);
      for (let t = 0; t < 5; t++) {
        c.think();
        c.move();
      }
      return order.map((_, k) => [c.x[order.indexOf(k)]!, c.y[order.indexOf(k)]!]);
    };
    const forward = run([0, 1, 2]);
    const backward = run([2, 1, 0]);
    forward.forEach(([x, y], k) => {
      expect(backward[k]![0]).toBeCloseTo(x!, 9);
      expect(backward[k]![1]).toBeCloseTo(y!, 9);
    });
  });
});

describe("simulation critters", () => {
  it("scatters the starting critters with traits varied around the defaults", () => {
    const sim = new Simulation({ startingCritters: 200, traitVariety: 50 });
    const { critters: c } = sim;
    expect(c.count).toBe(200);
    for (let i = 0; i < c.slots; i++) {
      expect(c.size[i]).toBeGreaterThanOrEqual(1 / 1.5 - 1e-9);
      expect(c.size[i]).toBeLessThanOrEqual(1.5 + 1e-9);
      expect(c.maxSpeed[i]).toBeGreaterThanOrEqual(40 / 1.5 - 1e-9);
      expect(c.turnRate[i]).toBeLessThanOrEqual(180 * 1.5 + 1e-9);
    }
  });

  it("spawns only where the body fits, and picks, inspects, and removes by id", () => {
    const sim = new Simulation({ startingCritters: 0, waterCoverage: 0 });
    expect(sim.spawnCritter(2, 2, TRAITS, ControllerKind.Idle)).toBe(-1);
    const id = sim.spawnCritter(1500, 1500, TRAITS, ControllerKind.Idle);
    expect(id).toBeGreaterThan(0);
    expect(sim.critterAt(1500 + 5 + 2, 1500, 3)).toBe(id);
    expect(sim.critterAt(1500 + 5 + 4, 1500, 3)).toBe(-1);
    expect(sim.critterInfo(id)?.mass).toBe(1);
    expect(sim.snapshot().critters.count).toBe(1);
    expect(sim.removeCritter(id)).toBe(true);
    expect(sim.critterInfo(id)).toBeNull();
    expect(sim.snapshot().critters.count).toBe(0);
  });

  it("applies movement knobs live", () => {
    const sim = new Simulation({ startingCritters: 0 });
    sim.updateConfig({ collisions: false, acceleration: 300, mapScale: 50 });
    expect(sim.config.collisions).toBe(false);
    expect(sim.config.acceleration).toBe(300);
    expect(sim.config.mapScale).toBe(50);
  });
});
