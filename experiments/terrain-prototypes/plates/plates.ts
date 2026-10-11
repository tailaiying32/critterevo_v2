/**
 * Scratch prototype of the plates layer. Not part of the repo.
 * Produces, per seed: a plate map, an uplift map, and a rough elevation preview.
 */
import { writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { Rng } from "../../../packages/core/src/rng.ts";
import { chamferNearest } from "../../../packages/core/src/terrain/distance.ts";
import { createOctaveNoise } from "../../../packages/core/src/terrain/noise.ts";

const OUT = process.argv[2]!;
const SEEDS = (process.argv[3] ?? "1,2,3").split(",").map(Number);

// ---------------- Parameters (proposed defaults) ----------------
const WORLD = 2000;
const SPACING = 5;
const N = WORLD / SPACING; // 400 samples per side
const PLATES = 10;
const LAND_SHARE = Number(process.env.LAND_SHARE ?? 0.75); // continental plates are added until they cover this share
const BORDER_WARP = 140; // world units of wiggle in plate borders
const BORDER_WARP_SIZE = 450; // size of the wiggles
const OCEAN_COVERAGE = Number(process.env.WATER ?? 0.25);
const INLAND_SEA_CAP = Number(process.env.CAP ?? 1); // largest inland sea, as a share of the world
const LOWLAND_RISE = 0.01; // how far raised basin lowlands rise above sea level toward the old shore

// Border effects. Each border sample emits a push into one of three fields, and each
// field is spread by a blur of the given radius (world units). Heights are the peak
// uplift for a long, straight border pushing at full speed.
const SPREAD = { wide: 220, medium: 140, narrow: 60 };
const COLLISION_HEIGHT = 1.0; // continent hits continent: both sides, wide
const COASTAL_RANGE_HEIGHT = 0.9; // ocean dives under continent: continent side, medium
const TRENCH_DEPTH = -0.5; // ...ocean side, narrow
const ISLAND_ARC_HEIGHT = 0.75; // ocean hits ocean: overriding side, narrow
const RIFT_DEPTH = -0.12; // continents pull apart: mild lowland, narrow
const RIDGE_HEIGHT = 0.15; // ocean floors pull apart: underwater ridge, narrow
const CONVERGE_THRESHOLD = 0.15;
const DIVERGE_THRESHOLD = -0.15;

const idx = (c: number, r: number) => r * N + c;
const px = (i: number) => ((i % N) + 0.5) * SPACING;
const py = (i: number) => (Math.floor(i / N) + 0.5) * SPACING;


interface Plate {
  x: number;
  y: number;
  vx: number;
  vy: number;
  continental: boolean;
  area: number;
}

export function generate(seed: number) {
  const rng = Rng.derive(seed, "terrain.plates");

  // 1. Plate centers, evened out by two rounds of Lloyd relaxation.
  const plates: Plate[] = [];
  for (let k = 0; k < PLATES; k++) {
    // Random unit vector without trig: pick a point in the unit disk and normalize it.
    let vx = 0, vy = 0, len = 0;
    do { vx = rng.range(-1, 1); vy = rng.range(-1, 1); len = Math.sqrt(vx * vx + vy * vy); } while (len < 0.1 || len > 1);
    const speed = rng.range(0.3, 1);
    plates.push({ x: rng.range(0, WORLD), y: rng.range(0, WORLD), vx: (vx / len) * speed, vy: (vy / len) * speed, continental: false, area: 0 });
  }
  const nearestPlate = (x: number, y: number) => {
    let best = 0, bestD = Infinity;
    for (let k = 0; k < plates.length; k++) {
      const dx = plates[k]!.x - x, dy = plates[k]!.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = k; }
    }
    return best;
  };
  for (let round = 0; round < 2; round++) {
    const sx = new Float64Array(PLATES), sy = new Float64Array(PLATES), count = new Float64Array(PLATES);
    for (let i = 0; i < N * N; i += 7) { const k = nearestPlate(px(i), py(i)); sx[k] += px(i); sy[k] += py(i); count[k]++; }
    plates.forEach((p, k) => { if (count[k]! > 0) { p.x = sx[k]! / count[k]!; p.y = sy[k]! / count[k]!; } });
  }

  // 2. Assign samples to plates, with wiggly borders from warping the lookup position.
  const warpX = createOctaveNoise(Rng.derive(seed, "terrain.plates.warp.x"), { featureSize: BORDER_WARP_SIZE, octaves: 3, persistence: 0.5, lacunarity: 2 });
  const warpY = createOctaveNoise(Rng.derive(seed, "terrain.plates.warp.y"), { featureSize: BORDER_WARP_SIZE, octaves: 3, persistence: 0.5, lacunarity: 2 });
  const plate = new Int32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    const x = px(i), y = py(i);
    plate[i] = nearestPlate(x + BORDER_WARP * warpX.sum(x, y, 0, 3), y + BORDER_WARP * warpY.sum(x, y, 0, 3));
    plates[plate[i]!]!.area++;
  }

  // 3. Continental plates, in random order, until they cover the target land share.
  const order = plates.map((_, k) => k);
  for (let k = order.length - 1; k > 0; k--) { const j = rng.int(k + 1); [order[k], order[j]] = [order[j]!, order[k]!]; }
  let land = 0;
  for (const k of order) { if (land >= LAND_SHARE * N * N) break; plates[k]!.continental = true; land += plates[k]!.area; }

  // 4. Classify each border sample and emit its push into a field.
  type Kind = "none" | "collision" | "coastal" | "trench" | "arc" | "arcTrench" | "rift" | "ridge" | "transform";
  const kind: Kind[] = new Array(N * N).fill("none");
  const isBorder = new Uint8Array(N * N);
  const wide = new Float64Array(N * N), medium = new Float64Array(N * N), narrow = new Float64Array(N * N);
  const rangeNoise = createOctaveNoise(Rng.derive(seed, "terrain.plates.ranges"), { featureSize: 250, octaves: 3, persistence: 0.5, lacunarity: 2 });
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const i = idx(c, r);
    const a = plate[i]!;
    let best = -1, bestC = 0;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= N || nr >= N) continue;
      const b = plate[idx(nc, nr)]!;
      if (b === a) continue;
      const A = plates[a]!, B = plates[b]!;
      let nx = B.x - A.x, ny = B.y - A.y;
      const nl = Math.sqrt(nx * nx + ny * ny) || 1;
      nx /= nl; ny /= nl;
      // Positive: the plates move toward each other across this border.
      const conv = (A.vx - B.vx) * nx + (A.vy - B.vy) * ny;
      if (best < 0 || Math.abs(conv) > Math.abs(bestC)) { best = b; bestC = conv; }
    }
    if (best < 0) continue;
    isBorder[i] = 1;
    const A = plates[a]!, B = plates[best]!;
    const st = Math.min(1.5, Math.abs(bestC));
    // Ranges vary in height along their length: peaks and passes.
    const vary = 0.5 + 0.5 * (0.5 + 0.5 * rangeNoise.sum(px(i), py(i), 0, 3) / 1.75);
    if (bestC > CONVERGE_THRESHOLD) {
      if (A.continental && B.continental) { kind[i] = "collision"; wide[i] = COLLISION_HEIGHT * st * vary; }
      else if (A.continental && !B.continental) { kind[i] = "coastal"; medium[i] = COASTAL_RANGE_HEIGHT * st * vary; }
      else if (!A.continental && B.continental) { kind[i] = "trench"; narrow[i] = TRENCH_DEPTH * st; }
      else if (a < best) { kind[i] = "arc"; narrow[i] = ISLAND_ARC_HEIGHT * st * vary; } // overriding plate
      else { kind[i] = "arcTrench"; narrow[i] = TRENCH_DEPTH * st; }
    } else if (bestC < DIVERGE_THRESHOLD) {
      if (A.continental && B.continental) { kind[i] = "rift"; narrow[i] = RIFT_DEPTH * st; }
      else if (!A.continental && !B.continental) { kind[i] = "ridge"; narrow[i] = RIDGE_HEIGHT * st; }
    } else {
      kind[i] = "transform";
    }
  }

  // 5. Uplift: spread each field by its blur and add them up. Continuous by construction.
  // Coastal ranges rise only on the land side: the medium field is faded out over the ocean plate.
  let continentality = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) continentality[i] = plates[plate[i]!]!.continental ? 1 : 0;
  for (let pass = 0; pass < 2; pass++) continentality = boxBlur(continentality, 4);
  const uplift = new Float64Array(N * N);
  for (const [field, radius, landOnly] of [[wide, SPREAD.wide, false], [medium, SPREAD.medium, true], [narrow, SPREAD.narrow, false]] as const) {
    const spread = spreadField(field, radius);
    for (let i = 0; i < N * N; i++) {
      const fade = landOnly ? Math.min(1, Math.max(0, (continentality[i]! - 0.5) * 2)) : 1;
      uplift[i] += spread[i]! * fade;
    }
  }

  // 6. Rough elevation preview: smoothed continental platform + uplift + gentle noise.
  // (Layer 2, erosion, will turn this into real terrain; this is only to show the layout.)
  let base = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) base[i] = plates[plate[i]!]!.continental ? 0.35 : -0.45;
  for (let pass = 0; pass < 4; pass++) base = boxBlur(base, 10);
  const platform = createOctaveNoise(Rng.derive(seed, "terrain.plates.platform"), { featureSize: 500, octaves: 4, persistence: 0.45, lacunarity: 2 });
  const elevation = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) elevation[i] = base[i]! + 0.8 * uplift[i]! + Number(process.env.PLATFORM_NOISE ?? 0.18) * platform.sum(px(i), py(i), 0, 4);

  // 7. Sea level by coverage, then cap inland seas: any sea with no ocean-plate water that is larger
  // than the cap keeps only its deepest part. The rest of its basin is raised into a lowland that
  // rises gently from the new shore to the old one, so nothing else changes.
  const sea = Float64Array.from(elevation).sort()[Math.round(OCEAN_COVERAGE * (N * N - 1))]!;
  const capCount = Math.round(INLAND_SEA_CAP * N * N);
  const seen = new Uint8Array(N * N);
  let capped = 0;
  for (let start = 0; start < N * N; start++) {
    if (seen[start] || elevation[start]! >= sea) continue;
    const members: number[] = [];
    let oceanic = false;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      members.push(i);
      if (!plates[plate[i]!]!.continental) oceanic = true;
      const c = i % N, r = Math.floor(i / N);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= N || nr >= N) continue;
        const j = nr * N + nc;
        if (!seen[j] && elevation[j]! < sea) { seen[j] = 1; stack.push(j); }
      }
    }
    if (oceanic || members.length <= capCount) continue;
    capped++;
    const depths = members.map((i) => elevation[i]!).sort((a, b) => a - b);
    const t = depths[capCount]!; // new shoreline contour
    const lift = sea - t;
    for (const i of members) {
      const h = elevation[i]!;
      // Below t: the whole floor rises by `lift`, so the remaining sea keeps its shape.
      // Between t and the old shore: a lowland rising from sea level to a hair above it.
      elevation[i] = h < t ? h + lift : sea + LOWLAND_RISE * ((h - t) / lift);
    }
  }
  let water = 0;
  for (let i = 0; i < N * N; i++) if (elevation[i]! < sea) water++;

  return { plates, plate, kind, isBorder, uplift, elevation, sea, capped, waterShare: water / (N * N) };
}

