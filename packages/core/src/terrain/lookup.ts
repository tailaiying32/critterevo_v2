import type { Biome } from "./biomes.js";
import { heightOf, type TerrainData, type TerrainType } from "./types.js";

/**
 * Cell lookups on the terrain grid (docs/DESIGN.md §4.2). A point belongs to the
 * cell that contains it; points beyond the grid use the nearest edge cell.
 */
export function cellIndexAt(terrain: TerrainData, x: number, y: number): number {
  const col = clamp(Math.floor(x / terrain.cellSize), terrain.cols - 1);
  const row = clamp(Math.floor(y / terrain.cellSize), terrain.rows - 1);
  return row * terrain.cols + col;
}

function clamp(i: number, max: number): number {
  return i < 0 ? 0 : i > max ? max : i;
}

export function terrainTypeAt(terrain: TerrainData, x: number, y: number): TerrainType {
  return terrain.terrainType[cellIndexAt(terrain, x, y)] as TerrainType;
}

/** Elevation of the cell at a point, 0 to 1. */
export function elevationAt(terrain: TerrainData, x: number, y: number): number {
  return terrain.elevation[cellIndexAt(terrain, x, y)]!;
}

/** Height above sea level of the cell at a point, in feet. Water is at 0. */
export function heightAt(terrain: TerrainData, x: number, y: number): number {
  return heightOf(terrain, elevationAt(terrain, x, y));
}

/** Biome of the cell at a point. Biome.None for water. */
export function biomeAt(terrain: TerrainData, x: number, y: number): Biome {
  return terrain.biome[cellIndexAt(terrain, x, y)] as Biome;
}

/** Annual rainfall of the cell at a point, in inches. */
export function rainfallAt(terrain: TerrainData, x: number, y: number): number {
  return terrain.rainfall[cellIndexAt(terrain, x, y)]!;
}

/** Distance from the cell at a point to the nearest water cell, in world units. */
export function distanceToWaterAt(terrain: TerrainData, x: number, y: number): number {
  return terrain.distanceToWater[cellIndexAt(terrain, x, y)]!;
}

/** Mean annual temperature of the cell at a point, in °F. */
export function temperatureAt(terrain: TerrainData, x: number, y: number): number {
  return terrain.temperature[cellIndexAt(terrain, x, y)]!;
}
