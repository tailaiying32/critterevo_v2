import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, makeConfig, parseConfig, serializeConfig } from "./config.js";
import { KNOB_GROUPS, KNOBS, knobEntries } from "./knobs.js";

describe("knob registry", () => {
  it("DEFAULT_CONFIG has every knob at its declared default", () => {
    for (const [key, spec] of knobEntries()) expect(DEFAULT_CONFIG[key]).toBe(spec.default);
    expect(Object.keys(DEFAULT_CONFIG).sort()).toEqual(Object.keys(KNOBS).sort());
  });

  it("every default lies within its range and respects integer knobs", () => {
    for (const [, spec] of knobEntries()) {
      if (spec.kind !== "number") continue;
      expect(spec.min).toBeLessThanOrEqual(spec.default);
      expect(spec.default).toBeLessThanOrEqual(spec.max);
      if (spec.integer) expect(Number.isInteger(spec.default)).toBe(true);
    }
  });

  it("every knob belongs to a known group", () => {
    for (const [, spec] of knobEntries()) expect(KNOB_GROUPS).toContain(spec.group);
  });
});

describe("makeConfig", () => {
  it("clamps out-of-range values and rounds integer knobs", () => {
    const config = makeConfig({ width: 5, height: 1e9, seed: 3.7 });
    expect(config.width).toBe(KNOBS.width.min);
    expect(config.height).toBe(KNOBS.height.max);
    expect(config.seed).toBe(4);
  });

  it("falls back to the default for non-finite numbers", () => {
    expect(makeConfig({ dt: Number.NaN }).dt).toBe(KNOBS.dt.default);
  });
});

describe("parseConfig", () => {
  it("round-trips an exported config with no warnings", () => {
    const original = makeConfig({ seed: 99, width: 2000 });
    const { config, warnings } = parseConfig(JSON.parse(serializeConfig(original)));
    expect(config).toEqual(original);
    expect(warnings).toEqual([]);
  });

  it("accepts a bare object of knob values", () => {
    const { config } = parseConfig({ ...DEFAULT_CONFIG, seed: 7 });
    expect(config.seed).toBe(7);
  });

  it("repairs bad values and reports each problem", () => {
    const { config, warnings } = parseConfig({ seed: "abc", width: 50, bogus: 1 });
    expect(config.seed).toBe(KNOBS.seed.default);
    expect(config.width).toBe(KNOBS.width.min);
    expect(warnings.some((w) => w.includes("bogus"))).toBe(true);
    expect(warnings.some((w) => w.includes("Seed"))).toBe(true);
    expect(warnings.some((w) => w.includes("Width"))).toBe(true);
    expect(warnings.some((w) => w.includes("Height"))).toBe(true);
  });

  it("rejects input that is not an object", () => {
    expect(() => parseConfig(42)).toThrow();
    expect(() => parseConfig([1, 2])).toThrow();
  });
});