/** Spreads a field of border pushes outward. Three box blurs approximate a Gaussian of the given radius. */
function spreadField(f: Float64Array, radiusWorld: number): Float64Array {
  const r = Math.max(1, Math.round(radiusWorld / SPACING / 2));
  let out = f;
  for (let pass = 0; pass < 3; pass++) out = boxBlur(out, r);
  // A straight line of 1s, one sample wide, blurred the same way, peaks at this value.
  const line = new Float64Array(N * N);
  for (let row = 0; row < N; row++) line[idx(N >> 1, row)] = 1;
  let test = line;
  for (let pass = 0; pass < 3; pass++) test = boxBlur(test, r);
  const peak = test[idx(N >> 1, N >> 1)]!;
  // Borders are two samples thick (one on each side), so halve to keep heights as specified.
  return out.map((v) => v / peak / 2);
}

function boxBlur(f: Float64Array, radius: number): Float64Array {
  const tmp = new Float64Array(f.length), out = new Float64Array(f.length);
  for (let r = 0; r < N; r++) { let s = 0; for (let c = -radius; c <= radius; c++) s += f[idx(Math.min(N - 1, Math.max(0, c)), r)]!; for (let c = 0; c < N; c++) { tmp[idx(c, r)] = s / (2 * radius + 1); s += f[idx(Math.min(N - 1, c + radius + 1), r)]! - f[idx(Math.max(0, c - radius), r)]!; } }
  for (let c = 0; c < N; c++) { let s = 0; for (let r = -radius; r <= radius; r++) s += tmp[idx(c, Math.min(N - 1, Math.max(0, r)))]!; for (let r = 0; r < N; r++) { out[idx(c, r)] = s / (2 * radius + 1); s += tmp[idx(c, Math.min(N - 1, r + radius + 1))]! - tmp[idx(c, Math.max(0, r - radius))]!; } }
  return out;
}

