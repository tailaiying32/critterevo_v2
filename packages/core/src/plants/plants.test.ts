import { describe, expect, it } from "vitest";
import type { WorldConfig } from "../config.js";
import { Simulation } from "../simulation.js";
import { Biome } from "../terrain/biomes.js";
import { isWater, type TerrainType } from "../terrain/types.js";
import { PLANT_UPDATE_STRIDE, PRODUCTIVITY_KNOBS } from "./plants.js";

/** A small world with landforms sized to it, so tests stay fast. */
const world = (overrides: Partial<WorldConfig> = {}) =>
  new Simulation({ width: 600, height: 600, landformSize: 300, startingPlants: 300, ...overrides });

/** A world with no plants and nothing that adds or removes them on its own. */
const quiet = (overrides: Partial<WorldConfig> = {}) =>
  world({ startingPlants: 0, localSeeding: false, longDistanceDispersal: false, plantAging: false, ...overrides });

/** Every biome's productivity set to one value. */
const allProductivity = (npp: number): Partial<WorldConfig> =>
  Object.fromEntries(Object.values(PRODUCTIVITY_KNOBS).map((knob) => [knob, npp]));

/** The center of some land cell. */
function landPoint(sim: Simulation): { x: number; y: number } {
  const { terrain } = sim;
  const i = terrain.biome.findIndex((b) => b !== Biome.None);
  return { x: ((i % terrain.cols) + 0.5) * terrain.cellSize, y: (Math.floor(i / terrain.cols) + 0.5) * terrain.cellSize };
}

function livingSlots(sim: Simulation): number[] {
  const slots: number[] = [];
  for (let i = 0; i < sim.plants.slots; i++) if (sim.plants.alive[i]) slots.push(i);
  return slots;
}

describe("plants", () => {
  it("spread from a few plants to fill the land, then level off", () => {
    const sim = world({ startingPlants: 20 });
    expect(sim.plants.count).toBe(20);
    sim.stepMany(30 * 1200);
    const settled = sim.plants.count;
    expect(settled).toBeGreaterThan(20 * 20);
    sim.stepMany(30 * 900);
    expect(Math.abs(sim.plants.count - settled) / settled).toBeLessThan(0.1);
  });

  it("never take root on water or where the ground is already as crowded as the biome allows", () => {
    const sim = world();
    const { plants, terrain } = sim;
    const place = plants.place.bind(plants);
    let placed = 0;
    plants.place = (x, y, share) => {
      const crowd = plants.index.countWithin(x, y, sim.config.crowdingRadius);
      const slot = place(x, y, share);
      if (slot >= 0) {
        placed++;
        expect(crowd).toBeLessThan(plants.capacityIn(plants.biome[slot] as Biome));
      }
      return slot;
    };
    sim.stepMany(30 * 300);
    expect(placed).toBeGreaterThan(100);
    for (const slot of livingSlots(sim)) {
      const col = Math.floor(plants.x[slot]! / terrain.cellSize);
      const row = Math.floor(plants.y[slot]! / terrain.cellSize);
      expect(isWater(terrain.terrainType[row * terrain.cols + col] as TerrainType)).toBe(false);
    }
  });

  it("are denser where productivity is higher", () => {
    const sim = world();
    expect(sim.plants.capacityIn(Biome.Rainforest)).toBeGreaterThan(sim.plants.capacityIn(Biome.Grassland));
    expect(sim.plants.capacityIn(Biome.Grassland)).toBeGreaterThan(sim.plants.capacityIn(Biome.Desert));
    // Density scales with the square root of productivity: desert (90) holds about a fifth of rainforest (2,200).
    expect(sim.plants.capacityIn(Biome.Desert) / sim.plants.capacityIn(Biome.Rainforest)).toBeCloseTo(Math.sqrt(90 / 2200), 6);
  });

  it("never grow where productivity is 0", () => {
    const sim = world(allProductivity(0));
    expect(sim.plants.count).toBe(0);
    sim.stepMany(3000);
    expect(sim.plants.count).toBe(0);
  });

  it("regrow from 10% to 90% in the regrowth time at rainforest productivity, and slower where less productive", () => {
    const timeTo90 = (npp: number) => {
      const sim = quiet({ ...allProductivity(npp), regrowthTime: 60 });
      const p = landPoint(sim);
      const slot = sim.plants.place(p.x, p.y, 0.1);
      expect(slot).toBeGreaterThanOrEqual(0);
      while (sim.plants.energy[slot]! < 0.9 * sim.config.plantEnergy) sim.step();
      return sim.time;
    };
    expect(timeTo90(2200)).toBeCloseTo(60, -0.5);
    // A quarter of the productivity grows at half the rate.
    expect(timeTo90(550)).toBeCloseTo(120, -0.5);
  });

  it("die when grazed below the root reserve, and survive and regrow when grazed above it", () => {
    const sim = quiet({ rootReserve: 20 });
    const p = landPoint(sim);
    const a = sim.plants.place(p.x, p.y, 1);
    expect(sim.plants.bite(a, 70)).toBe(70);
    expect(sim.plants.alive[a]).toBe(1);
    sim.stepMany(30 * 10);
    expect(sim.plants.energy[a]).toBeGreaterThan(30);

    const before = sim.plants.energy[a]!;
    expect(sim.plants.bite(a, before - 15)).toBeCloseTo(before - 15, 10);
    expect(sim.plants.alive[a]).toBe(0);
    expect(sim.plants.count).toBe(0);
  });

  it("are grazed down to a level by the graze brush, surviving above the root reserve", () => {
    const sim = quiet({ rootReserve: 10, plantDensity: 500, ...allProductivity(2200) });
    const p = landPoint(sim);
    const a = sim.plants.place(p.x, p.y, 1);
    const b = sim.plants.place(p.x + 3, p.y, 0.3);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThanOrEqual(0);
    sim.graze(p.x, p.y, 10, 0.5);
    expect(sim.plants.energy[a]).toBeCloseTo(0.5 * sim.config.plantEnergy, 10);
    expect(sim.plants.energy[b]).toBeCloseTo(0.3 * sim.config.plantEnergy, 10);
    sim.graze(p.x, p.y, 10, 0.05);
    expect(sim.plants.count).toBe(0);
  });

  it("are stripped and killed by the graze brush only within its radius", () => {
    const sim = world();
    sim.stepMany(30 * 300);
    const center = { x: 300, y: 300 };
    const inside = livingSlots(sim).filter((s) => Math.hypot(sim.plants.x[s]! - center.x, sim.plants.y[s]! - center.y) <= 100);
    const outside = livingSlots(sim).length - inside.length;
    expect(inside.length).toBeGreaterThan(0);
    sim.graze(center.x, center.y, 100, 0);
    expect(sim.plants.count).toBe(outside);
    expect(sim.plants.index.countWithin(center.x, center.y, 100)).toBe(0);
  });

  it("live forever with lifespan off, and die by their lifespan with it on", () => {
    const ageless = world({ localSeeding: false, longDistanceDispersal: false, plantAging: false });
    const start = ageless.plants.count;
    ageless.stepMany(30 * 1000);
    expect(ageless.plants.count).toBe(start);

    const mortal = world({ localSeeding: false, longDistanceDispersal: false, plantLifespan: 20 });
    mortal.stepMany(30 * 5);
    expect(mortal.plants.count).toBeLessThan(start);
    expect(mortal.plants.count).toBeGreaterThan(0);
    // Lifespans run from half to one and a half times the mean.
    mortal.stepMany(30 * 25 + PLANT_UPDATE_STRIDE);
    expect(mortal.plants.count).toBe(0);
  });

  it("recolonize a fully stripped world only with long-distance dispersal", () => {
    const run = (longDistanceDispersal: boolean) => {
      const sim = world({ longDistanceDispersal, longDistanceRate: 20 });
      sim.stepMany(30 * 100);
      sim.graze(300, 300, 1000, 0);
      expect(sim.plants.count).toBe(0);
      sim.stepMany(30 * 300);
      return sim.plants.count;
    };
    expect(run(false)).toBe(0);
    expect(run(true)).toBeGreaterThan(50);
  });

  it("sow fully grown plants with the plant brush, never on water", () => {
    const sim = quiet();
    const p = landPoint(sim);
    expect(sim.sow(p.x, p.y, 30)).toBeGreaterThan(0);
    for (const slot of livingSlots(sim)) expect(sim.plants.energy[slot]).toBe(sim.config.plantEnergy);
    const water = sim.terrain.terrainType.findIndex((t) => isWater(t as TerrainType));
    const { cols, cellSize } = sim.terrain;
    const before = sim.plants.count;
    sim.plants.place(((water % cols) + 0.5) * cellSize, (Math.floor(water / cols) + 0.5) * cellSize, 1);
    expect(sim.plants.count).toBe(before);
  });
});

