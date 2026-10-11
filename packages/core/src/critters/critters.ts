import type { WorldConfig } from "../config.js";
import { fnv1aArray, fnv1aWords } from "../hash.js";
import { KNOBS } from "../knobs.js";
import type { Rng } from "../rng.js";
import { SpatialHash } from "../spatial.js";
import type { TerrainData } from "../terrain/types.js";
import {
  ControllerKind,
  IdleController,
  KeyboardController,
  WanderController,
  type ControlContext,
  type Controller,
  type Outputs,
} from "./controllers.js";
import { accelerationOf, bodyFits, massOf, radiusOf, terrainEffect, type TerrainEffect } from "./movement.js";

/** A critter's body traits (docs/DESIGN.md §6.1). Phase 4 has these three; later phases add the rest. */
export interface CritterTraits {
  /** Relative body size: 1 is a typical critter, 10 units across. */
  size: number;
  /** Top speed on flat, dry ground, in u/s. */
  maxSpeed: number;
  /** Fastest turn, in degrees per second. */
  turnRate: number;
}

/** Critters as the renderer needs them, packed into typed arrays that can be transferred. */
export interface CritterSnapshot {
  count: number;
  id: Uint32Array;
  x: Float32Array;
  y: Float32Array;
  /** Radians clockwise from +x (east). */
  heading: Float32Array;
  radius: Float32Array;
  /** ControllerKind of each critter. */
  controller: Uint8Array;
}

/** Everything the inspector shows about one critter. */
export interface CritterInfo extends CritterTraits, TerrainEffect {
  id: number;
  x: number;
  y: number;
  /** Radians clockwise from +x (east). */
  heading: number;
  vx: number;
  vy: number;
  speed: number;
  radius: number;
  mass: number;
  /** Most acceleration it can reach, in u/s². */
  acceleration: number;
  controller: ControllerKind;
  /** Outputs it decided this tick. */
  turn: number;
  thrust: number;
  /** Whether a wall or deep water stopped part of its last move. */
  blocked: boolean;
}

/** Trait limits, from the starting trait knobs' ranges. Evolution will keep traits inside them too. */
const TRAIT_LIMITS: Record<keyof CritterTraits, [number, number]> = {
  size: [KNOBS.critterSize.min, KNOBS.critterSize.max],
  maxSpeed: [KNOBS.critterMaxSpeed.min, KNOBS.critterMaxSpeed.max],
  turnRate: [KNOBS.critterTurnRate.min, KNOBS.critterTurnRate.max],
};

const DEGREES = Math.PI / 180;
const TWO_PI = 2 * Math.PI;
const INITIAL_CAPACITY = 256;
/** Bits returned by moveBy for the parts of a move a wall stopped. */
const BLOCKED_X = 1;
const BLOCKED_Y = 2;

/**
 * The critters (docs/DESIGN.md §6, §8), stored as a struct of arrays indexed by
 * slot like the plants. Each critter also has a permanent id, since slots are
 * reused. Each tick every critter first decides through its controller, then
 * all of them move: turn, accelerate toward a target speed limited by the
 * terrain, slide along walls and deep water, and finally push apart where
 * they overlap.
 */
export class Critters {
  /** Living critters. */
  count = 0;
  /** Slots in use: every living critter has a slot below this. */
  slots = 0;
  id = new Uint32Array(INITIAL_CAPACITY);
  alive = new Uint8Array(INITIAL_CAPACITY);
  x = new Float64Array(INITIAL_CAPACITY);
  y = new Float64Array(INITIAL_CAPACITY);
  /** Radians clockwise from +x (east), in [0, 2π). */
  heading = new Float64Array(INITIAL_CAPACITY);
  vx = new Float64Array(INITIAL_CAPACITY);
  vy = new Float64Array(INITIAL_CAPACITY);
  size = new Float64Array(INITIAL_CAPACITY);
  maxSpeed = new Float64Array(INITIAL_CAPACITY);
  /** Degrees per second. */
  turnRate = new Float64Array(INITIAL_CAPACITY);
  radius = new Float64Array(INITIAL_CAPACITY);
  mass = new Float64Array(INITIAL_CAPACITY);
  /** Outputs decided this tick. */
  turn = new Float64Array(INITIAL_CAPACITY);
  thrust = new Float64Array(INITIAL_CAPACITY);
  attack = new Float64Array(INITIAL_CAPACITY);
  mate = new Float64Array(INITIAL_CAPACITY);
  /** 1 if a wall or deep water stopped part of the critter's last move. */
  blocked = new Uint8Array(INITIAL_CAPACITY);
  controllerKind = new Uint8Array(INITIAL_CAPACITY);
  controllers: Controller[] = [];
  /** Living critters by position. */
  readonly index: SpatialHash;
  /** Shared by every critter set to keyboard control. */
  readonly keyboard = new KeyboardController();

