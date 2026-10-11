/**
 * Scratch prototype: compare terrain-shaping approaches as rendered PNGs.
 * Not part of the repo.
 */
import { writeFileSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";
import { Rng } from "../../../packages/core/src/rng.ts";
import { createOctaveNoise, smoothstep } from "../../../packages/core/src/terrain/noise.ts";

const OUT = process.argv[2]!;
const SEED = Number(process.argv[3] ?? 1);
const WORLD = 2000, SPACING = 5, N = WORLD / SPACING; // 400 x 400 samples
const WATER = 0.25;

type Field = Float64Array;
const idx = (c: number, r: number) => r * N + c;
const cx = (c: number) => (c + 0.5) * SPACING;

function normalize(f: Field): Field {
  let lo = Infinity, hi = -Infinity;
  for (const v of f) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  return f.map((v) => (v - lo) / (hi - lo));
}
function quantile(f: Field, q: number): number {
  const s = Float64Array.from(f).sort();
  return s[Math.round(q * (s.length - 1))]!;
}
function flatten(f: Field, flatness: number): Field {
  const sea = quantile(f, WATER);
  return f.map((e) => {
    if (e < sea) return e;
    const h = (e - sea) / (1 - sea);
    return sea + (1 - sea) * (h + flatness * (h * h * h - h));
  });
}

const opts = { featureSize: 800, octaves: 6, persistence: 0.5, lacunarity: 2 };

// A: current approach (base octave + detail damped on low ground), then flattening.
function current(): Field {
  const noise = createOctaveNoise(Rng.derive(SEED, "terrain.elevation"), opts);
  const base = new Float64Array(N * N);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) base[idx(c, r)] = noise.sum(cx(c), cx(r), 0, 1);
  const sea = quantile(base, WATER);
  let max = -Infinity; for (const b of base) max = Math.max(max, b);
  const out = new Float64Array(N * N);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const i = idx(c, r);
    const h = (base[i]! - sea) / (max - sea);
    const rough = 1 - 0.75 * (1 - smoothstep(0, 0.45, h));
    out[i] = base[i]! + rough * noise.sum(cx(c), cx(r), 1, opts.octaves);
  }
  return flatten(normalize(out), 0.6);
}

// B: gradient-damped fractal noise. Each finer octave is suppressed where the
// terrain built so far is already steep, so detail collects in valleys and on
// plateaus instead of bumping up every slope. A cheap, well-known imitation of erosion.
function gradientDamped(o2 = opts, warp = 0, damp = 0.15): Field {
  const noise = createOctaveNoise(Rng.derive(SEED, "terrain.elevation"), o2);
  const warpX = createOctaveNoise(Rng.derive(SEED, "terrain.warp.x"), { featureSize: 900, octaves: 3, persistence: 0.5, lacunarity: 2 });
  const warpY = createOctaveNoise(Rng.derive(SEED, "terrain.warp.y"), { featureSize: 900, octaves: 3, persistence: 0.5, lacunarity: 2 });
  const eps = 0.5;
  const out = new Float64Array(N * N);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    let x = cx(c), y = cx(r);
    if (warp > 0) {
      const wx = warpX.sum(x, y, 0, 3), wy = warpY.sum(x, y, 0, 3);
      x += warp * wx; y += warp * wy;
    }
    let sum = 0, dx = 0, dy = 0;
    for (let o = 0; o < o2.octaves; o++) {
      const v = noise.sum(x, y, o, o + 1);
      const gx = ((noise.sum(x + eps, y, o, o + 1) - noise.sum(x - eps, y, o, o + 1)) / (2 * eps)) * o2.featureSize;
      const gy = ((noise.sum(x, y + eps, o, o + 1) - noise.sum(x, y - eps, o, o + 1)) / (2 * eps)) * o2.featureSize;
      dx += gx; dy += gy;
      sum += o === 0 ? v : v / (1 + damp * (dx * dx + dy * dy));
    }
    out[idx(c, r)] = sum;
  }
  return flatten(normalize(out), 0.6);
}

