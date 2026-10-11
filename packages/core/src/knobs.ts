/**
 * The knob registry. Every tunable world parameter is declared here exactly once,
 * with its default, range, and description. WorldConfig, DEFAULT_CONFIG, config
 * validation, and the web settings panel are all derived from this table, so
 * adding a knob is a single entry (docs/DESIGN.md principle 3).
 */

/** Groups shown as sections in the settings panel, in display order. */
export const KNOB_GROUPS = ["World", "Simulation"] as const;
export type KnobGroup = (typeof KNOB_GROUPS)[number];

/**
 * When a change takes effect.
 * - "new-world": only when a new world is generated.
 * - "live": immediately, while the simulation runs.
 */
export type KnobApplies = "new-world" | "live";

interface KnobBase {
  label: string;
  group: KnobGroup;
  description: string;
  applies: KnobApplies;
}

export interface NumberKnobSpec extends KnobBase {
  kind: "number";
  default: number;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
  unit?: string;
  /** "slider" shows a slider plus a text field; "input" shows only the field. Defaults to "slider". */
  control?: "slider" | "input";
}

export interface BooleanKnobSpec extends KnobBase {
  kind: "boolean";
  default: boolean;
}

export type KnobSpec = NumberKnobSpec | BooleanKnobSpec;

export type KnobValue<S extends KnobSpec> = S extends BooleanKnobSpec ? boolean : number;

export const KNOBS = {
  seed: {
    kind: "number",
    label: "Seed",
    group: "World",
    description: "Seed for all randomness in the world. The same seed and settings always produce the same run.",
    applies: "new-world",
    default: 1,
    min: 0,
    max: 4294967295,
    step: 1,
    integer: true,
    control: "input",
  },
  width: {
    kind: "number",
    label: "Width",
    group: "World",
    description: "World width in world units.",
    applies: "new-world",
    default: 1000,
    min: 100,
    max: 10000,
    step: 10,
    integer: true,
    unit: "u",
  },
  height: {
    kind: "number",
    label: "Height",
    group: "World",
    description: "World height in world units.",
    applies: "new-world",
    default: 1000,
    min: 100,
    max: 10000,
    step: 10,
    integer: true,
    unit: "u",
  },
  dt: {
    kind: "number",
    label: "Tick length",
    group: "Simulation",
    description: "Simulated seconds per tick. Smaller is more precise but slower to simulate.",
    applies: "new-world",
    default: 1 / 30,
    min: 0.005,
    max: 0.2,
    step: 0.001,
    unit: "s",
  },
} as const satisfies Record<string, KnobSpec>;

export type KnobKey = keyof typeof KNOBS;

/** All knobs as [key, spec] pairs, in declaration order. */
export function knobEntries(): [KnobKey, KnobSpec][] {
  return Object.entries(KNOBS) as [KnobKey, KnobSpec][];
}

/**
 * Coerces a value into a valid value for the knob: clamps numbers to range,
 * rounds integers, and falls back to the default for non-finite input.
 */
export function normalizeKnobValue(spec: KnobSpec, value: number | boolean): number | boolean {
  if (spec.kind === "boolean") return Boolean(value);
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return spec.default;
  const clamped = Math.min(spec.max, Math.max(spec.min, n));
  return spec.integer ? Math.round(clamped) : clamped;
}
