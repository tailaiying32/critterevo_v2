import { KNOBS, knobEntries, normalizeKnobValue, type KnobKey, type KnobValue } from "./knobs.js";

/** World configuration, derived from the knob registry in knobs.ts. */
export type WorldConfig = { -readonly [K in KnobKey]: KnobValue<(typeof KNOBS)[K]> };

type MutableConfig = Record<KnobKey, number | boolean>;

export const DEFAULT_CONFIG: Readonly<WorldConfig> = Object.freeze(
  Object.fromEntries(knobEntries().map(([key, spec]) => [key, spec.default])) as WorldConfig,
);

/** Builds a full, valid config from defaults plus overrides. Out-of-range values are clamped. */
export function makeConfig(overrides: Partial<WorldConfig> = {}): WorldConfig {
  const config = { ...DEFAULT_CONFIG } as MutableConfig;
  for (const [key, spec] of knobEntries()) {
    const value = overrides[key];
    if (value !== undefined) config[key] = normalizeKnobValue(spec, value);
  }
  return config as WorldConfig;
}

export const CONFIG_FORMAT = "critter-evo-config";
export const CONFIG_VERSION = 1;

/** Serializes a config for export as a JSON file. */
export function serializeConfig(config: WorldConfig): string {
  return JSON.stringify({ format: CONFIG_FORMAT, version: CONFIG_VERSION, config }, null, 2);
}

export interface ParsedConfig {
  config: WorldConfig;
  /** Human-readable notes about anything that was ignored, defaulted, or clamped. */
  warnings: string[];
}

/**
 * Parses an imported config. Accepts the exported wrapper or a bare object of
 * knob values. Never throws on bad values: it repairs them and reports warnings.
 * Throws only if the input is not an object at all.
 */
export function parseConfig(input: unknown): ParsedConfig {
  let raw: unknown = input;
  if (isRecord(raw) && isRecord(raw["config"])) raw = raw["config"];
  if (!isRecord(raw)) throw new Error("Config must be a JSON object.");

  const warnings: string[] = [];
  const config = { ...DEFAULT_CONFIG } as MutableConfig;

  for (const key of Object.keys(raw)) {
    if (!(key in KNOBS)) warnings.push(`Unknown setting "${key}" was ignored.`);
  }

  for (const [key, spec] of knobEntries()) {
    const value = raw[key];
    if (value === undefined) {
      warnings.push(`"${spec.label}" was missing and set to its default.`);
      continue;
    }
    const expected = spec.kind === "boolean" ? "boolean" : "number";
    if (typeof value !== expected) {
      warnings.push(`"${spec.label}" should be a ${expected} and was set to its default.`);
      continue;
    }
    const normalized = normalizeKnobValue(spec, value as number | boolean);
    if (normalized !== value) warnings.push(`"${spec.label}" was out of range and adjusted to ${String(normalized)}.`);
    config[key] = normalized;
  }

  return { config: config as WorldConfig, warnings };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