describe("simulation with plants", () => {
  it("is deterministic: same seed and config, same hash after many ticks", () => {
    const a = world({ seed: 5 });
    const b = world({ seed: 5 });
    a.stepMany(30 * 200);
    b.stepMany(30 * 200);
    expect(a.plants.count).toBeGreaterThan(300);
    expect(a.stateHash()).toBe(b.stateHash());
  });

  it("changes the hash when the plants change", () => {
    const a = world({ seed: 5 });
    const b = world({ seed: 5 });
    a.stepMany(300);
    b.stepMany(300);
    b.graze(300, 300, 50, 0.5);
    expect(a.stateHash()).not.toBe(b.stateHash());
  });

  it("applies live knob changes at once and ignores ones that need a new world", () => {
    const sim = world();
    const config = sim.updateConfig({ plantDensity: 7, localSeeding: false, width: 999, startingPlants: 5 });
    expect(config.plantDensity).toBe(7);
    expect(config.localSeeding).toBe(false);
    expect(config.width).toBe(600);
    expect(config.startingPlants).toBe(300);
    expect(sim.config).toBe(config);
  });

  it("records plant stats from tick 0, with per-biome counts adding up to the total", () => {
    const sim = world();
    sim.stepMany(300);
    const rows = sim.stats.rows();
    const ticks = sim.stats.column("tick");
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(300);
    const last = rows.data.map((column) => column[column.length - 1]!);
    const byName = (name: string) => last[rows.columns.indexOf(name)]!;
    expect(byName("plants")).toBe(sim.plants.count);
    const perBiome = rows.columns.filter((c) => c.startsWith("plants.")).reduce((sum, c) => sum + byName(c), 0);
    expect(perBiome).toBe(sim.plants.count);
  });
});
