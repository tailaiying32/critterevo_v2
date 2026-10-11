/**
 * River networks (docs/DESIGN.md §4.2.1).
 *
 * Rivers are traced down the drainage receivers wherever enough upstream area
 * collects, smoothed into curves, and stored as line segments with a width.
 * A point is in a river if it lies within half the width of a segment, so
 * segments are capsules with round ends. The renderer draws the same capsules.
 */

/** Floats per segment in TerrainData.rivers: x1, y1, x2, y2, width. */
export const RIVER_STRIDE = 5;

/** Chaikin corner-cutting passes applied to each river polyline. */
const SMOOTHING_PASSES = 3;
/** Simplification tolerance, in samples: removes the grid's stair steps before smoothing. */
const SIMPLIFY_TOLERANCE = 0.9;

export interface RiverTraceInput {
  cols: number;
  rows: number;
  cellSize: number;
  worldWidth: number;
  worldHeight: number;
  receiver: Int32Array;
  flow: Float64Array;
  isWater: (index: number) => boolean;
  isRiver: (index: number) => boolean;
  widthAt: (index: number) => number;
}

export function traceRivers(input: RiverTraceInput): Float32Array {
  const { cols, rows, cellSize, receiver, flow, isWater, isRiver, widthAt } = input;
  const n = cols * rows;
  const centerX = (i: number) => ((i % cols) + 0.5) * cellSize;
  const centerY = (i: number) => (Math.floor(i / cols) + 0.5) * cellSize;

  // For each river sample: does any river flow into it, and which water sample feeds it (a lake outlet)?
  const hasRiverUpstream = new Uint8Array(n);
  const waterUpstream = new Int32Array(n).fill(-1);
  for (let j = 0; j < n; j++) {
    const r = receiver[j]!;
    if (r < 0 || !isRiver(r)) continue;
    if (isRiver(j)) hasRiverUpstream[r] = 1;
    else if (isWater(j) && (waterUpstream[r]! < 0 || flow[j]! > flow[waterUpstream[r]!]!)) waterUpstream[r] = j;
  }

  const segments: number[] = [];
  const visited = new Uint8Array(n);
  for (let source = 0; source < n; source++) {
    if (!isRiver(source) || hasRiverUpstream[source]) continue;

    const xs: number[] = [];
    const ys: number[] = [];
    const ws: number[] = [];
    const lake = waterUpstream[source]!;
    if (lake >= 0) {
      xs.push(centerX(lake));
      ys.push(centerY(lake));
      ws.push(widthAt(source));
    }

    let cur = source;
    for (;;) {
      xs.push(centerX(cur));
      ys.push(centerY(cur));
      ws.push(widthAt(cur));
      visited[cur] = 1;
      const next = receiver[cur]!;
      if (next < 0) {
        // Outlet on the world edge: the river leaves the map through the nearest wall.
        const c = cur % cols;
        const r = Math.floor(cur / cols);
        let ex = centerX(cur);
        let ey = centerY(cur);
        if (c === 0) ex = 0;
        else if (c === cols - 1) ex = input.worldWidth;
        if (r === 0) ey = 0;
        else if (r === rows - 1) ey = input.worldHeight;
        if (ex !== centerX(cur) || ey !== centerY(cur)) {
          xs.push(ex);
          ys.push(ey);
          ws.push(widthAt(cur));
        }
        break;
      }
      if (isWater(next) || visited[next] || !isRiver(next)) {
        // Mouth into a lake or the sea, or a confluence with a river already traced.
        xs.push(centerX(next));
        ys.push(centerY(next));
        ws.push(isRiver(next) ? widthAt(next) : widthAt(cur));
        break;
      }
      cur = next;
    }

    let line = simplify(xs, ys, ws, SIMPLIFY_TOLERANCE * cellSize);
    for (let pass = 0; pass < SMOOTHING_PASSES; pass++) line = chaikin(line.xs, line.ys, line.ws);
    for (let k = 0; k + 1 < line.xs.length; k++) {
      segments.push(line.xs[k]!, line.ys[k]!, line.xs[k + 1]!, line.ys[k + 1]!, (line.ws[k]! + line.ws[k + 1]!) / 2);
    }
  }
  return Float32Array.from(segments);
}

/**
 * Ramer-Douglas-Peucker simplification: drops points within `tolerance` of the
 * line through their neighbors. Turns grid stair steps into straight runs.
 */
