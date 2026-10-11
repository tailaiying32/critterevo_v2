/**
 * Terrain contact sheet: the same seeds generated with each combination of
 * octaves and persistence, side by side, with speck counts (docs/DESIGN.md
 * §4.2.2). Writes one self-contained HTML page for picking noise defaults by eye.
 *
 *   npm run sheet
 *   npm run sheet -- --seeds 1,2,3 --octaves 3,4,5 --persistence 0.5,0.4,0.35,0.3 --stat-seeds 20
 *   npm run sheet -- --config my-world.json --out terrain-sheets/my-world.html
 */
import {
  countSpecks,
  generateTerrain,
  LAND_HEIGHT_STEPS,
  makeConfig,
  parseConfig,
  SPECK_AREA,
  TERRAIN_TYPE_NAMES,
  viewPixels,
  WATER_DEPTH_STEPS,
  type ColorStep,
  type TerrainData,
  type TerrainView,
  type WorldConfig,
} from "@critter-evo/core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { encodePng } from "./png.js";

const { values } = parseArgs({
  options: {
    seeds: { type: "string", default: "1,2,3" },
    octaves: { type: "string", default: "3,4,5" },
    persistence: { type: "string", default: "0.5,0.4,0.35,0.3" },
    "stat-seeds": { type: "string", default: "20" },
    config: { type: "string" },
    out: { type: "string", default: "terrain-sheets/sheet.html" },
  },
});

// npm runs workspace scripts from the package folder, so resolve paths from where the user ran npm.
const cwd = process.env["INIT_CWD"] ?? process.cwd();
const list = (text: string) => text.split(",").map(Number).filter(Number.isFinite);
const seeds = list(values.seeds);
const octaveList = list(values.octaves);
const persistenceList = list(values.persistence);
const statSeeds = Number.parseInt(values["stat-seeds"], 10);
if (!seeds.length || !octaveList.length || !persistenceList.length || !(statSeeds > 0)) {
  console.error("Usage: npm run sheet -- [--seeds 1,2,3] [--octaves 3,4,5] [--persistence 0.5,0.4,0.35,0.3] [--stat-seeds 20] [--config file.json] [--out file.html]");
  process.exit(1);
}

let base: WorldConfig = makeConfig();
if (values.config) {
  const { config, warnings } = parseConfig(JSON.parse(readFileSync(resolve(cwd, values.config), "utf8")));
  for (const warning of warnings) console.warn(`warning: ${warning}`);
  base = config;
}

function image(terrain: TerrainData, view: TerrainView): string {
  const pixels = viewPixels(terrain, view, { relief: true });
  return `data:image/png;base64,${encodePng(terrain.cols, terrain.rows, new Uint8Array(pixels.buffer)).toString("base64")}`;
}

/** CSS background for a stepped scale over 0 to 1: one solid block per step. */
const cssSteps = (steps: readonly ColorStep[]) =>
  `linear-gradient(to right, ${steps.map((s) => `rgb(${s.color.map(Math.round).join(",")}) ${s.from * 100}% ${s.to * 100}%`).join(", ")})`;

const settings = persistenceList.flatMap((persistence) => octaveList.map((octaves) => ({ persistence, octaves })));
const configFor = (seed: number, s: { persistence: number; octaves: number }) => makeConfig({ ...base, seed, ...s });

// Average speck counts over many seeds, so the comparison doesn't hinge on one lucky map.
const start = performance.now();
const averages = settings.map((s) => {
  const byType = new Array<number>(TERRAIN_TYPE_NAMES.length).fill(0);
  for (let seed = 1; seed <= statSeeds; seed++) {
    countSpecks(generateTerrain(configFor(seed, s))).byType.forEach((count, type) => (byType[type]! += count));
  }
  const mean = byType.map((count) => count / statSeeds);
  return { ...s, total: mean.reduce((a, b) => a + b, 0), byType: mean };
});

console.log(`Average specks over seeds 1 to ${statSeeds} (patches under ${SPECK_AREA} square units):\n`);
console.log(`  persistence  ${octaveList.map((o) => `${o} oct`.padStart(8)).join("")}`);
for (const persistence of persistenceList) {
  const row = averages.filter((a) => a.persistence === persistence);
  console.log(`  ${persistence.toFixed(2).padEnd(11)}  ${row.map((a) => a.total.toFixed(1).padStart(8)).join("")}`);
}

const tiles = seeds.map((seed) => ({
  seed,
  tiles: settings.map((s) => {
    const terrain = generateTerrain(configFor(seed, s));
    return { ...s, specks: countSpecks(terrain).total, types: image(terrain, "terrain"), elevation: image(terrain, "elevation") };
  }),
}));

