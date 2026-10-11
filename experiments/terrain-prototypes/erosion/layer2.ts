/**
 * Scratch prototype of Layer 2: tectonic uplift and river erosion running together
 * (stream power law, Braun & Willett 2013 implicit scheme). Not part of the repo.
 */
import { writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { priorityFlood } from "../../../packages/core/src/terrain/hydrology.ts";
import { createOctaveNoise } from "../../../packages/core/src/terrain/noise.ts";
import { Rng } from "../../../packages/core/src/rng.ts";
import { generate, N } from "../plates/plates.ts";
import { chamferDistance } from "../../../packages/core/src/terrain/distance.ts";
import { RIVER_STRIDE, traceRivers } from "../../../packages/core/src/terrain/rivers.ts";

const OUT = process.argv[2]!;
const SEEDS = (process.argv[3] ?? "1,2,3").split(",").map(Number);

// ---------------- Parameters ----------------
const M = 200; // simulation grid: 200 x 200, each cell 10 world units
const DX = 1000; // meters per cell: the 2000 u world stands for a 200 km region
const INITIAL_RELIEF = 1500; // meters per unit of layer-1 elevation above sea level
const UPLIFT_MAX = Number(process.env.UPLIFT ?? 2e-3); // m/yr where plates collide hardest (2 mm/yr)
const SUBSIDENCE = 0; // rifts were already lowered in layer 1; land does not keep sinking
const K = Number(process.env.K ?? 2e-6); // erodibility, stream power law
const MEXP = 0.5; // drainage area exponent
const DIFFUSION = Number(process.env.DIFFUSION ?? 4); // m^2/yr, soil creep rounding ridges
const DT = 5e4; // years per step
const STEPS = Number(process.env.STEPS ?? 150); // 7.5 million years
const RIVER_AREA = 300; // cells (km^2) of drainage before a line is drawn as a river
const BACKGROUND_UPLIFT = Number(process.env.BACKGROUND ?? 2.5e-4); // m/yr in hill country; plains get none
const COASTAL_PLAIN = 60e3; // meters: background uplift fades in over this distance from the sea
const INITIAL_NOISE = Number(process.env.INITIAL_NOISE ?? 0.3); // how much of layer 1's bumpy texture to keep
const ROUTING_RANDOMNESS = Number(process.env.RANDOMNESS ?? 1); // 0: always steepest; 1: random in proportion to slope
const HARDNESS_VARIATION = Number(process.env.HARDNESS ?? 0.6); // 0: uniform rock; 0.6: erodibility varies 0.4x to 1.6x
const HARDNESS_SIZE = 300; // world units: size of hard and soft rock regions
const CELL = 2000 / M; // world units per simulation cell
const PEAK_HEIGHT = Number(process.env.PEAK ?? 6000); // meters: heights are scaled so the tallest peaks reach about this
const RIVER_MIN_WIDTH = 1.5; // world units
const RIVER_WIDTH_PER_SQRT_AREA = 0.035; // world units of width per world unit of sqrt(drainage area)

const at = (c: number, r: number) => r * M + c;

const NB_DC = [1, -1, 0, 0, 1, 1, -1, -1];
const NB_DR = [0, 0, 1, -1, 1, -1, 1, -1];
const NB_DIST = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

function simulate(seed: number) {
  const g = generate(seed);
  const n = M * M;
  const rng = Rng.derive(seed, "terrain.erosion.routing");
  const background = createOctaveNoise(Rng.derive(seed, "terrain.erosion.background"), { featureSize: 400, octaves: 3, persistence: 0.5, lacunarity: 2 });
  // Downsample layer 1 (400 x 400) to the simulation grid by averaging 2 x 2 blocks.
  // Starting heights keep the large-scale layout but only part of layer 1's bumpy noise.
  const h = new Float64Array(n), uplift = new Float64Array(n);
  for (let r = 0; r < M; r++) for (let c = 0; c < M; c++) {
    let e = 0, u = 0;
    for (const [dc, dr] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const i = (2 * r + dr) * N + 2 * c + dc; e += g.elevation[i]!; u += g.uplift[i]!; }
    e /= 4; u /= 4;
    h[at(c, r)] = (e - g.sea) * INITIAL_RELIEF;
    uplift[at(c, r)] = u >= 0 ? u * UPLIFT_MAX : u * UPLIFT_MAX * SUBSIDENCE;
  }
  // Background uplift: hill country in patches, plains elsewhere, fading to lowland near the sea.
  {
    const toSea = chamferDistance((i) => h[i]! < 0, M, M);
    const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    for (let r = 0; r < M; r++) for (let c = 0; c < M; c++) {
      const i = at(c, r);
      const x = (c + 0.5) * 10, y = (r + 0.5) * 10;
      const patch = 0.5 + 0.5 * background.sum(x, y, 0, 3) / 1.75; // about 0..1
      const hills = smoothstep(0.45, 0.75, patch);
      const inland = smoothstep(0, COASTAL_PLAIN, toSea[i]! * DX);
      uplift[i] += BACKGROUND_UPLIFT * hills * inland;
    }
  }
  // Smooth the starting heights toward their local average, keeping INITIAL_NOISE of the texture.
  {
    const smooth = blur(h, 4);
    for (let i = 0; i < n; i++) h[i] = smooth[i]! + INITIAL_NOISE * (h[i]! - smooth[i]!);
  }
  // Water below sea level at the start is base level: fixed, where every river ends.
  const sea = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (h[i]! < 0) sea[i] = 1;

  // Rock hardness: erodibility varies smoothly across the map.
  const hardness = createOctaveNoise(Rng.derive(seed, "terrain.erosion.hardness"), { featureSize: HARDNESS_SIZE, octaves: 3, persistence: 0.5, lacunarity: 2 });
  const erodibility = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = ((i % M) + 0.5) * CELL, y = (Math.floor(i / M) + 0.5) * CELL;
    erodibility[i] = K * (1 + HARDNESS_VARIATION * hardness.sum(x, y, 0, 3) / 1.75);
  }

  const receiver = new Int32Array(n);
  const order = new Int32Array(n);
  const area = new Float64Array(n);
  const lap = new Float64Array(n);
  // Explicit diffusion is stable below 0.25 per step, so split strong creep into sub-steps.
  const diffusionTotal = (DIFFUSION * DT) / (DX * DX);
  const diffusionSubsteps = Math.max(1, Math.ceil(diffusionTotal / 0.2));
  const diffusionK = diffusionTotal / diffusionSubsteps;

  const isBorder = (i: number) => { const c = i % M, r = (i - c) / M; return c === 0 || r === 0 || c === M - 1 || r === M - 1; };
  const route = () => {
    // Fill dips so water always flows through (no fake lakes); flats get a tiny tilt.
    // The map edge is open: beyond it the land is assumed to continue down to sea level.
    const flood = priorityFlood(h, M, M, (i) => sea[i] === 1 || isBorder(i));
    for (let i = 0; i < n; i++) if (!sea[i]) h[i] = flood.filled[i]!;
    // Receivers: a downhill neighbor, chosen by true slope (drop / distance),
    // at random in proportion to slope so valleys don't lock onto the grid.
    for (let i = 0; i < n; i++) {
      receiver[i] = -1;
      if (sea[i]) continue;
      const c = i % M, r = (i - c) / M;
      let total = 0, best = -1, bestSlope = 0;
      const slopes: number[] = [];
      const targets: number[] = [];
      if (c === 0 || r === 0 || c === M - 1 || r === M - 1) {
        // Off-map neighbor at sea level, one cell away: target -1.
        const slope = h[i]! / 1;
        if (slope > 0) { slopes.push(slope); targets.push(-1); total += slope; bestSlope = slope; best = -1; }
      }
      for (let k = 0; k < 8; k++) {
        const nc = c + NB_DC[k]!, nr = r + NB_DR[k]!;
        if (nc < 0 || nr < 0 || nc >= M || nr >= M) continue;
        const j = nr * M + nc;
        const slope = (h[i]! - h[j]!) / NB_DIST[k]!;
        if (slope <= 0) continue;
        slopes.push(slope); targets.push(j); total += slope;
        if (slope > bestSlope) { bestSlope = slope; best = j; }
      }
      if (targets.length === 0) { receiver[i] = flood.receiver[i]!; continue; }
      if (ROUTING_RANDOMNESS > 0 && targets.length > 1) {
        // Mix of steepest and slope-weighted random choice.
        if (rng.next() < ROUTING_RANDOMNESS) {
          let pick = rng.next() * total;
          for (let k = 0; k < targets.length; k++) { pick -= slopes[k]!; if (pick <= 0) { best = targets[k]!; break; } }
        }
      } else if (targets.length === 1) {
        best = targets[0]!;
      }
      receiver[i] = best;
    }
    // Order: lowest first, so every receiver is processed before the cells draining into it.
    const idxs = Array.from({ length: n }, (_, i) => i).sort((a, b) => h[a]! - h[b]! || a - b);
    for (let k = 0; k < n; k++) order[k] = idxs[k]!;
    area.fill(1);
    for (let k = n - 1; k >= 0; k--) { const i = order[k]!; const r = receiver[i]!; if (r >= 0) area[r] += area[i]!; }
  };

  const t0 = performance.now();
  for (let step = 0; step < STEPS; step++) {
    for (let i = 0; i < n; i++) if (!sea[i]) h[i] += uplift[i]! * DT;
    route();
    // River incision, solved implicitly from the sea upstream: stable for big steps.
    for (let k = 0; k < n; k++) {
      const i = order[k]!;
      const r = receiver[i]!;
      if (sea[i] || (r < 0 && !isBorder(i))) continue;
      const diagonal = r >= 0 && i % M !== r % M && Math.floor(i / M) !== Math.floor(r / M);
      const dist = diagonal ? DX * Math.SQRT2 : DX;
      const f = (erodibility[i]! * DT * Math.pow(area[i]! * DX * DX, MEXP)) / dist;
      // Rivers cut down to the water's surface, not the sea floor. Off the map edge is sea level.
      const base = r < 0 || sea[r] ? 0 : h[r]!;
      if (h[i]! > base) h[i] = (h[i]! + f * base) / (1 + f);
    }
    // Soil creep: a little diffusion rounds off ridges.
    // Water counts as sea level, so creep doesn't drag the shore down to the sea floor.
    const surface = (c: number, r: number) => { const j = at(c, r); return sea[j] ? 0 : h[j]!; };
    for (let sub = 0; sub < diffusionSubsteps; sub++) {
      for (let r = 0; r < M; r++) for (let c = 0; c < M; c++) {
        const i = at(c, r);
        lap[i] = surface(Math.max(0, c - 1), r) + surface(Math.min(M - 1, c + 1), r) + surface(c, Math.max(0, r - 1)) + surface(c, Math.min(M - 1, r + 1)) - 4 * h[i]!;
      }
      for (let i = 0; i < n; i++) if (!sea[i]) h[i] += diffusionK * lap[i]!;
    }
  }
  route();
  // Scale land heights so the tallest peaks (99.9th percentile) reach PEAK_HEIGHT. Shapes are unchanged.
  {
    const land = Array.from(h).filter((v, i) => !sea[i] && v > 0).sort((a, b) => a - b);
    const top = land[Math.floor(0.999 * (land.length - 1))] ?? 1;
    const scale = PEAK_HEIGHT / top;
    for (let i = 0; i < n; i++) if (!sea[i]) h[i] = h[i]! * scale;
  }
  const ms = performance.now() - t0;
  const rivers = traceRivers({
    cols: M,
    rows: M,
    cellSize: CELL,
    worldWidth: 2000,
    worldHeight: 2000,
    receiver,
    flow: area,
    isWater: (i) => sea[i] === 1,
    isRiver: (i) => !sea[i] && area[i]! >= RIVER_AREA,
    widthAt: (i) => Math.max(RIVER_MIN_WIDTH, RIVER_WIDTH_PER_SQRT_AREA * CELL * Math.sqrt(area[i]!)),
  });
  const lake = new Uint8Array(n);
  let maxH = 0; for (let i = 0; i < n; i++) maxH = Math.max(maxH, h[i]!);
  return { g, h, sea, lake, area, receiver, ms, maxH, rivers };
}

