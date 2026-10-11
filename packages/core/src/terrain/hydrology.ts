/**
 * Drainage on the terrain grid (docs/DESIGN.md §4.2.1).
 *
 * Priority-flood (Barnes, Lehman & Mulla 2014): starting from the outlets, flood
 * the grid in order of rising water level. Every sample gets a receiver, the
 * neighbor it drains into, so water can always reach an outlet. Pits are filled
 * up to their spill level along the way, which is how lakes are found.
 *
 * Deterministic: ties in the queue are broken by sample index. Arithmetic only.
 */

const NEIGHBOR_DC = [1, -1, 0, 0, 1, 1, -1, -1];
const NEIGHBOR_DR = [0, 0, 1, -1, 1, -1, 1, -1];
/** Tiny rise per step across flats and filled pits, so every route strictly descends. */
const FLAT_EPSILON = 1e-9;

export interface Drainage {
  /** Water level after filling pits: at least the elevation, and at the spill level inside pits. */
  filled: Float64Array;
  /** Index of the sample each sample drains into, or -1 for outlets. */
  receiver: Int32Array;
  /** Samples in the order they were flooded: lowest water level first. Receivers always come earlier. */
  order: Int32Array;
}

export function priorityFlood(
  elevation: ArrayLike<number>,
  cols: number,
  rows: number,
  isOutlet: (index: number) => boolean,
): Drainage {
  const n = cols * rows;
  const filled = new Float64Array(n);
  const receiver = new Int32Array(n).fill(-1);
  const order = new Int32Array(n);
  const done = new Uint8Array(n);
  const heap = new MinHeap(n);
  let count = 0;

  for (let i = 0; i < n; i++) {
    if (isOutlet(i)) {
      filled[i] = elevation[i]!;
      done[i] = 1;
      heap.push(i, filled[i]!);
    }
  }

  while (heap.size > 0) {
    const i = heap.pop();
    order[count++] = i;
    const c = i % cols;
    const r = (i - c) / cols;
    for (let k = 0; k < 8; k++) {
      const nc = c + NEIGHBOR_DC[k]!;
      const nr = r + NEIGHBOR_DR[k]!;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const j = nr * cols + nc;
      if (done[j]) continue;
      done[j] = 1;
      filled[j] = Math.max(elevation[j]!, filled[i]! + FLAT_EPSILON);
      receiver[j] = i;
      heap.push(j, filled[j]!);
    }
  }

  return { filled, receiver, order: count === n ? order : order.slice(0, count) };
}

/** Upstream area of every sample, in samples (each sample contributes 1). */
export function flowAccumulation(drainage: Drainage, n: number): Float64Array {
  const flow = new Float64Array(n).fill(1);
  // Highest first: every sample passes its total to its receiver, which comes earlier in the order.
  for (let k = drainage.order.length - 1; k >= 0; k--) {
    const i = drainage.order[k]!;
    const r = drainage.receiver[i]!;
    if (r >= 0) flow[r] = flow[r]! + flow[i]!;
  }
  return flow;
}

/** Binary min-heap of sample indices keyed by level, ties broken by index for determinism. */
class MinHeap {
  private readonly items: Int32Array;
  private readonly keys: Float64Array;
  size = 0;

  constructor(capacity: number) {
    this.items = new Int32Array(capacity);
    this.keys = new Float64Array(capacity);
  }

  push(item: number, key: number): void {
    let k = this.size++;
    this.items[k] = item;
    this.keys[k] = key;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (!this.less(k, parent)) break;
      this.swap(k, parent);
      k = parent;
    }
  }

  pop(): number {
    const top = this.items[0]!;
    this.size--;
    if (this.size > 0) {
      this.items[0] = this.items[this.size]!;
      this.keys[0] = this.keys[this.size]!;
      let k = 0;
      for (;;) {
        const left = 2 * k + 1;
        const right = left + 1;
        let smallest = k;
        if (left < this.size && this.less(left, smallest)) smallest = left;
        if (right < this.size && this.less(right, smallest)) smallest = right;
        if (smallest === k) break;
        this.swap(k, smallest);
        k = smallest;
      }
    }
    return top;
  }

  private less(a: number, b: number): boolean {
    const ka = this.keys[a]!;
    const kb = this.keys[b]!;
    return ka < kb || (ka === kb && this.items[a]! < this.items[b]!);
  }

  private swap(a: number, b: number): void {
    const item = this.items[a]!;
    this.items[a] = this.items[b]!;
    this.items[b] = item;
    const key = this.keys[a]!;
    this.keys[a] = this.keys[b]!;
    this.keys[b] = key;
  }
}
