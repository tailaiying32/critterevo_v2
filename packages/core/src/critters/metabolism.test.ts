import { describe, expect, it } from "vitest";
import { makeConfig, type WorldConfig } from "../config.js";
import { CORPSE_REMAINDER, Corpses } from "../corpses/corpses.js";
import { Plants } from "../plants/plants.js";
import { Rng } from "../rng.js";
import { Simulation } from "../simulation.js";
import { STATS_COLUMNS } from "../stats.js";
import { Biome } from "../terrain/biomes.js";
import { TerrainType, type TerrainData } from "../terrain/types.js";
import { ControllerKind } from "./controllers.js";
import { Critters, DeathCause, type CritterTraits } from "./critters.js";
import { COST_TERM_COUNT, CostTerm, costsOf, maxAgeOf, maxEnergyOf, MIN_TERRAIN_FACTOR, WATER_PER_MASS } from "./metabolism.js";

const TRAITS: CritterTraits = { size: 1, maxSpeed: 40, turnRate: 180 };
const DEFAULTS = makeConfig();
/** Basal rate of a size 1 critter at the defaults, in energy per second. */
const UNIT = DEFAULTS.energyStorage / DEFAULTS.fastingTime;
/** Every cost turned off. */
const NO_COSTS: Partial<WorldConfig> = { basalCost: false, traitUpkeep: false, movementCost: false, terrainCost: false, thermalCost: false };

/**
 * A flat 2000 by 600 unit world with 10 unit cells, all at one temperature:
 * shallow water in the first waterCols columns, the rest rainforest.
 */
function flatWorld({ temperature = 60, waterCols = 0 } = {}): TerrainData {
  const cols = 200;
  const rows = 60;
  const cellSize = 10;
  const n = cols * rows;
  const levels = { sea: 0.5, shallow: 0.25, mountain: 2, peak: 1.5 };
  const elevation = new Float32Array(n);
  const terrainType = new Uint8Array(n);
  const biome = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const water = i % cols < waterCols;
    // Shallow water a fifth of the way down the shallow band.
    elevation[i] = water ? 0.45 : 0.5;
    terrainType[i] = water ? TerrainType.ShallowWater : TerrainType.Land;
    biome[i] = water ? Biome.None : Biome.Rainforest;
  }
  return {
    cols,
    rows,
    cellSize,
    levels,
    peakHeight: 1000,
    lowlandFlatness: 0,
    elevation,
    width: cols * cellSize,
    height: rows * cellSize,
    landformSize: 100,
    terrainType,
    temperature: new Float32Array(n).fill(temperature),
    distanceToWater: new Float32Array(n),
    rainfall: new Float32Array(n),
    biome,
    slopeX: new Float32Array(n),
    slopeY: new Float32Array(n),
  };
}

/** Critters, plants, and corpses on a test world, stepped through the critter phases of a tick. Plants don't grow. */
function kit(terrain: TerrainData, overrides: Partial<WorldConfig> = {}) {
  const config = makeConfig({ width: terrain.width, height: terrain.height, ...overrides });
  const critters = new Critters(terrain, config, new Rng(1), new Rng(2), new Rng(3));
  const plants = new Plants(terrain, config, new Rng(4));
  const corpses = new Corpses(terrain, config);
  let tick = 0;
  const step = () => {
    tick++;
    critters.think();
    critters.move();
    critters.feed(plants);
    critters.metabolize();
    critters.die(corpses, tick);
    corpses.step();
  };
  return { config, critters, plants, corpses, step };
}

/**
 * Expects a count of ticks to be a time in seconds, or one tick more: summing
 * dt tick by tick can leave a hair short of a round number.
 */
function expectTicks(ticks: number, seconds: number): void {
  const expected = Math.ceil(seconds / DEFAULTS.dt - 1e-9);
  expect(ticks).toBeGreaterThanOrEqual(expected);
  expect(ticks).toBeLessThanOrEqual(expected + 1);
}

/** Steps until the critter in a slot dies, up to a limit. Returns the ticks taken, or -1. */
function ticksToDeath(k: ReturnType<typeof kit>, slot: number, limit: number): number {
  for (let t = 1; t <= limit; t++) {
    k.step();
    if (!k.critters.alive[slot]) return t;
  }
  return -1;
}