  private config: WorldConfig;
  private readonly idle = new IdleController();
  private readonly free: number[] = [];
  private readonly slotById = new Map<number, number>();
  private nextId = 1;
  /** Largest radius of any living critter, so collision queries reach every possible overlap. */
  private maxRadius = 0;
  private pushX = new Float64Array(INITIAL_CAPACITY);
  private pushY = new Float64Array(INITIAL_CAPACITY);
  private readonly nearby: number[] = [];
  private readonly outputs: Outputs = { turn: 0, thrust: 0, attack: 0, mate: 0 };
  private readonly context: ControlContext = { dt: 0 };
  private readonly effect: TerrainEffect = { wading: 1, slope: 1, grade: 0 };

  constructor(
    private readonly terrain: TerrainData,
    config: WorldConfig,
    private readonly rng: Rng,
    private readonly wanderRng: Rng,
  ) {
    this.config = config;
    this.index = new SpatialHash(terrain.width, terrain.height);
  }

  /** Applies a new config. Called when live knobs change. */
  configure(config: WorldConfig): void {
    this.config = config;
  }

  /**
   * Scatters wandering critters at random over the places they fit, facing
   * random ways, with the starting traits each varied by the trait variety
   * knob. Makes a few attempts per critter, since most of the world may be
   * deep water. Returns the number placed.
   */
  scatter(count: number): number {
    const { width, height } = this.terrain;
    const { critterSize, critterMaxSpeed, critterTurnRate } = this.config;
    const spread = 1 + this.config.traitVariety / 100;
    const vary = (value: number) => value * Math.pow(spread, 2 * this.rng.next() - 1);
    let placed = 0;
    for (let attempt = 0; attempt < count * 20 && placed < count; attempt++) {
      const traits = { size: vary(critterSize), maxSpeed: vary(critterMaxSpeed), turnRate: vary(critterTurnRate) };
      const slot = this.spawn(this.rng.range(0, width), this.rng.range(0, height), traits, ControllerKind.Wander);
      if (slot >= 0) placed++;
    }
    return placed;
  }

  /**
   * Adds a critter at a point, facing a random way, if its body fits there.
   * Traits are clamped to their limits. Returns its slot, or -1 if it didn't fit.
   */
  spawn(px: number, py: number, traits: CritterTraits, kind: ControllerKind): number {
    const size = clampTrait("size", traits.size);
    const radius = radiusOf(size);
    if (!bodyFits(this.terrain, px, py, radius)) return -1;
    const heading = this.rng.next() * TWO_PI;

    const slot = this.free.length > 0 ? this.free.pop()! : this.allocate();
    const id = this.nextId++;
    this.id[slot] = id;
    this.alive[slot] = 1;
    this.x[slot] = px;
    this.y[slot] = py;
    this.heading[slot] = heading;
    this.vx[slot] = 0;
    this.vy[slot] = 0;
    this.size[slot] = size;
    this.maxSpeed[slot] = clampTrait("maxSpeed", traits.maxSpeed);
    this.turnRate[slot] = clampTrait("turnRate", traits.turnRate);
    this.radius[slot] = radius;
    this.mass[slot] = massOf(size);
    this.turn[slot] = 0;
    this.thrust[slot] = 0;
    this.attack[slot] = 0;
    this.mate[slot] = 0;
    this.blocked[slot] = 0;
    this.setController(slot, kind);
    this.index.insert(slot, px, py);
    this.slotById.set(id, slot);
    this.maxRadius = Math.max(this.maxRadius, radius);
    this.count++;
    return slot;
  }