const steepness = (p: number) => `each octave ${(p * base.lacunarity).toFixed(2)}× as steep as the last`;
const shortType = ["deep", "shallow", "land", "mountain"];
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Terrain contact sheet</title>
<style>
  :root { color-scheme: dark; --bg: #0e1013; --panel: #171b20; --text: #e6e9ec; --muted: #8b949e; --border: #2a3038; }
  body { margin: 0; padding: 24px 16px 48px; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, sans-serif; }
  main { max-width: 1280px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 32px 0 8px; }
  p { color: var(--muted); margin: 4px 0; }
  .views { display: flex; gap: 16px; margin: 16px 0; }
  .views label { display: flex; gap: 6px; align-items: center; cursor: pointer; }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; }
  th, td { padding: 6px; vertical-align: top; text-align: left; }
  th { color: var(--muted); font-weight: 500; font-size: 13px; }
  .stats td, .stats th { border-bottom: 1px solid var(--border); }
  .stats td small { color: var(--muted); display: block; }
  .grid th[scope=row] { width: 140px; }
  .grid img { width: 100%; display: block; image-rendering: pixelated; border-radius: 3px; }
  .specks { color: var(--muted); font-size: 12px; margin-top: 3px; }
  body[data-view="types"] img.elevation, body[data-view="elevation"] img.types, body[data-view="types"] .legend { display: none; }
  .legend { display: flex; flex-wrap: wrap; gap: 8px 24px; font-size: 12px; color: var(--muted); }
  .legend .bar { width: 200px; height: 10px; border-radius: 3px; margin-bottom: 2px; }
  .legend .ends { display: flex; justify-content: space-between; }
  .scroll { overflow-x: auto; }
  .scroll table { min-width: 640px; }
</style>
</head>
<body data-view="elevation">
<main>
<h1>Terrain contact sheet</h1>
<p>World ${base.width} × ${base.height} u in ${base.cellSize} u cells. Landform size ${base.landformSize} u, lacunarity ${base.lacunarity}, water ${base.waterCoverage}%, mountains ${base.mountainCoverage}%, peak ${base.peakHeight.toLocaleString("en-US")} ft.</p>
<p>A speck is a patch of one terrain type smaller than ${SPECK_AREA} square units (about ${Math.round(Math.sqrt(SPECK_AREA))} × ${Math.round(Math.sqrt(SPECK_AREA))} u, three critters across).</p>
<div class="views">
  <label><input type="radio" name="view" value="elevation" checked> Elevation map</label>
  <label><input type="radio" name="view" value="types"> Terrain types</label>
</div>
<div class="legend">
  <div><div class="bar" style="background: ${cssSteps(WATER_DEPTH_STEPS)}"></div><div class="ends"><span>sea level</span><span>deepest</span></div></div>
  <div><div class="bar" style="background: ${cssSteps(LAND_HEIGHT_STEPS)}"></div><div class="ends"><span>sea level</span><span>${base.peakHeight.toLocaleString("en-US")} ft</span></div></div>
  <div>Relief shading lit from the northwest in three levels, the same in every tile.</div>
</div>

<h2>Average specks over seeds 1 to ${statSeeds}</h2>
<div class="scroll"><table class="stats">
<tr><th>Persistence</th>${octaveList.map((o) => `<th>${o} octaves</th>`).join("")}</tr>
${persistenceList
  .map(
    (p) =>
      `<tr><th scope="row">${p}<small style="display:block">${steepness(p)}</small></th>${averages
        .filter((a) => a.persistence === p)
        .map((a) => `<td>${a.total.toFixed(1)}<small>${a.byType.map((c, t) => `${shortType[t]} ${c.toFixed(1)}`).join(" · ")}</small></td>`)
        .join("")}</tr>`,
  )
  .join("\n")}
</table></div>

${tiles
  .map(
    ({ seed, tiles: seedTiles }) => `<h2>Seed ${seed}</h2>
<div class="scroll"><table class="grid">
<tr><th></th>${octaveList.map((o) => `<th>${o} octaves</th>`).join("")}</tr>
${persistenceList
  .map(
    (p) =>
      `<tr><th scope="row">Persistence ${p}<small style="display:block">${steepness(p)}</small></th>${seedTiles
        .filter((t) => t.persistence === p)
        .map(
          (t) =>
            `<td><img class="types" src="${t.types}" alt="Seed ${seed}, persistence ${p}, ${t.octaves} octaves, terrain types"><img class="elevation" src="${t.elevation}" alt="Seed ${seed}, persistence ${p}, ${t.octaves} octaves, elevation"><div class="specks">${t.specks} ${t.specks === 1 ? "speck" : "specks"}</div></td>`,
        )
        .join("")}</tr>`,
  )
  .join("\n")}
</table></div>`,
  )
  .join("\n")}
</main>
<script>
  for (const input of document.querySelectorAll('input[name="view"]')) {
    input.addEventListener("change", () => (document.body.dataset.view = input.value));
  }
</script>
</body>
</html>
`;

const out = resolve(cwd, values.out);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`\nWrote ${out} in ${((performance.now() - start) / 1000).toFixed(1)} s`);