describe("energy costs", () => {
  it("make basal cost grow with mass but fall per unit of mass (Kleiber's law)", () => {
    const basal = (size: number) => costsOf(DEFAULTS, { size }).terms[CostTerm.Basal]!;
    expect(basal(1)).toBeCloseTo(UNIT, 12);
    expect(basal(2) / basal(1)).toBeCloseTo(Math.pow(8, 0.75), 10);
    expect(basal(0.5)).toBeLessThan(basal(1));
    expect(basal(1)).toBeLessThan(basal(2));
    expect(basal(0.5) / 0.125).toBeGreaterThan(basal(1));
    expect(basal(1)).toBeGreaterThan(basal(2) / 8);
  });

  it("make larger bodies pay less thermal cost per unit of mass in the cold", () => {
    const thermal = (size: number) => costsOf(DEFAULTS, { size, temperature: 0 }).terms[CostTerm.Thermal]!;
    expect(thermal(1)).toBeGreaterThan(0);
    expect(thermal(2) / thermal(1)).toBeCloseTo(4, 10);
    expect(thermal(2) / 8).toBeLessThan(thermal(1));
    expect(thermal(1)).toBeLessThan(thermal(0.5) / 0.125);
  });

  it("charge only the degrees beyond the comfort band", () => {
    const config = makeConfig({ comfortTemperature: 60, comfortBand: 10, coldCost: 3, heatCost: 2 });
    const thermal = (temperature: number) => costsOf(config, { size: 1, temperature }).terms[CostTerm.Thermal]!;
    for (const t of [50, 55, 60, 65, 70]) expect(thermal(t)).toBe(0);
    expect(thermal(49)).toBeCloseTo(0.03 * UNIT, 12);
    expect(thermal(40)).toBeCloseTo(10 * 0.03 * UNIT, 12);
    expect(thermal(75)).toBeCloseTo(5 * 0.02 * UNIT, 12);
  });

  it("make sprinting cost four times what moving at half the speed does", () => {
    const movement = (speed: number, size = 1) => costsOf(DEFAULTS, { size, speed }).terms[CostTerm.Movement]!;
    expect(movement(0)).toBe(0);
    expect(movement(40)).toBeCloseTo(DEFAULTS.runningCost * UNIT, 12);
    expect(movement(40) / movement(20)).toBeCloseTo(4, 12);
    expect(movement(40, 2) / movement(40)).toBeCloseTo(8, 12);
  });

  it("charge nothing for terrain on flat, dry ground, and divide the cost per distance by the slowdown", () => {
    const costs = (terrainFactor: number) => costsOf(DEFAULTS, { size: 1, speed: 20, terrainFactor }).terms;
    expect(costs(1)[CostTerm.Terrain]).toBe(0);
    const half = costs(0.5);
    expect(half[CostTerm.Terrain]).toBeCloseTo(half[CostTerm.Movement]!, 12);
    const stuck = costs(0.01);
    expect(stuck[CostTerm.Terrain]).toBeCloseTo(stuck[CostTerm.Movement]! * (1 / MIN_TERRAIN_FACTOR - 1), 12);
  });

  it("charge upkeep for top speed and turn rate, growing with mass", () => {
    const traits = (size: number) => costsOf(DEFAULTS, { size, maxSpeed: 40, turnRate: 180 }).terms[CostTerm.Traits]!;
    // 5% of basal per 10 u/s and per 100°/s.
    expect(traits(1)).toBeCloseTo((0.2 + 0.09) * UNIT, 12);
    expect(traits(2) / traits(1)).toBeCloseTo(8, 12);
  });

  it("charge nothing for costs that are turned off", () => {
    const busy = { size: 1.5, maxSpeed: 50, turnRate: 200, speed: 30, terrainFactor: 0.5, temperature: 10 };
    const on = costsOf(DEFAULTS, busy).terms;
    const cases: [keyof WorldConfig, CostTerm][] = [
      ["basalCost", CostTerm.Basal],
      ["traitUpkeep", CostTerm.Traits],
      ["movementCost", CostTerm.Movement],
      ["terrainCost", CostTerm.Terrain],
      ["thermalCost", CostTerm.Thermal],
    ];
    for (const [knob, term] of cases) {
      expect(on[term]).toBeGreaterThan(0);
      const off = costsOf(makeConfig({ [knob]: false }), busy).terms;
      expect(off[term]).toBe(0);
      // The others don't change.
      for (let t = 0; t < COST_TERM_COUNT; t++) if (t !== term) expect(off[t]).toBe(on[t]);
    }
    expect(on[CostTerm.Brain]).toBe(0);
    expect(on[CostTerm.Senses]).toBe(0);
  });
});