function blur(f: Float64Array, radius: number): Float64Array {
  let out = f;
  for (let pass = 0; pass < 2; pass++) {
    const tmp = new Float64Array(out.length), next = new Float64Array(out.length);
    for (let r = 0; r < M; r++) for (let c = 0; c < M; c++) { let s = 0, k = 0; for (let d = -radius; d <= radius; d++) { const cc = Math.min(M - 1, Math.max(0, c + d)); s += out[at(cc, r)]!; k++; } tmp[at(c, r)] = s / k; }
    for (let r = 0; r < M; r++) for (let c = 0; c < M; c++) { let s = 0, k = 0; for (let d = -radius; d <= radius; d++) { const rr = Math.min(M - 1, Math.max(0, r + d)); s += tmp[at(c, rr)]!; k++; } next[at(c, r)] = s / k; }
    out = next;
  }
  return out;
}

// ---------------- Rendering ----------------
type RGB = [number, number, number];
const P = 400;
const stops: [number, RGB][] = [[0, [91, 138, 74]], [0.25, [201, 183, 122]], [0.6, [139, 109, 79]], [1, [240, 240, 240]]];
function ramp(t: number): RGB {
  t = Math.min(1, Math.max(0, t));
  for (let k = 1; k < stops.length; k++) { const [a, ca] = stops[k - 1]!, [b, cb] = stops[k]!; if (t <= b) { const f = (t - a) / (b - a); return ca.map((x, j) => x + (cb[j]! - x) * f) as RGB; } }
  return stops[stops.length - 1]![1];
}
function bilinear(f: Float64Array, x: number, y: number): number {
  const gx = Math.min(M - 1.001, Math.max(0, x - 0.5)), gy = Math.min(M - 1.001, Math.max(0, y - 0.5));
  const c = Math.floor(gx), r = Math.floor(gy), u = gx - c, v = gy - r;
  return f[at(c, r)]! * (1 - u) * (1 - v) + f[at(c + 1, r)]! * u * (1 - v) + f[at(c, r + 1)]! * (1 - u) * v + f[at(c + 1, r + 1)]! * u * v;
}
const SHALLOW: RGB = [90, 156, 203];
function renderRelief(s: ReturnType<typeof simulate>, rivers: boolean, x0 = 0, y0 = 0, span = 2000): Uint8ClampedArray {
  const img = new Uint8ClampedArray(P * P * 3);
  const worldPerPx = span / P;
  const exaggeration = 12;
  for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) {
    const wx = x0 + (i + 0.5) * worldPerPx, wy = y0 + (j + 0.5) * worldPerPx;
    const x = wx / CELL, y = wy / CELL; // simulation cell coordinates
    const hh = bilinear(s.h, x, y);
    let col: RGB;
    if (hh < 0) { const d = Math.min(1, -hh / 1200); col = [90 - 68 * d, 156 - 99 * d, 203 - 109 * d]; }
    else {
      col = ramp(hh / Math.max(1, s.maxH));
      const dzdx = ((bilinear(s.h, x + 0.5, y) - bilinear(s.h, x - 0.5, y)) * exaggeration) / DX;
      const dzdy = ((bilinear(s.h, x, y + 0.5) - bilinear(s.h, x, y - 0.5)) * exaggeration) / DX;
      const len = Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      const shade = Math.min(1.35, Math.max(0.4, ((dzdx + dzdy + Math.SQRT2) / (2 * len)) / (Math.SQRT2 / 2)));
      col = col.map((v) => v * shade) as RGB;
    }
    img.set(col, (j * P + i) * 3);
  }
  if (rivers) {
    const r = s.rivers;
    for (let o = 0; o < r.length; o += RIVER_STRIDE) {
      // Segment in pixels; width in pixels, never under 1 so thin streams stay visible but faint.
      const ax = (r[o]! - x0) / worldPerPx, ay = (r[o + 1]! - y0) / worldPerPx;
      const bx = (r[o + 2]! - x0) / worldPerPx, by = (r[o + 3]! - y0) / worldPerPx;
      const widthPx = r[o + 4]! / worldPerPx;
      const half = Math.max(0.5, widthPx / 2);
      const strength = Math.min(1, widthPx); // sub-pixel streams are drawn faint, as they'd blur on screen
      const minX = Math.floor(Math.min(ax, bx) - half - 1), maxX = Math.ceil(Math.max(ax, bx) + half + 1);
      const minY = Math.floor(Math.min(ay, by) - half - 1), maxY = Math.ceil(Math.max(ay, by) + half + 1);
      const dx = bx - ax, dy = by - ay, lenSq = dx * dx + dy * dy;
      for (let py = Math.max(0, minY); py <= Math.min(P - 1, maxY); py++) for (let px = Math.max(0, minX); px <= Math.min(P - 1, maxX); px++) {
        const t = lenSq > 0 ? Math.min(1, Math.max(0, ((px + 0.5 - ax) * dx + (py + 0.5 - ay) * dy) / lenSq)) : 0;
        const ex = ax + t * dx - (px + 0.5), ey = ay + t * dy - (py + 0.5);
        const coverage = Math.min(1, Math.max(0, half + 0.5 - Math.sqrt(ex * ex + ey * ey))) * strength;
        if (coverage <= 0) continue;
        const k = (py * P + px) * 3;
        for (let ch = 0; ch < 3; ch++) img[k + ch] = img[k + ch]! + (SHALLOW[ch]! - img[k + ch]!) * coverage;
      }
    }
  }
  return img;
}
function renderLayer1(s: ReturnType<typeof simulate>): Uint8ClampedArray {
  // Same colors as the relief view, from the starting heights, for comparison.
  const img = new Uint8ClampedArray(P * P * 3);
  const g = s.g;
  let max = 0; for (const e of g.elevation) max = Math.max(max, e - g.sea);
  for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) {
    const k = j * N + i, e = g.elevation[k]! - g.sea;
    let col: RGB;
    if (e < 0) { const d = Math.min(1, -e / 0.8); col = [90 - 68 * d, 156 - 99 * d, 203 - 109 * d]; }
    else {
      col = ramp(e / max);
      const ex = (g.elevation[j * N + Math.min(N - 1, i + 1)]! - g.elevation[j * N + Math.max(0, i - 1)]!) * 120 / 10;
      const ey = (g.elevation[Math.min(N - 1, j + 1) * N + i]! - g.elevation[Math.max(0, j - 1) * N + i]!) * 120 / 10;
      const len = Math.sqrt(ex * ex + ey * ey + 1);
      col = col.map((v) => v * Math.min(1.3, Math.max(0.45, ((ex + ey + Math.SQRT2) / (2 * len)) / (Math.SQRT2 / 2)))) as RGB;
    }
    img.set(col, k * 3);
  }
  return img;
}
function writePng(path: string, w: number, h: number, rgb: Uint8ClampedArray) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