function simplify(xs: number[], ys: number[], ws: number[], tolerance: number): { xs: number[]; ys: number[]; ws: number[] } {
  const keep = new Uint8Array(xs.length);
  keep[0] = 1;
  keep[xs.length - 1] = 1;
  const stack: [number, number][] = [[0, xs.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    const dx = xs[b]! - xs[a]!;
    const dy = ys[b]! - ys[a]!;
    const length = Math.sqrt(dx * dx + dy * dy);
    let farthest = -1;
    let farthestDistance = tolerance;
    for (let k = a + 1; k < b; k++) {
      const distance =
        length > 0
          ? Math.abs(dy * (xs[k]! - xs[a]!) - dx * (ys[k]! - ys[a]!)) / length
          : Math.sqrt((xs[k]! - xs[a]!) * (xs[k]! - xs[a]!) + (ys[k]! - ys[a]!) * (ys[k]! - ys[a]!));
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthest = k;
      }
    }
    if (farthest >= 0) {
      keep[farthest] = 1;
      stack.push([a, farthest], [farthest, b]);
    }
  }
  const out = { xs: [] as number[], ys: [] as number[], ws: [] as number[] };
  for (let k = 0; k < xs.length; k++) {
    if (!keep[k]) continue;
    out.xs.push(xs[k]!);
    out.ys.push(ys[k]!);
    out.ws.push(ws[k]!);
  }
  return out;
}

/** One pass of Chaikin corner cutting. Keeps both endpoints. */
function chaikin(xs: number[], ys: number[], ws: number[]): { xs: number[]; ys: number[]; ws: number[] } {
  if (xs.length < 3) return { xs, ys, ws };
  const ox = [xs[0]!];
  const oy = [ys[0]!];
  const ow = [ws[0]!];
  for (let k = 0; k + 1 < xs.length; k++) {
    const isFirst = k === 0;
    const isLast = k + 2 === xs.length;
    if (!isFirst) {
      ox.push(0.75 * xs[k]! + 0.25 * xs[k + 1]!);
      oy.push(0.75 * ys[k]! + 0.25 * ys[k + 1]!);
      ow.push(0.75 * ws[k]! + 0.25 * ws[k + 1]!);
    }
    if (!isLast) {
      ox.push(0.25 * xs[k]! + 0.75 * xs[k + 1]!);
      oy.push(0.25 * ys[k]! + 0.75 * ys[k + 1]!);
      ow.push(0.25 * ws[k]! + 0.75 * ws[k + 1]!);
    }
  }
  ox.push(xs[xs.length - 1]!);
  oy.push(ys[ys.length - 1]!);
  ow.push(ws[ws.length - 1]!);
  return { xs: ox, ys: oy, ws: ow };
}

// ---------------- Point queries ----------------

const BUCKET_SIZE = 40;

interface RiverIndex {
  cols: number;
  rows: number;
  /** Segment indices per bucket. */
  buckets: number[][];
}

const indexCache = new WeakMap<Float32Array, RiverIndex>();

function riverIndex(rivers: Float32Array, worldWidth: number, worldHeight: number): RiverIndex {
  const cached = indexCache.get(rivers);
  if (cached) return cached;
  const cols = Math.max(1, Math.ceil(worldWidth / BUCKET_SIZE));
  const rows = Math.max(1, Math.ceil(worldHeight / BUCKET_SIZE));
  const buckets: number[][] = Array.from({ length: cols * rows }, () => []);
  const count = rivers.length / RIVER_STRIDE;
  for (let s = 0; s < count; s++) {
    const o = s * RIVER_STRIDE;
    const half = rivers[o + 4]! / 2;
    const minX = Math.min(rivers[o]!, rivers[o + 2]!) - half;
    const maxX = Math.max(rivers[o]!, rivers[o + 2]!) + half;
    const minY = Math.min(rivers[o + 1]!, rivers[o + 3]!) - half;
    const maxY = Math.max(rivers[o + 1]!, rivers[o + 3]!) + half;
    const c0 = Math.max(0, Math.floor(minX / BUCKET_SIZE));
    const c1 = Math.min(cols - 1, Math.floor(maxX / BUCKET_SIZE));
    const r0 = Math.max(0, Math.floor(minY / BUCKET_SIZE));
    const r1 = Math.min(rows - 1, Math.floor(maxY / BUCKET_SIZE));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) buckets[r * cols + c]!.push(s);
  }
  const index = { cols, rows, buckets };
  indexCache.set(rivers, index);
  return index;
}

/** Width of the widest river covering the point, or 0 if none. */
export function riverWidthAt(rivers: Float32Array, worldWidth: number, worldHeight: number, x: number, y: number): number {
  if (rivers.length === 0) return 0;
  const index = riverIndex(rivers, worldWidth, worldHeight);
  const c = Math.floor(x / BUCKET_SIZE);
  const r = Math.floor(y / BUCKET_SIZE);
  if (c < 0 || r < 0 || c >= index.cols || r >= index.rows) return 0;
  let widest = 0;
  for (const s of index.buckets[r * index.cols + c]!) {
    const o = s * RIVER_STRIDE;
    const width = rivers[o + 4]!;
    if (width <= widest) continue;
    const ax = rivers[o]!;
    const ay = rivers[o + 1]!;
    const dx = rivers[o + 2]! - ax;
    const dy = rivers[o + 3]! - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / lengthSq)) : 0;
    const px = ax + t * dx - x;
    const py = ay + t * dy - y;
    if (px * px + py * py <= (width * width) / 4) widest = width;
  }
  return widest;
}
