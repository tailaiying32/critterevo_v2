import { chamferDistance } from "../../../packages/core/src/terrain/distance.ts";
import { generate, N, SPACING, OCEAN_COVERAGE } from "./plates.ts";

// Slope in elevation units per 100 world units, binned by distance from the coast.
const bins = [[0, 15], [15, 50], [50, 150], [150, 400], [400, 1e9]] as const;
const sum = bins.map(() => 0), count = bins.map(() => 0);
let underSum = 0, underCount = 0;
let inland = 0, floodedContinent = 0, totalWater = 0;
const inlandSizes: string[] = [];
for (const seed of [1, 2, 3, 4, 5, 6]) {
  const g = generate(seed);
  const e = g.elevation;
  const sea = g.sea;
  const isWater = (i: number) => e[i]! < sea;
  const toCoast = chamferDistance(isWater, N, N);
  // Water bodies of at least 0.2% of the world that contain no oceanic-plate water count as inland seas.
  const seen = new Uint8Array(N * N);
  for (let s = 0; s < N * N; s++) {
    if (seen[s] || !isWater(s)) continue;
    let size = 0, oceanic = false;
    const stack = [s]; seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!; size++;
      if (!g.plates[g.plate[i]!]!.continental) oceanic = true;
      const c = i % N, r = Math.floor(i / N);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= N || nr >= N) continue;
        const j = nr * N + nc;
        if (!seen[j] && isWater(j)) { seen[j] = 1; stack.push(j); }
      }
    }
    if (!oceanic && size >= 0.002 * N * N) { inland++; inlandSizes.push(`seed ${seed}: ${((100 * size) / (N * N)).toFixed(1)}%`); }
  }
  for (let i = 0; i < N * N; i++) if (isWater(i)) { totalWater++; if (g.plates[g.plate[i]!]!.continental) floodedContinent++; }
  const toLand = chamferDistance((i) => !isWater(i), N, N);
  for (let r = 1; r < N - 1; r++) for (let c = 1; c < N - 1; c++) {
    const i = r * N + c;
    const gx = (e[i + 1]! - e[i - 1]!) / (2 * SPACING), gy = (e[i + N]! - e[i - N]!) / (2 * SPACING);
    const slope = Math.sqrt(gx * gx + gy * gy) * 100;
    if (isWater(i)) {
      if (toLand[i]! * SPACING < 15) { underSum += slope; underCount++; }
      continue;
    }
    const d = toCoast[i]! * SPACING;
    bins.forEach(([lo, hi], k) => { if (d >= lo && d < hi) { sum[k] += slope; count[k]++; } });
  }
}
console.log(`inland seas (share of world): ${inlandSizes.join(", ")}`);
console.log(`continental share ${process.env.LAND_SHARE ?? 0.75}: inland seas per world ${(inland / 6).toFixed(1)}, water on continental plates ${(100 * floodedContinent / totalWater).toFixed(0)}% of all water`);
bins.forEach(([lo, hi], k) => console.log(`land ${lo}-${hi === 1e9 ? "∞" : hi} u from coast: slope ${(sum[k]! / count[k]!).toFixed(4)}`));
console.log(`water within 15 u of land:   slope ${(underSum / underCount).toFixed(4)}`);
