import { fnv1aArray, fnv1aWords } from "../hash.js";
import type { Rng } from "../rng.js";

/** A critter's decisions for one tick: what its brain outputs (docs/DESIGN.md §7.5). */
export interface Outputs {
  /** −1 to 1: angular velocity as a share of turn rate. Positive turns clockwise on the map, to the critter's right. */
  turn: number;
  /** 0 to 1: target speed as a share of max speed. */
  thrust: number;
  /** 0 to 1: strikes the nearest critter in range when above threshold (Phase 10). */
  attack: number;
  /** 0 to 1: signals readiness to mate when above threshold (Phase 9). */
  mate: number;
}

/** What drives a critter. Brains join in Phase 7. */
export const ControllerKind = {
  Idle: 0,
  Wander: 1,
  Keyboard: 2,
} as const;
export type ControllerKind = (typeof ControllerKind)[keyof typeof ControllerKind];

export const CONTROLLER_NAMES: readonly string[] = ["Idle", "Wander", "Keyboard"];

/** What a controller can read about the critter it drives. Brains will get their senses here (Phase 7). */
export interface ControlContext {
  /** Seconds per tick. */
  dt: number;
}

/**
 * Decides a critter's outputs each tick. Brains plug in behind this same
 * interface in Phase 7, so movement code never changes; until then critters
 * stand still, wander, or are driven by the keyboard. Every critter decides
 * before any critter moves (docs/DESIGN.md §13), so controllers only read.
 */
export interface Controller {
  readonly kind: ControllerKind;
  decide(context: ControlContext, out: Outputs): void;
  /** Folds the controller's own state into the state hash. */
  hash(seed: number): number;
}

/** Outputs nothing: the critter coasts to a stop and stays there. */
export class IdleController implements Controller {
  readonly kind = ControllerKind.Idle;

  decide(_context: ControlContext, out: Outputs): void {
    out.turn = 0;
    out.thrust = 0;
    out.attack = 0;
    out.mate = 0;
  }

  hash(seed: number): number {
    return seed;
  }
}

/**
 * Outputs whatever the keyboard last set. One is shared by every critter
 * being driven, so they all follow the same keys.
 */
export class KeyboardController implements Controller {
  readonly kind = ControllerKind.Keyboard;
  private readonly state = new Float64Array(2);

  /** Sets the outputs from the keys held: turn −1 to 1, thrust 0 to 1. */
  set(turn: number, thrust: number): void {
    this.state[0] = Math.min(1, Math.max(-1, turn));
    this.state[1] = Math.min(1, Math.max(0, thrust));
  }

  decide(_context: ControlContext, out: Outputs): void {
    out.turn = this.state[0]!;
    out.thrust = this.state[1]!;
    out.attack = 0;
    out.mate = 0;
  }

  hash(seed: number): number {
    return fnv1aArray(this.state, seed);
  }
}

/**
 * Random steering, for crowds: holds a random turn for a few seconds at a
 * time, at a steady thrust of its own. It knows nothing about the world, so it
 * runs into walls and wades into deep water like anything else that can't see.
 * Draws from a random stream shared by every wanderer, in slot order, so runs
 * stay deterministic.
 */
export class WanderController implements Controller {
  readonly kind = ControllerKind.Wander;
  /** Turn, and seconds until it changes. */
  private readonly state = new Float64Array(2);

  constructor(
    private readonly rng: Rng,
    private readonly thrust: number,
  ) {}

  decide(context: ControlContext, out: Outputs): void {
    const { rng, state } = this;
    state[1]! -= context.dt;
    if (state[1]! <= 0) {
      state[0] = rng.range(-0.5, 0.5);
      state[1] = rng.range(0.5, 3);
    }
    out.turn = state[0]!;
    out.thrust = this.thrust;
    out.attack = 0;
    out.mate = 0;
  }

  hash(seed: number): number {
    return fnv1aArray(this.state, fnv1aArray(new Float64Array([this.thrust]), fnv1aWords([this.kind], seed)));
  }
}
