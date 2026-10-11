// Renders seed 1 at three zoom levels with critters drawn to scale.
import { writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { generate, N, SPACING, OCEAN_COVERAGE } from "./plates.ts";

type RGB = [number, number, number];
const g = generate(1);
const e = g.elevation;
const sorted = Float64Array.from(e).sort();
const sea = sorted[Math.round(OCEAN_COVERAGE * (N * N - 1))]!;
const max = sorted[N * N - 1]!, min = sorted[0]!;

function sample(x: number, y: number): number {
  const gx = Math.min(N - 1.001, Math.max(0, x / SPACING - 0.5)), gy = Math.min(N - 1.001, Math.max(0, y / SPACING - 0.5));
  const c = Math.floor(gx), r = Math.floor(gy), u = gx - c, v = gy - r;
  const a = e[r * N + c]!, b = e[r * N + c + 1]!, cc = e[(r + 1) * N + c]!, d = e[(r + 1) * N + c + 1]!;
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + cc * (1 - u) * v + d * u * v;
}
const stops: [number, RGB][] = [[0, [91, 138, 74]], [0.3, [201, 183, 122]], [0.65, [139, 109, 79]], [1, [240, 240, 240]]];
function ramp(t: number): RGB {
  t = Math.min(1, Math.max(0, t));
  for (let k = 1; k < stops.length; k++) { const [a, ca] = stops[k - 1]!, [b, cb] = stops[k]!; if (t <= b) { const f = (t - a) / (b - a); return ca.map((x, j) => x + (cb[j]! - x) * f) as RGB; } }
  return stops[stops.length - 1]![1];
}
function render(size: number, x0: number, y0: number, span: number): Uint8ClampedArray {
  const img = new Uint8ClampedArray(size * size * 3);
  const step = span / size;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = x0 + (i + 0.5) * step, y = y0 + (j + 0.5) * step, h = sample(x, y);
    let col: RGB;
    if (h < sea) { const d = (sea - h) / (sea - min); col = [90 - 68 * d, 156 - 99 * d, 203 - 109 * d]; }
    else {
      col = ramp((h - sea) / (max - sea));
      const dzdx = ((sample(x + SPACING, y) - sample(x - SPACING, y)) * 120) / (2 * SPACING);
      const dzdy = ((sample(x, y + SPACING) - sample(x, y - SPACING)) * 120) / (2 * SPACING);
      const len = Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      const shade = Math.min(1.3, Math.max(0.45, ((dzdx + dzdy + Math.SQRT2) / (2 * len)) / (Math.SQRT2 / 2)));
      col = col.map((v) => v * shade) as RGB;
    }
    img.set(col, (j * size + i) * 3);
  }
  return img;
}
function disc(img: Uint8ClampedArray, size: number, x: number, y: number, rad: number, col: RGB, ring = false) {
  const R = Math.ceil(rad) + 1;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > rad + 0.5 || (ring && d < rad - 1.5)) continue;
    const X = Math.round(x + dx), Y = Math.round(y + dy);
    if (X < 0 || Y < 0 || X >= size || Y >= size) continue;
    img.set(col, (Y * size + X) * 3);
  }
}
function rect(img: Uint8ClampedArray, size: number, x0: number, y0: number, x1: number, y1: number, col: RGB, t = 2) {
  for (let y = Math.round(y0); y <= Math.round(y1); y++) for (let x = Math.round(x0); x <= Math.round(x1); x++) {
    const edge = x - x0 < t || x1 - x < t || y - y0 < t || y1 - y < t;
    if (edge && x >= 0 && y >= 0 && x < size && y < size) img.set(col, (y * size + x) * 3);
  }
}
function bar(img: Uint8ClampedArray, size: number, lengthPx: number) {
  for (let y = size - 22; y < size - 16; y++) for (let x = 16; x < 16 + lengthPx; x++) img.set([255, 255, 255], (y * size + x) * 3);
}

const S = 600;
// Zoom target: a coast in seed 1 (lower right of center).
const zx = 1160, zy = 1080;
// Panel A: whole world, with the 400 u zoom window marked.
const A = render(S, 0, 0, 2000);
rect(A, S, ((zx - 200) / 2000) * S, ((zy - 200) / 2000) * S, ((zx + 200) / 2000) * S, ((zy + 200) / 2000) * S, [255, 60, 60]);
bar(A, S, (500 / 2000) * S); // 500 u
// Panel B: 400 u window, with a herd of 10 u critters and the 80 u window marked.
const B = render(S, zx - 200, zy - 200, 400);
const pxPerU_B = S / 400;
const herd: [number, number][] = [];
for (let k = 0; k < 24; k++) herd.push([zx - 60 + ((k * 37) % 90), zy - 40 + ((k * 53) % 70)]);
for (const [x, y] of herd) disc(B, S, (x - (zx - 200)) * pxPerU_B, (y - (zy - 200)) * pxPerU_B, 5 * pxPerU_B, [230, 60, 200]);
rect(B, S, (zx + 60 - 40 - (zx - 200)) * pxPerU_B, (zy + 80 - 40 - (zy - 200)) * pxPerU_B, (zx + 60 + 40 - (zx - 200)) * pxPerU_B, (zy + 80 + 40 - (zy - 200)) * pxPerU_B, [255, 60, 60]);
bar(B, S, 100 * pxPerU_B); // 100 u
// Panel C: 80 u window with a small (4 u), typical (10 u), and large (30 u) critter, plus the 5 u sample grid.
const cx0 = zx + 20, cy0 = zy + 40;
const C = render(S, cx0, cy0, 80);
const pxPerU_C = S / 80;
for (let gx = Math.ceil(cx0 / SPACING) * SPACING; gx < cx0 + 80; gx += SPACING) for (let y = 0; y < S; y += 3) C.set([255, 255, 255], (y * S + Math.round((gx - cx0) * pxPerU_C)) * 3);
for (let gy = Math.ceil(cy0 / SPACING) * SPACING; gy < cy0 + 80; gy += SPACING) for (let x = 0; x < S; x += 3) C.set([255, 255, 255], (Math.round((gy - cy0) * pxPerU_C) * S + x) * 3);
disc(C, S, 120, 300, 2 * pxPerU_C, [230, 60, 200]);
disc(C, S, 260, 300, 5 * pxPerU_C, [230, 60, 200]);
disc(C, S, 450, 300, 15 * pxPerU_C, [230, 60, 200]);
bar(C, S, 10 * pxPerU_C); // 10 u

const G = 8, W = 3 * S + 2 * G;
const sheet = new Uint8ClampedArray(W * S * 3).fill(14);
[A, B, C].forEach((panel, k) => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const s = (y * S + x) * 3, d = (y * W + k * (S + G) + x) * 3; sheet[d] = panel[s]!; sheet[d + 1] = panel[s + 1]!; sheet[d + 2] = panel[s + 2]!; } });
const raw = Buffer.alloc((W * 3 + 1) * S);
for (let y = 0; y < S; y++) Buffer.from(sheet.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1);
const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 2;
writeFileSync(`${process.argv[2]}/scale.png`, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
console.log("wrote scale.png");