// ---------------- Rendering ----------------
type RGB = [number, number, number];
const P = 400; // panel size in pixels: one pixel per sample
const GAP = 8;

function panelPlates(g: ReturnType<typeof generate>): Uint8ClampedArray {
  const img = new Uint8ClampedArray(P * P * 3);
  const tint = (k: number, cont: boolean): RGB => {
    const t = ((k * 37) % 10) / 10;
    return cont ? [190 + 40 * t, 165 + 30 * t, 110 + 20 * t] : [60 + 30 * t, 100 + 40 * t, 160 + 40 * t];
  };
  const kindColor: Record<string, RGB> = {
    collision: [220, 40, 40], coastal: [240, 120, 30], trench: [240, 120, 30], arc: [250, 200, 40], arcTrench: [250, 200, 40],
    rift: [40, 200, 230], ridge: [40, 200, 230], transform: [150, 150, 150],
  };
  for (let i = 0; i < N * N; i++) {
    let col = tint(g.plate[i]!, g.plates[g.plate[i]!]!.continental);
    if (g.isBorder[i] && g.kind[i] !== "none") col = kindColor[g.kind[i]!] ?? col;
    img.set(col, i * 3);
  }
  // Motion arrows from each plate center.
  g.plates.forEach((p) => {
    const sx = p.x / SPACING, sy = p.y / SPACING, ex = sx + p.vx * 60, ey = sy + p.vy * 60;
    line(img, sx, sy, ex, ey, [20, 20, 20], 2);
    const ang = Math.atan2(ey - sy, ex - sx);
    for (const da of [2.6, -2.6]) line(img, ex, ey, ex + 12 * Math.cos(ang + da), ey + 12 * Math.sin(ang + da), [20, 20, 20], 2);
    disc(img, sx, sy, 4, [20, 20, 20]);
  });
  return img;
}

