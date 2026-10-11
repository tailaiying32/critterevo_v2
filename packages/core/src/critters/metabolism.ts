import type { WorldConfig } from "../config.js";
import { isWater, type TerrainData, type TerrainType } from "../terrain/types.js";

/** Water a size 1 critter can hold. Water has no other unit, so a size 1 critter's water reads as a percentage. */
export const WATER_PER_MASS = 100;
/** The running cost knob is the cost of moving at this speed, in u/s. */
export const RUNNING_SPEED = 40;
/** Speed upkeep is charged per this much max speed, in u/s. */
const SPEED_UPKEEP_STEP = 10;
/** Turn upkeep is charged per this much turn rate, in °/s. */
const TURN_UPKEEP_STEP = 100;
/** Slow ground raises the cost per unit of distance at most as if it slowed critters to this share of full speed. */
export const MIN_TERRAIN_FACTOR = 0.1;

/** The terms of the energy budget (docs/DESIGN.md §9), in the order they are stored. */
export const CostTerm = {
  Basal: 0,
  Brain: 1,
  Senses: 2,
  Traits: 3,
  Movement: 4,
  Terrain: 5,
  Thermal: 6,
} as const;
export type CostTerm = (typeof CostTerm)[keyof typeof CostTerm];

export const COST_TERM_NAMES: readonly string[] = ["Basal", "Brain", "Senses", "Traits", "Movement", "Terrain", "Thermal"];
export const COST_TERM_COUNT = COST_TERM_NAMES.length;

/**
 * Per-second rates from the config, worked out once whenever it changes.
 * Every cost knob is a share of the basal rate of a size 1 critter, so the
 * energy storage and fasting time set the pace of the whole metabolism. Costs
 * that are turned off are 0.
 */
export interface MetabolicRates {
  /** Basal rate of a size 1 critter, in energy per second, whether or not basal cost is on. */
  unit: number;
  /** Basal cost per mass^0.75. */
  basal: number;
  /** Upkeep per u/s of max speed, per unit of mass. */
  speedUpkeep: number;
  /** Upkeep per °/s of turn rate, per unit of mass. */
  turnUpkeep: number;
  /** Movement cost per unit of mass per (u/s)². */
  movement: number;
  /** Terrain cost per unit of mass per (u/s)², per unit of (1 / terrain factor − 1). */
  terrain: number;
  /** Cost per °F below the comfort band, per mass^(2/3). */
  cold: number;
  /** Cost per °F above the comfort band, per mass^(2/3). */
  heat: number;
  /** Comfort band, in °F. */
  comfortLow: number;
  comfortHigh: number;
  /** Most energy eaten per second, per mass^0.75. */
  bite: number;
  /** Water used per unit of energy spent. 0 when thirst is off. */
  waterPerEnergy: number;
  /** Share of a full water store drunk per second. */
  drink: number;
  /** Water gained per unit of plant energy eaten. */
  plantWater: number;
  /** Lifespan per mass^0.25, in seconds. Infinity when aging is off. */
  lifespan: number;
}

export function metabolicRates(config: WorldConfig): MetabolicRates {
  const unit = config.energyStorage / config.fastingTime;
  const running = (unit * config.runningCost) / (RUNNING_SPEED * RUNNING_SPEED);
  return {
    unit,
    basal: config.basalCost ? unit : 0,
    speedUpkeep: config.traitUpkeep ? (unit * config.speedUpkeep) / 100 / SPEED_UPKEEP_STEP : 0,
    turnUpkeep: config.traitUpkeep ? (unit * config.turnUpkeep) / 100 / TURN_UPKEEP_STEP : 0,
    movement: config.movementCost ? running : 0,
    terrain: config.terrainCost ? running * config.terrainEffort : 0,
    cold: config.thermalCost ? (unit * config.coldCost) / 100 : 0,
    heat: config.thermalCost ? (unit * config.heatCost) / 100 : 0,
    comfortLow: config.comfortTemperature - config.comfortBand,
    comfortHigh: config.comfortTemperature + config.comfortBand,
    bite: config.biteRate,
    waterPerEnergy: config.thirst ? WATER_PER_MASS / config.thirstTime / unit : 0,
    drink: 1 / config.drinkTime,
    plantWater: ((config.plantWater / 100) * WATER_PER_MASS) / config.plantEnergy,
    lifespan: config.critterAging ? config.critterLifespan : Infinity,
  };
}

/** mass^0.75: basal cost and bite rate grow with it (Kleiber's law). */
export function kleiberOf(mass: number): number {
  return Math.pow(mass, 0.75);
}

/** mass^(2/3): surface area, which heat flows through. */
export function surfaceOf(mass: number): number {
  return Math.cbrt(mass * mass);
}

/** mass^0.25: lifespan grows with it. */
export function lifeScaleOf(mass: number): number {
  return Math.sqrt(Math.sqrt(mass));
}

/** Most energy a critter of a mass can store. Fat stores grow in proportion to the body. */
export function maxEnergyOf(mass: number, config: Pick<WorldConfig, "energyStorage">): number {
  return config.energyStorage * mass;
}