  remove(slot: number): void {
    if (!this.alive[slot]) return;
    this.alive[slot] = 0;
    this.index.remove(slot);
    this.slotById.delete(this.id[slot]!);
    this.controllers[slot] = this.idle;
    this.free.push(slot);
    this.count--;
    this.maxRadius = 0;
    for (let i = 0; i < this.slots; i++) if (this.alive[i]) this.maxRadius = Math.max(this.maxRadius, this.radius[i]!);
  }

  /** Slot of the living critter with an id, or -1. */
  slotOf(id: number): number {
    return this.slotById.get(id) ?? -1;
  }

  /** Changes what drives a critter. A new wanderer gets a steady thrust of its own. */
  setController(slot: number, kind: ControllerKind): void {
    this.controllerKind[slot] = kind;
    this.controllers[slot] =
      kind === ControllerKind.Wander
        ? new WanderController(this.wanderRng, this.rng.range(0.5, 1))
        : kind === ControllerKind.Keyboard
          ? this.keyboard
          : this.idle;
  }

  /**
   * Think (docs/DESIGN.md §13): every critter decides its outputs from the
   * current state, before anyone moves.
   */
  think(): void {
    const { outputs: out, context } = this;
    context.dt = this.config.dt;
    for (let i = 0; i < this.slots; i++) {
      if (!this.alive[i]) continue;
      this.controllers[i]!.decide(context, out);
      this.turn[i] = Math.min(1, Math.max(-1, out.turn));
      this.thrust[i] = Math.min(1, Math.max(0, out.thrust));
      this.attack[i] = Math.min(1, Math.max(0, out.attack));
      this.mate[i] = Math.min(1, Math.max(0, out.mate));
    }
  }

  /**
   * Move (docs/DESIGN.md §8): each critter turns, then its velocity moves
   * toward thrust × max speed along its heading, slowed by the terrain, by at
   * most its acceleration. Walls and deep water stop the parts of a move that
   * would overlap them, and their velocity. Then overlapping critters push
   * apart.
   */
  move(): void {
    const { config, terrain, effect } = this;
    const dt = config.dt;
    for (let i = 0; i < this.slots; i++) {
      if (!this.alive[i]) continue;
      let heading = this.heading[i]! + this.turn[i]! * this.turnRate[i]! * DEGREES * dt;
      heading -= Math.floor(heading / TWO_PI) * TWO_PI;
      this.heading[i] = heading;
      const cos = Math.cos(heading);
      const sin = Math.sin(heading);

      const size = this.size[i]!;
      terrainEffect(terrain, config, this.x[i]!, this.y[i]!, cos, sin, size, effect);
      const target = this.thrust[i]! * this.maxSpeed[i]! * effect.wading * effect.slope;
      let vx = this.vx[i]!;
      let vy = this.vy[i]!;
      const dvx = cos * target - vx;
      const dvy = sin * target - vy;
      const dv = Math.sqrt(dvx * dvx + dvy * dvy);
      const reach = accelerationOf(size, config) * dt;
      const share = dv > reach ? reach / dv : 1;
      vx += dvx * share;
      vy += dvy * share;

      const stopped = this.moveBy(i, vx * dt, vy * dt);
      if (stopped & BLOCKED_X) vx = 0;
      if (stopped & BLOCKED_Y) vy = 0;
      this.vx[i] = vx;
      this.vy[i] = vy;
      this.blocked[i] = stopped ? 1 : 0;
    }
    if (config.collisions) this.pushApart();
  }