function panelUplift(g: ReturnType<typeof generate>): Uint8ClampedArray {
  const img = new Uint8ClampedArray(P * P * 3);
  for (let i = 0; i < N * N; i++) {
    const u = g.uplift[i]!;
    const col: RGB = u >= 0
      ? [30 + 225 * Math.min(1, u * 1.2), 30 + 170 * Math.min(1, u * 0.9), 30 + 40 * Math.min(1, u)]
      : [30, 30 + 60 * Math.min(1, -u * 2), 30 + 200 * Math.min(1, -u * 2)];
    img.set(col, i * 3);
  }
  return img;
}

function panelElevation(g: ReturnType<typeof generate>): Uint8ClampedArray {
  const img = new Uint8ClampedArray(P * P * 3);
  const sorted = Float64Array.from(g.elevation).sort();
  const sea = g.sea;
  const max = sorted[N * N - 1]!, min = sorted[0]!;
  const stops: [number, RGB][] = [[0, [91, 138, 74]], [0.3, [201, 183, 122]], [0.65, [139, 109, 79]], [1, [240, 240, 240]]];
  const ramp = (t: number): RGB => {
    t = Math.min(1, Math.max(0, t));
    for (let k = 1; k < stops.length; k++) { const [a, ca] = stops[k - 1]!, [b, cb] = stops[k]!; if (t <= b) { const f = (t - a) / (b - a); return ca.map((x, j) => x + (cb[j]! - x) * f) as RGB; } }
    return stops[stops.length - 1]![1];
  };
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const i = idx(c, r), e = g.elevation[i]!;
    let col: RGB;
    if (e < sea) { const d = (sea - e) / (sea - min); col = [90 - 68 * d, 156 - 99 * d, 203 - 109 * d]; }
    else {
      col = ramp((e - sea) / (max - sea));
      const ex = (g.elevation[idx(Math.min(N - 1, c + 1), r)]! - g.elevation[idx(Math.max(0, c - 1), r)]!) * 120 / (2 * SPACING);
      const ey = (g.elevation[idx(c, Math.min(N - 1, r + 1))]! - g.elevation[idx(c, Math.max(0, r - 1))]!) * 120 / (2 * SPACING);
      const len = Math.sqrt(ex * ex + ey * ey + 1);
      const shade = Math.min(1.3, Math.max(0.45, ((ex + ey + Math.SQRT2) / (2 * len)) / (Math.SQRT2 / 2)));
      col = col.map((v) => v * shade) as RGB;
    }
    img.set(col, i * 3);
  }
  return img;
}