const G = 8, W = 3 * P + 2 * G, H = SEEDS.length * P + (SEEDS.length - 1) * G;
const sheet = new Uint8ClampedArray(W * H * 3).fill(14);
SEEDS.forEach((seed, row) => {
  const s = simulate(seed);
  console.log(`seed ${seed}: ${STEPS} steps in ${s.ms.toFixed(0)} ms, highest peak ${s.maxH.toFixed(0)} m, river segments ${s.rivers.length / RIVER_STRIDE}`);
  // Zoom on the land cell with the most drainage that is not at the sea: a big river valley.
  let best = 0;
  for (let i = 0; i < M * M; i++) if (!s.sea[i] && s.h[i]! > 200 && s.area[i]! > s.area[best]!) best = i;
  const zx = Math.min(1400, Math.max(0, ((best % M) + 0.5) * CELL - 300)), zy = Math.min(1400, Math.max(0, (Math.floor(best / M) + 0.5) * CELL - 300));
  [renderRelief(s, false), renderRelief(s, true), renderRelief(s, true, zx, zy, 600)].forEach((panel, col) => {
    for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) { const a = (y * P + x) * 3, d = ((row * (P + G) + y) * W + col * (P + G) + x) * 3; sheet[d] = panel[a]!; sheet[d + 1] = panel[a + 1]!; sheet[d + 2] = panel[a + 2]!; }
  });
});
writePng(`${OUT}/layer2.png`, W, H, sheet);
console.log("wrote", `${OUT}/layer2.png`);