describe("eating and drinking", () => {
  it("change a critter's energy each tick by what it ate minus the sum of its costs", () => {
    // Cold enough to cost, with a line of plants on land and shallow water to wade through.
    const k = kit(flatWorld({ temperature: 30, waterCols: 50 }));
    const { critters: c, plants } = k;
    for (let x = 1110; x < 1800; x += 25) plants.place(x, 300, 1);
    const eater = c.spawn(1100, 300, TRAITS, ControllerKind.Keyboard);
    const wader = c.spawn(250, 300, { ...TRAITS, size: 1.3 }, ControllerKind.Keyboard);
    c.heading[eater] = 0;
    c.heading[wader] = Math.PI / 2;
    c.energy[eater] = 200;
    c.keyboard.set(0, 1);

    const seen = new Float64Array(COST_TERM_COUNT);
    let ate = 0;
    for (let t = 0; t < 300; t++) {
      const before = [c.energy[eater]!, c.energy[wader]!];
      const water = [c.water[eater]!, c.water[wader]!];
      k.step();
      [eater, wader].forEach((slot, n) => {
        let spent = 0;
        for (let term = 0; term < COST_TERM_COUNT; term++) {
          const cost = c.costs[slot * COST_TERM_COUNT + term]!;
          spent += cost;
          seen[term] = Math.max(seen[term]!, cost);
        }
        expect(c.energy[slot]! - before[n]!).toBeCloseTo(c.intake[slot]! - spent, 10);
        expect(c.water[slot]! - water[n]!).toBeCloseTo(c.waterIn[slot]! - c.waterOut[slot]!, 10);
        expect(c.waterOut[slot]).toBeCloseTo((spent * WATER_PER_MASS) / DEFAULTS.thirstTime / UNIT, 10);
      });
      ate += c.intake[eater]!;
    }
    expect(ate).toBeGreaterThan(100);
    for (const term of [CostTerm.Basal, CostTerm.Traits, CostTerm.Movement, CostTerm.Terrain, CostTerm.Thermal]) expect(seen[term]).toBeGreaterThan(0);
  });

  it("bite the fullest plant in reach, at the bite rate, until full", () => {
    // Dense enough that crowding all but never turns away the plants placed here.
    const k = kit(flatWorld(), { reach: 3, plantDensity: 500 });
    const { critters: c, plants, config } = k;
    const slot = c.spawn(1000, 300, TRAITS, ControllerKind.Idle);
    const far = plants.place(1000, 290, 1);
    const half = plants.place(1006, 300, 0.5);
    const full = plants.place(1000, 307.5, 1);
    expect(Math.min(far, half, full)).toBeGreaterThanOrEqual(0);
    c.energy[slot] = maxEnergyOf(1, config) - 10;
    k.step();
    const bite = config.biteRate * config.dt;
    expect(c.intake[slot]).toBeCloseTo(bite, 12);
    expect(plants.energy[full]).toBeCloseTo(100 - bite, 12);
    expect(plants.energy[half]).toBe(50);
    expect(plants.energy[far]).toBe(100);
    // Once full, it stops eating.
    for (let t = 0; t < 30; t++) k.step();
    expect(c.energy[slot]).toBeGreaterThan(maxEnergyOf(1, config) - 1);
    const left = plants.energy[full]! + plants.energy[half]!;
    c.energy[slot] = maxEnergyOf(1, config);
    k.step();
    expect(c.intake[slot]).toBe(0);
    expect(plants.energy[full]! + plants.energy[half]!).toBe(left);
  });

  it("kill a plant grazed below its root reserve", () => {
    const k = kit(flatWorld(), NO_COSTS);
    const { critters: c, plants } = k;
    const slot = c.spawn(1000, 300, TRAITS, ControllerKind.Idle);
    const plant = plants.place(1004, 300, 0.11);
    c.energy[slot] = 10;
    k.step();
    expect(plants.alive[plant]).toBe(0);
    expect(c.intake[slot]).toBeCloseTo(DEFAULTS.biteRate * DEFAULTS.dt, 12);
  });

  it("get water from plants when they hold some", () => {
    const k = kit(flatWorld(), { ...NO_COSTS, plantWater: 50 });
    const { critters: c, plants } = k;
    const slot = c.spawn(1000, 300, TRAITS, ControllerKind.Idle);
    plants.place(1004, 300, 1);
    c.energy[slot] = 10;
    c.water[slot] = 10;
    k.step();
    // Half a size 1 critter's water per full plant.
    expect(c.waterIn[slot]).toBeCloseTo((c.intake[slot]! / 100) * 50, 12);
  });

  it("drink only within reach of water, filling up in the drink time", () => {
    // Water covers x below 1000. Reach is radius 5 plus 3.
    const k = kit(flatWorld({ waterCols: 100 }), { ...NO_COSTS, thirst: false, reach: 3 });
    const { critters: c } = k;
    const near = c.spawn(1008, 100, TRAITS, ControllerKind.Idle);
    const far = c.spawn(1008.5, 300, TRAITS, ControllerKind.Idle);
    c.water[near] = c.water[far] = 1e-9;
    k.step();
    expect(c.waterIn[near]).toBeCloseTo((WATER_PER_MASS / DEFAULTS.drinkTime) * DEFAULTS.dt, 12);
    expect(c.waterIn[far]).toBe(0);
    let ticks = 1;
    while (c.water[near]! < WATER_PER_MASS && ticks < 1000) {
      k.step();
      ticks++;
    }
    expect(ticks).toBe(Math.round(DEFAULTS.drinkTime / DEFAULTS.dt));
  });
});