function line(img: Uint8ClampedArray, x0: number, y0: number, x1: number, y1: number, col: RGB, w: number) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2) + 1;
  for (let s = 0; s <= steps; s++) disc(img, x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps, w / 2, col);
}
function disc(img: Uint8ClampedArray, x: number, y: number, rad: number, col: RGB) {
  for (let dy = -Math.ceil(rad); dy <= Math.ceil(rad); dy++) for (let dx = -Math.ceil(rad); dx <= Math.ceil(rad); dx++) {
    if (dx * dx + dy * dy > rad * rad + 0.5) continue;
    const X = Math.round(x + dx), Y = Math.round(y + dy);
    if (X < 0 || Y < 0 || X >= P || Y >= P) continue;
    img.set(col, (Y * P + X) * 3);
  }
}

function writePng(path: string, w: number, h: number, rgb: Uint8ClampedArray) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

if (!process.env.NO_RENDER) {
// One row per seed: plates | uplift | elevation preview.
const W = 3 * P + 2 * GAP, H = SEEDS.length * P + (SEEDS.length - 1) * GAP;
const sheet = new Uint8ClampedArray(W * H * 3).fill(14);
SEEDS.forEach((seed, row) => {
  const t0 = performance.now();
  const g = generate(seed);
  console.log(`seed ${seed}: ${(performance.now() - t0).toFixed(0)} ms, continental plates ${g.plates.filter((p) => p.continental).length}/${PLATES}, inland seas capped ${g.capped}, water ${(100 * g.waterShare).toFixed(1)}%`);
  [panelPlates(g), panelUplift(g), panelElevation(g)].forEach((panel, col) => {
    for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
      const s = (y * P + x) * 3, d = ((row * (P + GAP) + y) * W + col * (P + GAP) + x) * 3;
      sheet[d] = panel[s]!; sheet[d + 1] = panel[s + 1]!; sheet[d + 2] = panel[s + 2]!;
    }
  });
});
writePng(`${OUT}/plates.png`, W, H, sheet);
console.log("wrote", `${OUT}/plates.png`);
}
export { N, SPACING, OCEAN_COVERAGE };