  /**
   * Soft repulsion (docs/DESIGN.md §8): every overlapping pair is pushed apart
   * along the line between their centers, by a share of the overlap set by the
   * push-apart time, split by mass so the heavier one moves less. All pushes
   * are worked out from the same positions, then applied together, so the
   * order critters are processed in doesn't matter. Pushes obey walls.
   */
  private pushApart(): void {
    const { x, y, radius, mass, alive, nearby, pushX, pushY } = this;
    const share = 1 - Math.exp(-this.config.dt / this.config.pushTime);
    pushX.fill(0, 0, this.slots);
    pushY.fill(0, 0, this.slots);
    let any = false;
    for (let i = 0; i < this.slots; i++) {
      if (!alive[i]) continue;
      const xi = x[i]!;
      const yi = y[i]!;
      const ri = radius[i]!;
      nearby.length = 0;
      this.index.queryRadius(xi, yi, ri + this.maxRadius, nearby);
      for (const j of nearby) {
        // Each pair once, from its lower slot. The query reaches far enough for that.
        if (j <= i) continue;
        const reach = ri + radius[j]!;
        let dx = x[j]! - xi;
        let dy = y[j]! - yi;
        const dSq = dx * dx + dy * dy;
        if (dSq >= reach * reach) continue;
        const d = Math.sqrt(dSq);
        if (d > 0) {
          dx /= d;
          dy /= d;
        } else {
          // Exactly on top of each other: push apart along x.
          dx = 1;
          dy = 0;
        }
        const push = (reach - d) * share;
        const mi = mass[i]!;
        const mj = mass[j]!;
        const pi = (push * mj) / (mi + mj);
        const pj = (push * mi) / (mi + mj);
        pushX[i]! -= dx * pi;
        pushY[i]! -= dy * pi;
        pushX[j]! += dx * pj;
        pushY[j]! += dy * pj;
        any = true;
      }
    }
    if (!any) return;
    for (let i = 0; i < this.slots; i++) {
      if (alive[i] && (pushX[i] !== 0 || pushY[i] !== 0)) this.moveBy(i, pushX[i]!, pushY[i]!);
    }
  }

  /**
   * Moves a critter by (dx, dy) as far as walls and deep water allow: the whole
   * move if its body fits there, otherwise just the larger part along x or y
   * that fits, so it slides along the wall. Returns BLOCKED_X and BLOCKED_Y
   * bits for the parts that didn't happen.
   */
  private moveBy(i: number, dx: number, dy: number): number {
    if (dx === 0 && dy === 0) return 0;
    const { terrain } = this;
    const x = this.x[i]!;
    const y = this.y[i]!;
    const r = this.radius[i]!;
    let stopped = BLOCKED_X | BLOCKED_Y;
    if (bodyFits(terrain, x + dx, y + dy, r)) {
      this.x[i] = x + dx;
      this.y[i] = y + dy;
      stopped = 0;
    } else {
      const alongX = dx !== 0 && bodyFits(terrain, x + dx, y, r);
      const alongY = dy !== 0 && bodyFits(terrain, x, y + dy, r);
      if (alongX && (!alongY || Math.abs(dx) >= Math.abs(dy))) {
        this.x[i] = x + dx;
        stopped = BLOCKED_Y;
      } else if (alongY) {
        this.y[i] = y + dy;
        stopped = BLOCKED_X;
      }
    }
    if (stopped !== (BLOCKED_X | BLOCKED_Y)) this.index.move(i, this.x[i]!, this.y[i]!);
    return stopped;
  }

  /**
   * The living critter whose body is nearest a point, within tolerance of its
   * edge, or -1. For picking with the mouse.
   */
  slotAt(px: number, py: number, tolerance: number): number {
    let best = -1;
    let bestGap = Infinity;
    this.index.forEachWithin(px, py, this.maxRadius + tolerance, (slot, dSq) => {
      const gap = Math.sqrt(dSq) - this.radius[slot]!;
      if (gap <= tolerance && (gap < bestGap || (gap === bestGap && slot < best))) {
        best = slot;
        bestGap = gap;
      }
    });
    return best;
  }