// D: fewer, gentler detail layers on the current approach.
function gentle(): Field {
  const o2 = { featureSize: 800, octaves: 4, persistence: 0.4, lacunarity: 2 };
  const noise = createOctaveNoise(Rng.derive(SEED, "terrain.elevation"), o2);
  const out = new Float64Array(N * N);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) out[idx(c, r)] = noise.sum(cx(c), cx(r), 0, o2.octaves);
  return flatten(normalize(out), 0.6);
}

// C: hydraulic erosion. Simulated raindrops run downhill, pick up sediment on
// steep ground and drop it where they slow, carving branching valleys and
// leaving ridges between them, with smooth alluvial plains below.
function eroded(input: Field, drops: number, H = 60, radius = 2, maxSteps = 48): Field { // vertical scale in sample units: the highest peak is 60 samples tall
  const h = input.map((v) => v * H);
  const rng = Rng.derive(SEED, "terrain.erosion");
  const inertia = 0.05, capacityK = 4, minSlope = 0.01, depositK = 0.3, erodeK = 0.3, evaporate = 0.02, gravity = 4;
  // Precomputed erosion brush weights.
  const brush: [number, number, number][] = [];
  let wsum = 0;
  for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) {
    const d = Math.sqrt(dc * dc + dr * dr);
    if (d <= radius) { const w = 1 - d / radius; brush.push([dc, dr, w]); wsum += w; }
  }
  for (const b of brush) b[2] /= wsum;

  const heightAndGradient = (px: number, py: number) => {
    const c = Math.floor(px), r = Math.floor(py);
    const u = px - c, v = py - r;
    const a = h[idx(c, r)]!, b = h[idx(c + 1, r)]!, cc = h[idx(c, r + 1)]!, d = h[idx(c + 1, r + 1)]!;
    return {
      height: a * (1 - u) * (1 - v) + b * u * (1 - v) + cc * (1 - u) * v + d * u * v,
      gx: (b - a) * (1 - v) + (d - cc) * v,
      gy: (cc - a) * (1 - u) + (d - b) * u,
    };
  };

  for (let k = 0; k < drops; k++) {
    let px = rng.range(1, N - 2), py = rng.range(1, N - 2);
    let dirX = 0, dirY = 0, speed = 1, water = 1, sediment = 0;
    for (let step = 0; step < maxSteps; step++) {
      const c = Math.floor(px), r = Math.floor(py);
      const u = px - c, v = py - r;
      const here = heightAndGradient(px, py);
      dirX = dirX * inertia - here.gx * (1 - inertia);
      dirY = dirY * inertia - here.gy * (1 - inertia);
      const len = Math.sqrt(dirX * dirX + dirY * dirY);
      if (len === 0) break;
      dirX /= len; dirY /= len;
      px += dirX; py += dirY;
      if (px < 1 || py < 1 || px >= N - 2 || py >= N - 2) break;
      const dh = heightAndGradient(px, py).height - here.height;
      const capacity = Math.max(-dh, minSlope) * speed * water * capacityK;
      if (sediment > capacity || dh > 0) {
        // Deposit at the previous position, split over the 4 corners.
        const amount = dh > 0 ? Math.min(dh, sediment) : (sediment - capacity) * depositK;
        sediment -= amount;
        h[idx(c, r)] += amount * (1 - u) * (1 - v);
        h[idx(c + 1, r)] += amount * u * (1 - v);
        h[idx(c, r + 1)] += amount * (1 - u) * v;
        h[idx(c + 1, r + 1)] += amount * u * v;
      } else {
        const amount = Math.min((capacity - sediment) * erodeK, -dh);
        for (const [dc, dr, w] of brush) {
          const cc = c + dc, rr = r + dr;
          if (cc < 0 || rr < 0 || cc >= N || rr >= N) continue;
          const i = idx(cc, rr);
          const take = Math.min(h[i]!, amount * w);
          h[i] -= take;
          sediment += take;
        }
      }
      speed = Math.sqrt(Math.max(0, speed * speed + dh * gravity));
      water *= 1 - evaporate;
    }
  }
  return h.map((v) => v / H);
}

