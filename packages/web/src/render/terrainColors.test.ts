import { describe, expect, it } from "vitest";
import { biomeLegend, cssColor, cssSteps, stepPosition, terrainTypeLegend } from "./terrainColors";

describe("terrain colors", () => {
  it("lists every terrain type in the legend, from deep water up", () => {
    expect(terrainTypeLegend().map((item) => item.label)).toEqual(["Deep water", "Shallow water", "Land", "Mountain"]);
  });

  it("lists every biome from cold to hot, then water", () => {
    expect(biomeLegend().map((item) => item.label)).toEqual([
      "Tundra",
      "Taiga",
      "Grassland",
      "Temperate forest",
      "Temperate rainforest",
      "Desert",
      "Savanna",
      "Rainforest",
      "Shallow water",
      "Deep water",
    ]);
  });

  it("converts colors for CSS", () => {
    expect(cssColor([255, 0, 128])).toBe("rgb(255,0,128)");
    expect(cssColor([12.4, 0.6, 99.5])).toBe("rgb(12,1,100)");
  });

  it("draws each step as a solid block sized by its share of the scale", () => {
    const steps = [
      { from: -10, to: 0, color: [0, 0, 0] },
      { from: 0, to: 30, color: [255, 255, 255] },
    ] as const;
    expect(cssSteps(steps)).toBe("linear-gradient(to right, rgb(0,0,0) 0.0% 25.0%, rgb(255,255,255) 25.0% 100.0%)");
    expect(stepPosition(steps, 0)).toBe(0.25);
    expect(stepPosition(steps, 99)).toBe(1);
  });
});