/** Most water a critter of a mass can hold. */
export function maxWaterOf(mass: number): number {
  return WATER_PER_MASS * mass;
}

/** Age at which a critter of a mass dies: lifespan × mass^0.25 (docs/DESIGN.md §6.1). */
export function maxAgeOf(mass: number, config: Pick<WorldConfig, "critterLifespan">): number {
  return config.critterLifespan * lifeScaleOf(mass);
}

/** What a critter's costs depend on in a tick. */
export interface CostInputs {
  mass: number;
  /** mass^0.75. */
  kleiber: number;
  /** mass^(2/3). */
  surface: number;
  /** u/s. */
  maxSpeed: number;
  /** °/s. */
  turnRate: number;
  /** Actual speed, in u/s. */
  speed: number;
  /** Share of full speed the ground under it allows, 0 to 1 (wading × slope). */
  terrainFactor: number;
  /** Ambient mean annual temperature, in °F. */
  temperature: number;
}

/**
 * Each term of a critter's energy budget, in energy per second, written to out
 * from offset in CostTerm order. Returns their sum. Brain and senses are 0
 * until brains and eyes arrive.
 *
 * - Basal: basal × mass^0.75 (Kleiber's law).
 * - Traits: upkeep of top speed and turn rate, growing with mass.
 * - Movement: movement × mass × speed², so sprinting is expensive.
 * - Terrain: the movement cost times (1 / terrain factor − 1), so moving plus
 *   terrain is the flat-ground cost per unit of distance divided by how much
 *   the ground slows the critter.
 * - Thermal: the degrees beyond the comfort band times surface area, mass^(2/3).
 */
export function costRates(rates: MetabolicRates, c: CostInputs, out: Float64Array, offset = 0): number {
  const basal = rates.basal * c.kleiber;
  const traits = (rates.speedUpkeep * c.maxSpeed + rates.turnUpkeep * c.turnRate) * c.mass;
  const effort = c.mass * c.speed * c.speed;
  const movement = rates.movement * effort;
  const terrain = rates.terrain > 0 ? rates.terrain * effort * (1 / Math.max(MIN_TERRAIN_FACTOR, c.terrainFactor) - 1) : 0;
  const t = c.temperature;
  const thermal = (rates.cold * Math.max(0, rates.comfortLow - t) + rates.heat * Math.max(0, t - rates.comfortHigh)) * c.surface;
  out[offset + CostTerm.Basal] = basal;
  out[offset + CostTerm.Brain] = 0;
  out[offset + CostTerm.Senses] = 0;
  out[offset + CostTerm.Traits] = traits;
  out[offset + CostTerm.Movement] = movement;
  out[offset + CostTerm.Terrain] = terrain;
  out[offset + CostTerm.Thermal] = thermal;
  return basal + traits + movement + terrain + thermal;
}

/** A critter's body and situation, for costsOf. Anything left out is at rest on flat ground at the comfort temperature. */
export interface CostQuery {
  size: number;
  maxSpeed?: number;
  turnRate?: number;
  speed?: number;
  terrainFactor?: number;
  temperature?: number;
}

/** Each cost term in energy per second, in CostTerm order, plus their total. For tests and tools. */
export function costsOf(config: WorldConfig, q: CostQuery): { terms: Float64Array; total: number } {
  const mass = q.size * q.size * q.size;
  const terms = new Float64Array(COST_TERM_COUNT);
  const total = costRates(
    metabolicRates(config),
    {
      mass,
      kleiber: kleiberOf(mass),
      surface: surfaceOf(mass),
      maxSpeed: q.maxSpeed ?? 0,
      turnRate: q.turnRate ?? 0,
      speed: q.speed ?? 0,
      terrainFactor: q.terrainFactor ?? 1,
      temperature: q.temperature ?? config.comfortTemperature,
    },
    terms,
  );
  return { terms, total };
}

/**
 * Whether any water cell, shallow or deep, comes within r of (x, y): where a
 * critter can drink. Touching counts.
 */
export function touchesWater(terrain: TerrainData, x: number, y: number, r: number): boolean {
  const { cellSize: s, cols, rows, terrainType } = terrain;
  // Rounding up and stepping back includes a cell whose far edge is exactly r away.
  const c0 = Math.max(0, Math.ceil((x - r) / s) - 1);
  const c1 = Math.min(cols - 1, Math.floor((x + r) / s));
  const r0 = Math.max(0, Math.ceil((y - r) / s) - 1);
  const r1 = Math.min(rows - 1, Math.floor((y + r) / s));
  const rSq = r * r;
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      if (!isWater(terrainType[row * cols + col] as TerrainType)) continue;
      // The point of the cell nearest the center.
      const nx = Math.min((col + 1) * s, Math.max(col * s, x));
      const ny = Math.min((row + 1) * s, Math.max(row * s, y));
      const dx = x - nx;
      const dy = y - ny;
      if (dx * dx + dy * dy <= rSq) return true;
    }
  }
  return false;
}