// ---- Rendering: elevation colors + hillshade, like the app's elevation view ----
const STOPS: [number, number[]][] = [[0, [0x5b, 0x8a, 0x4a]], [0.35, [0xc9, 0xb7, 0x7a]], [0.7, [0x8b, 0x6d, 0x4f]], [1, [0xf0, 0xf0, 0xf0]]];
function ramp(t: number): number[] {
  t = Math.min(1, Math.max(0, t));
  for (let k = 1; k < STOPS.length; k++) {
    const [a, ca] = STOPS[k - 1]!, [b, cb] = STOPS[k]!;
    if (t <= b) { const f = (t - a) / (b - a); return ca.map((x, j) => x + (cb[j]! - x) * f); }
  }
  return STOPS.at(-1)![1];
}
function sample(f: Field, x: number, y: number): number {
  const gx = Math.min(N - 1.001, Math.max(0, x)), gy = Math.min(N - 1.001, Math.max(0, y));
  const c = Math.floor(gx), r = Math.floor(gy), u = gx - c, v = gy - r;
  const a = f[idx(c, r)]!, b = f[idx(c + 1, r)]!, cc = f[idx(c, r + 1)]!, d = f[idx(c + 1, r + 1)]!;
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + cc * (1 - u) * v + d * u * v;
}
function render(f: Field, size: number, x0: number, y0: number, span: number): Uint8Array {
  const sea = quantile(f, WATER);
  const px = new Uint8Array(size * size * 3);
  const step = span / size;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = x0 + i * step, y = y0 + j * step;
    const e = sample(f, x, y);
    let col: number[];
    if (e < sea) {
      const depth = (sea - e) / sea;
      col = [0x5a + (0x16 - 0x5a) * depth, 0x9c + (0x39 - 0x9c) * depth, 0xcb + (0x5e - 0xcb) * depth];
    } else {
      col = ramp((e - sea) / (1 - sea));
      const d = 1; // one sample
      const dzdx = ((sample(f, x + d, y) - sample(f, x - d, y)) * 150) / (2 * SPACING);
      const dzdy = ((sample(f, x, y + d) - sample(f, x, y - d)) * 150) / (2 * SPACING);
      const len = Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      const shade = Math.min(1.3, Math.max(0.45, ((dzdx + dzdy + Math.SQRT2) / (2 * len)) / (Math.SQRT2 / 2)));
      col = col.map((c) => c * shade);
    }
    const p = (j * size + i) * 3;
    px[p] = Math.min(255, col[0]!); px[p + 1] = Math.min(255, col[1]!); px[p + 2] = Math.min(255, col[2]!);
  }
  return px;
}
function writePng(path: string, w: number, h: number, rgb: Uint8Array) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
// Grid of panels: each variant shown whole (top row) and zoomed into the highlands (bottom row).
function grid(variants: Field[], name: string) {
  const P = 420, G = 8;
  const W = variants.length * P + (variants.length - 1) * G, Hh = 2 * P + G;
  const img = new Uint8Array(W * Hh * 3).fill(14);
  // Zoom target: the highest point of the first variant.
  let best = 0; for (let i = 0; i < variants[0]!.length; i++) if (variants[0]![i]! > variants[0]![best]!) best = i;
  const zc = best % N, zr = Math.floor(best / N), zspan = 120;
  const zx0 = Math.min(N - zspan - 1, Math.max(0, zc - zspan / 2)), zy0 = Math.min(N - zspan - 1, Math.max(0, zr - zspan / 2));
  variants.forEach((f, k) => {
    for (const [row, x0, y0, span] of [[0, 0, 0, N - 1], [1, zx0, zy0, zspan]] as const) {
      const panel = render(f, P, x0, y0, span);
      for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
        const s = (y * P + x) * 3, d = ((row * (P + G) + y) * W + k * (P + G) + x) * 3;
        img[d] = panel[s]!; img[d + 1] = panel[s + 1]!; img[d + 2] = panel[s + 2]!;
      }
    }
  });
  writePng(`${OUT}/${name}`, W, Hh, img);
}

const time = <T>(label: string, f: () => T): T => { const t = performance.now(); const v = f(); console.log(`${label} ${(performance.now() - t).toFixed(0)} ms`); return v; };
const A = time("current", current);
const D = time("gentle", gentle);
const G = time("gentle+erosion", () => flatten(normalize(eroded(D, 600_000, 25, 3, 64)), 0));
grid([A, D, G], `options-seed${SEED}.png`);
console.log("wrote", `${OUT}/options-seed${SEED}.png`);