describe("death", () => {
  it("comes from starvation after the fasting time, resting at a comfortable temperature", () => {
    const k = kit(flatWorld(), { traitUpkeep: false, thirst: false });
    const slot = k.critters.spawn(1000, 300, TRAITS, ControllerKind.Idle);
    expectTicks(ticksToDeath(k, slot, 20000), DEFAULTS.fastingTime);
    expect(k.critters.deaths[DeathCause.Starvation]).toBe(1);
  });

  it("comes from thirst after the thirst time, and sooner when moving", () => {
    const resting = kit(flatWorld(), { traitUpkeep: false });
    const slot = resting.critters.spawn(1000, 300, TRAITS, ControllerKind.Idle);
    expectTicks(ticksToDeath(resting, slot, 20000), DEFAULTS.thirstTime);
    expect(resting.critters.deaths[DeathCause.Dehydration]).toBe(1);

    const running = kit(flatWorld(), { traitUpkeep: false });
    const runner = running.critters.spawn(100, 300, TRAITS, ControllerKind.Keyboard);
    running.critters.heading[runner] = 0;
    running.critters.keyboard.set(0, 0.5);
    // Bounces along the east wall once it gets there; it still dies of thirst first.
    const ticks = ticksToDeath(running, runner, 20000);
    expect(ticks).toBeGreaterThan(0);
    expect(ticks).toBeLessThan(DEFAULTS.thirstTime / DEFAULTS.dt / 1.5);
    expect(running.critters.deaths[DeathCause.Dehydration]).toBe(1);
  });

  it("comes from old age at a lifespan growing with mass^0.25", () => {
    expect(maxAgeOf(16, { critterLifespan: 100 })).toBeCloseTo(200, 10);
    const k = kit(flatWorld(), { ...NO_COSTS, thirst: false, critterLifespan: 10 });
    const small = k.critters.spawn(500, 300, TRAITS, ControllerKind.Idle);
    const large = k.critters.spawn(1000, 300, { ...TRAITS, size: 2 }, ControllerKind.Idle);
    const smallTicks = ticksToDeath(k, small, 1000);
    expectTicks(smallTicks, 10);
    expectTicks(smallTicks + ticksToDeath(k, large, 1000), 10 * Math.pow(8, 0.25));
    expect(k.critters.deaths[DeathCause.OldAge]).toBe(2);
  });

  it("never comes from old age while aging is off", () => {
    const k = kit(flatWorld(), { ...NO_COSTS, thirst: false, critterLifespan: 10, critterAging: false });
    const slot = k.critters.spawn(500, 300, TRAITS, ControllerKind.Idle);
    expect(ticksToDeath(k, slot, 1000)).toBe(-1);
    expect(k.critters.age[slot]).toBe(0);
  });

  it("leaves a corpse with energy in proportion to mass, which halves every half-life and is then gone", () => {
    const k = kit(flatWorld(), { corpseHalfLife: 2 });
    const { critters: c, corpses, config } = k;
    const slot = c.spawn(1000, 300, { ...TRAITS, size: 2 }, ControllerKind.Idle);
    c.energy[slot] = 0;
    k.step();
    expect(c.alive[slot]).toBe(0);
    expect(corpses.count).toBe(1);
    expect(corpses.x[0]).toBe(1000);
    expect(corpses.radius[0]).toBe(10);
    // It decayed for one tick already.
    const start = config.corpseEnergy * 8;
    const halfLife = Math.round(2 / config.dt);
    expect(corpses.energy[0]).toBeCloseTo(start * Math.pow(0.5, 1 / halfLife), 6);
    for (let t = 1; t < halfLife; t++) k.step();
    expect(corpses.energy[0]).toBeCloseTo(start / 2, 6);
    const ticksLeft = Math.ceil(Math.log(CORPSE_REMAINDER) / Math.log(0.5 ** (1 / halfLife))) - halfLife;
    for (let t = 1; t < ticksLeft; t++) k.step();
    expect(corpses.count).toBe(1);
    k.step();
    expect(corpses.count).toBe(0);
  });

  it("leaves corpses that stay while decay is off", () => {
    const k = kit(flatWorld(), { corpseDecay: false });
    const slot = k.critters.spawn(1000, 300, TRAITS, ControllerKind.Idle);
    k.critters.water[slot] = 0;
    for (let t = 0; t < 3000; t++) k.step();
    expect(k.corpses.count).toBe(1);
    expect(k.corpses.energy[0]).toBe(k.config.corpseEnergy);
  });
});