  info(slot: number): CritterInfo {
    const heading = this.heading[slot]!;
    const size = this.size[slot]!;
    const vx = this.vx[slot]!;
    const vy = this.vy[slot]!;
    const effect = terrainEffect(this.terrain, this.config, this.x[slot]!, this.y[slot]!, Math.cos(heading), Math.sin(heading), size, {
      wading: 1,
      slope: 1,
      grade: 0,
    });
    return {
      id: this.id[slot]!,
      x: this.x[slot]!,
      y: this.y[slot]!,
      heading,
      vx,
      vy,
      speed: Math.sqrt(vx * vx + vy * vy),
      size,
      maxSpeed: this.maxSpeed[slot]!,
      turnRate: this.turnRate[slot]!,
      radius: this.radius[slot]!,
      mass: this.mass[slot]!,
      acceleration: accelerationOf(size, this.config),
      controller: this.controllerKind[slot] as ControllerKind,
      turn: this.turn[slot]!,
      thrust: this.thrust[slot]!,
      blocked: this.blocked[slot] === 1,
      ...effect,
    };
  }

  snapshot(): CritterSnapshot {
    const n = this.count;
    const snapshot: CritterSnapshot = {
      count: n,
      id: new Uint32Array(n),
      x: new Float32Array(n),
      y: new Float32Array(n),
      heading: new Float32Array(n),
      radius: new Float32Array(n),
      controller: new Uint8Array(n),
    };
    let k = 0;
    for (let i = 0; i < this.slots; i++) {
      if (!this.alive[i]) continue;
      snapshot.id[k] = this.id[i]!;
      snapshot.x[k] = this.x[i]!;
      snapshot.y[k] = this.y[i]!;
      snapshot.heading[k] = this.heading[i]!;
      snapshot.radius[k] = this.radius[i]!;
      snapshot.controller[k] = this.controllerKind[i]!;
      k++;
    }
    return snapshot;
  }

  /** Hash of all critter state, for the state hash. */
  hash(seed: number): number {
    const n = this.slots;
    let hash = fnv1aWords([this.count, n, this.nextId, ...this.free], seed);
    const fields: ArrayBufferView[] = [
      this.id.subarray(0, n),
      this.alive.subarray(0, n),
      this.x.subarray(0, n),
      this.y.subarray(0, n),
      this.heading.subarray(0, n),
      this.vx.subarray(0, n),
      this.vy.subarray(0, n),
      this.size.subarray(0, n),
      this.maxSpeed.subarray(0, n),
      this.turnRate.subarray(0, n),
      this.turn.subarray(0, n),
      this.thrust.subarray(0, n),
      this.attack.subarray(0, n),
      this.mate.subarray(0, n),
      this.blocked.subarray(0, n),
      this.controllerKind.subarray(0, n),
    ];
    for (const field of fields) hash = fnv1aArray(field, hash);
    hash = this.keyboard.hash(hash);
    for (let i = 0; i < n; i++) if (this.alive[i] && this.controllerKind[i] === ControllerKind.Wander) hash = this.controllers[i]!.hash(hash);
    return hash;
  }

  private allocate(): number {
    if (this.slots === this.alive.length) {
      const capacity = this.alive.length * 2;
      const grow = <T extends Float64Array | Uint8Array | Uint32Array>(old: T, make: (n: number) => T): T => {
        const array = make(capacity);
        array.set(old);
        return array;
      };
      const f64 = (n: number) => new Float64Array(n);
      const u8 = (n: number) => new Uint8Array(n);
      this.id = grow(this.id, (n) => new Uint32Array(n));
      this.alive = grow(this.alive, u8);
      this.x = grow(this.x, f64);
      this.y = grow(this.y, f64);
      this.heading = grow(this.heading, f64);
      this.vx = grow(this.vx, f64);
      this.vy = grow(this.vy, f64);
      this.size = grow(this.size, f64);
      this.maxSpeed = grow(this.maxSpeed, f64);
      this.turnRate = grow(this.turnRate, f64);
      this.radius = grow(this.radius, f64);
      this.mass = grow(this.mass, f64);
      this.turn = grow(this.turn, f64);
      this.thrust = grow(this.thrust, f64);
      this.attack = grow(this.attack, f64);
      this.mate = grow(this.mate, f64);
      this.blocked = grow(this.blocked, u8);
      this.controllerKind = grow(this.controllerKind, u8);
      this.pushX = grow(this.pushX, f64);
      this.pushY = grow(this.pushY, f64);
    }
    return this.slots++;
  }
}

function clampTrait(trait: keyof CritterTraits, value: number): number {
  const [min, max] = TRAIT_LIMITS[trait];
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}
