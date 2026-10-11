/** Hash cell size in world units. Radius queries for crowding, eating, and vision all span a few cells. */
export const SPATIAL_CELL_SIZE = 32;

/**
 * Uniform spatial hash over the world (docs/DESIGN.md §3.4). Entries are small
 * non-negative integer ids, such as an entity's slot, each with a position.
 * Each hash cell keeps a doubly linked list of its entries, so inserting,
 * removing, and moving are O(1), and a radius query only looks at the cells
 * the circle overlaps. Iteration order depends only on the order of past
 * inserts and removes, so it is deterministic.
 *
 * Points outside the world are kept in the nearest edge cell.
 */
export class SpatialHash {
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;
  /** First id in each cell, or -1. */
  private readonly head: Int32Array;
  private next: Int32Array;
  private prev: Int32Array;
  /** Cell of each id, or -1 if the id is not in the hash. */
  private cellOf: Int32Array;
  private xs: Float64Array;
  private ys: Float64Array;
  private size = 0;

  constructor(width: number, height: number, cellSize = SPATIAL_CELL_SIZE, capacity = 1024) {
    this.cellSize = cellSize;
    this.cols = Math.max(1, Math.ceil(width / cellSize));
    this.rows = Math.max(1, Math.ceil(height / cellSize));
    this.head = new Int32Array(this.cols * this.rows).fill(-1);
    this.next = new Int32Array(capacity);
    this.prev = new Int32Array(capacity);
    this.cellOf = new Int32Array(capacity).fill(-1);
    this.xs = new Float64Array(capacity);
    this.ys = new Float64Array(capacity);
  }

  /** Number of entries. */
  get count(): number {
    return this.size;
  }

  has(id: number): boolean {
    return id < this.cellOf.length && this.cellOf[id]! >= 0;
  }

  insert(id: number, x: number, y: number): void {
    if (id >= this.cellOf.length) this.grow(id + 1);
    if (this.cellOf[id]! >= 0) throw new Error(`SpatialHash: id ${id} is already present`);
    this.xs[id] = x;
    this.ys[id] = y;
    this.link(id, this.cellAt(x, y));
    this.size++;
  }

  remove(id: number): void {
    if (!this.has(id)) throw new Error(`SpatialHash: id ${id} is not present`);
    this.unlink(id);
    this.cellOf[id] = -1;
    this.size--;
  }

  move(id: number, x: number, y: number): void {
    if (!this.has(id)) throw new Error(`SpatialHash: id ${id} is not present`);
    this.xs[id] = x;
    this.ys[id] = y;
    const cell = this.cellAt(x, y);
    if (cell === this.cellOf[id]) return;
    this.unlink(id);
    this.link(id, cell);
  }

  /**
   * Calls visit for every entry within r of (x, y), edge included, with its
   * squared distance. The hash must not be changed during the visit.
   */
  forEachWithin(x: number, y: number, r: number, visit: (id: number, distanceSq: number) => void): void {
    const rSq = r * r;
    const { xs, ys, next, head, cols } = this;
    const [c0, c1, r0, r1] = this.cellRange(x, y, r);
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        for (let id = head[row * cols + col]!; id >= 0; id = next[id]!) {
          const dx = xs[id]! - x;
          const dy = ys[id]! - y;
          const dSq = dx * dx + dy * dy;
          if (dSq <= rSq) visit(id, dSq);
        }
      }
    }
  }

  /** Ids of every entry within r of (x, y), appended to out. */
  queryRadius(x: number, y: number, r: number, out: number[] = []): number[] {
    this.forEachWithin(x, y, r, (id) => out.push(id));
    return out;
  }

  /** Number of entries within r of (x, y), counting no further than limit. */
  countWithin(x: number, y: number, r: number, limit = Infinity): number {
    if (limit <= 0) return 0;
    const rSq = r * r;
    const { xs, ys, next, head, cols } = this;
    const [c0, c1, r0, r1] = this.cellRange(x, y, r);
    let count = 0;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        for (let id = head[row * cols + col]!; id >= 0; id = next[id]!) {
          const dx = xs[id]! - x;
          const dy = ys[id]! - y;
          if (dx * dx + dy * dy <= rSq && ++count >= limit) return count;
        }
      }
    }
    return count;
  }

  private cellAt(x: number, y: number): number {
    const col = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cellSize)));
    const row = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cellSize)));
    return row * this.cols + col;
  }

  /** Columns and rows of the cells a circle overlaps: [first col, last col, first row, last row]. */
  private cellRange(x: number, y: number, r: number): [number, number, number, number] {
    const s = this.cellSize;
    const clampCol = (c: number) => Math.min(this.cols - 1, Math.max(0, c));
    const clampRow = (c: number) => Math.min(this.rows - 1, Math.max(0, c));
    return [
      clampCol(Math.floor((x - r) / s)),
      clampCol(Math.floor((x + r) / s)),
      clampRow(Math.floor((y - r) / s)),
      clampRow(Math.floor((y + r) / s)),
    ];
  }

  private link(id: number, cell: number): void {
    const first = this.head[cell]!;
    this.prev[id] = -1;
    this.next[id] = first;
    if (first >= 0) this.prev[first] = id;
    this.head[cell] = id;
    this.cellOf[id] = cell;
  }

  private unlink(id: number): void {
    const before = this.prev[id]!;
    const after = this.next[id]!;
    if (before >= 0) this.next[before] = after;
    else this.head[this.cellOf[id]!] = after;
    if (after >= 0) this.prev[after] = before;
  }

  private grow(minCapacity: number): void {
    const capacity = Math.max(minCapacity, this.cellOf.length * 2);
    const resize = <T extends Int32Array | Float64Array>(old: T, make: (n: number) => T, fill = 0): T => {
      const array = make(capacity);
      if (fill !== 0) array.fill(fill);
      array.set(old);
      return array;
    };
    this.next = resize(this.next, (n) => new Int32Array(n));
    this.prev = resize(this.prev, (n) => new Int32Array(n));
    this.cellOf = resize(this.cellOf, (n) => new Int32Array(n), -1);
    this.xs = resize(this.xs, (n) => new Float64Array(n));
    this.ys = resize(this.ys, (n) => new Float64Array(n));
  }
}