describe("simulation metabolism", () => {
  /** A small world with settled-looking plants and many wanderers, set to die fast. */
  const busy = (overrides: Partial<WorldConfig> = {}) =>
    new Simulation({ width: 800, height: 800, landformSize: 300, startingPlants: 3000, startingCritters: 150, fastingTime: 20, ...overrides });

  it("is deterministic with eating, deaths, and corpses", () => {
    const a = busy({ seed: 9 });
    const b = busy({ seed: 9 });
    a.stepMany(1500);
    b.stepMany(1500);
    expect(a.stateHash()).toBe(b.stateHash());
    expect(a.critters.deaths.reduce((x, y) => x + y)).toBeGreaterThan(0);
    expect(a.critters.eaten).toBeGreaterThan(0);
    expect(a.corpses.count).toBeGreaterThan(0);
  });

  it("remembers how each critter died, but not removed critters, which leave no corpse", () => {
    const sim = new Simulation({ startingCritters: 0, waterCoverage: 0, startingPlants: 0 });
    const thirsty = sim.spawnCritter(1500, 1500, TRAITS, ControllerKind.Idle);
    const removed = sim.spawnCritter(2500, 2500, TRAITS, ControllerKind.Idle);
    sim.critters.water[sim.critters.slotOf(thirsty)] = 0;
    sim.step();
    expect(sim.critterInfo(thirsty)).toBeNull();
    expect(sim.critterDeath(thirsty)).toMatchObject({ id: thirsty, cause: DeathCause.Dehydration, tick: 1, x: 1500, y: 1500 });
    expect(sim.corpses.count).toBe(1);
    sim.removeCritter(removed);
    sim.step();
    expect(sim.critterDeath(removed)).toBeNull();
    expect(sim.corpses.count).toBe(1);
  });

  it("records population, deaths by cause, and energy flow as running totals", () => {
    const sim = busy();
    sim.stepMany(900);
    const last = (column: string) => sim.stats.column(column).at(-1)!;
    expect(sim.stats.column(STATS_COLUMNS.critters)[0]).toBe(150);
    expect(last(STATS_COLUMNS.critters)).toBe(sim.critters.count);
    const deaths = [0, 1, 2, 3].reduce((sum, cause) => sum + last(STATS_COLUMNS.deathsBy(cause)), 0);
    expect(deaths).toBe(150 - sim.critters.count);
    expect(last(STATS_COLUMNS.eaten)).toBe(sim.critters.eaten);
    expect(last(STATS_COLUMNS.spentOn(CostTerm.Basal))).toBe(sim.critters.spent[CostTerm.Basal]);
    expect(last(STATS_COLUMNS.corpses)).toBe(sim.corpses.count);
  });

  it("applies metabolism knobs live", () => {
    const sim = new Simulation({ startingCritters: 0 });
    sim.updateConfig({ thirst: false, fastingTime: 60, corpseHalfLife: 5, critterLifespan: 100 });
    expect(sim.config.thirst).toBe(false);
    expect(sim.config.fastingTime).toBe(60);
    expect(sim.config.corpseHalfLife).toBe(5);
    expect(sim.config.critterLifespan).toBe(100);
  });
});
