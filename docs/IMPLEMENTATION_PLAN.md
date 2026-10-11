# CritterEvo v2 — Implementation Plan

This plan builds the simulation from small to large. Each phase ends with a build you can run and test by hand before moving on. The design itself lives in [DESIGN.md](DESIGN.md). This document is about order of work.

## How each phase is structured

- **Decide first**: open questions from DESIGN.md §16 that must be answered before the phase starts. Nothing is built on an unmade decision.
- **Build**: the features in the phase.
- **Debug tools**: tools added so you can poke at the feature directly. These stay in the app.
- **Automated tests**: what Vitest covers.
- **Manual test checklist**: what to try in the browser to see the feature working and get a feel for its knobs.
- **Done when**: the exit criteria. You decide when a phase is done.

Three rules apply throughout

1. **Every system has an on/off toggle and its knobs in the UI.** That lets you isolate a feature's effect later. For example, turn off thermal cost and watch what changes.
2. **Determinism is checked every phase.** The state hash must match across two runs with the same seed and config.
3. **One phase per branch.** Merge only when the manual checklist passes.

## Phase overview

| Phase | Name | What you can see at the end |
|---|---|---|
| 0 ✅ | Scaffold | Empty world, play, pause, speed, tick counter |
| 1 ✅ | Viewport and knobs | Pan, zoom, a world settings panel generated from config |
| 2 ✅ | Terrain and climate | Generated landscape with biomes and climate overlays |
| 3 | Plants | Plants spreading, competing, and recovering from damage |
| 4 | Bodies and movement | Critters you can drive with the keyboard |
| 5 | Metabolism | Critters that eat, drink, burn energy, die, and leave corpses |
| 6 | Vision | Two-eye wedge vision you can see and inspect live |
| 7 | Brains | Critters driven by random NEAT brains, with a live brain view |
| 8 | Asexual evolution | The first evolving population, with stats and save/load |
| 9 | Sexual reproduction and species | Mating, crossover, emergent species |
| 10 | Combat and diet | Predation, corpses as meat, the digestion spectrum |
| 11 | Experiments and release | Headless sweeps, performance pass, public deploy |

Phases 0 through 7 build the world and the body. Evolution starts in phase 8. Expect phase 8 to take the longest, because getting a population to survive and improve is a tuning problem.

---

## Phase 0 — Scaffold ✅

**Built**

- npm workspaces monorepo: `core` (simulation, no DOM), `web` (Vite, React, PixiJS), `cli` (Node runner).
- Seeded PRNG (sfc32) with save and restore.
- `Simulation` class with a fixed timestep and a state hash.
- Web Worker running the sim with a fixed-timestep accumulator. The UI reads snapshots and never touches sim state.
- Controls: play, pause, single step, speed (1 to 600 ticks per second, or max), new world from seed.
- ESLint rules that ban `Math.random`, `Date.now`, `performance`, `window`, and `document` in `core`.
- CLI that runs N ticks headless and prints the state hash.

**Manual test checklist**

- [ ] `npm run dev` opens the app with a world rectangle and a status panel.
- [ ] Play advances the tick counter. Pause stops it. Step advances one tick while paused.
- [ ] Changing speed changes the measured tick rate.
- [ ] `npm run sim -- --seed 42 --ticks 100000` twice prints the same state hash.
- [ ] `npm run check` passes.

---

## Phase 1 — Viewport and knobs ✅

**Decided**: GitHub Pages hosting.

**Build**

- Camera: pan with drag, zoom with the scroll wheel toward the cursor, a "fit world" button.
- **Knob registry** in `core`: each config parameter is declared once with a label, group, range, default, and description. The settings panel is generated from it, so adding a knob in later phases is one line.
- Settings panel grouped by category, with reset-to-default per knob.
- Import and export of the config as JSON.
- State hash shown in the status panel.
- GitHub Actions workflow: runs `npm run check` and the build on every push and pull request, and deploys to GitHub Pages on push to main.

**Debug tools**

- Hover readout of world coordinates under the cursor.

**Automated tests**

- Knob registry: defaults match `DEFAULT_CONFIG`, values clamp to declared ranges.

**Manual test checklist**

- [ ] Pan and zoom feel smooth at any speed setting.
- [ ] Changing world width and height and pressing New world resizes the world.
- [ ] Exported config re-imports to the same world and the same state hash.
- [ ] Entering an out-of-range value clamps it, and the "Settings changed" notice appears until you generate.
- [ ] Generating a world of a different shape fits the view to it. F and the Fit world button refit.
- [ ] The state hash for a seed at a given tick matches `npm run sim -- --seed <seed> --ticks <tick>`.
- [ ] After pushing to GitHub, the Actions run passes and the site loads at the Pages URL.

**Done when**: adding a new knob to the registry makes it appear in the panel with no UI code.

---

## Phase 2 — Terrain and climate ✅

**Decided**

- Coarse grid, one value per cell, no blending between cells. Cells are 10 units by default, about one critter, so the default 3000 by 3000 world is 300 by 300 cells.
- Pixel-art map style: one flat-colored pixel per cell, values in steps, and relief shading in three levels (DESIGN.md §14.1). Chosen over smooth rendering because plain fractal noise looks both blurry and bumpy when drawn smoothly; steps keep edges crisp and hide small bumps.
- Noise from the `simplex-noise` library. Elevation, temperature noise, and moisture noise each have their own random stream.
- Gentle noise: persistence × lacunarity well below 1, so land is smooth hills rather than bumps (DESIGN.md §4.2.2). Defaults chosen from the contact sheet: 5 octaves at persistence 0.3, about 6 specks per world.
- Water, shallow water, and mountain shares set by coverage knobs.
- Temperature in °F, rainfall in inches per year. Elevation maps to height in feet, and temperature drops with height by a lapse rate.
- One sea-level temperature everywhere (70°F), so climate zones follow height. Latitude cooling is a knob, off by default.
- Terrain and biome balance: landform size 1,350 units, peak height 30,000 ft, lowland flatness 0.85 (for plains), rainfall skew 1, rain near water +40 in within 150 units, and inland drying 0.25 over 300 units (DESIGN.md §4.2.3). Rain belts by latitude are deferred.
- Biomes from Whittaker's real-world thresholds, applied to each cell's own temperature and rainfall. Tundra and taiga are set by temperature. Mountains get biomes.

**Also built**

- `Rng.derive(seed, label)` for per-system random streams.
- `simplex-noise` installed in `core`.
- Settings page with search, per-group reset, import, and export. Featured knobs in the sidebar.
- A cell-count cap that raises cell size so very large worlds can't exhaust memory.

**Build** (DESIGN.md §4), in order

1. **Elevation and terrain types.** `generateTerrain(config)` in `core`: the grid, fractal elevation, coverage thresholds, and height. Terrain and Climate knob groups in the registry. Terrain held by `Simulation` and folded into the state hash, with cell lookups (`terrainTypeAt`, and later `temperatureAt`, `rainfallAt`, `biomeAt`) for later phases. Sent to the main thread once per world as transferable typed arrays, baked to a texture, and drawn under everything. CLI prints a terrain summary.
2. **Smoothness tuning.** `npm run sheet` writes an HTML contact sheet: a few seeds × octaves (3, 4, 5) × persistence (0.5, 0.4, 0.35, 0.3), in terrain-type and elevation views, with speck counts averaged over 20 seeds. Pick defaults by eye. Add the elevation cleanup pass only if tuning the noise is not enough.
3. **Temperature.** Sea-level temperature, noise, cooling with height, and optional latitude cooling.
4. **Rainfall.** Chamfer distance to water, moisture noise converted to rainfall by rank, and extra rain near water.
5. **Biomes.** The Whittaker lookup table, and the biome view as the default view. The table of per-biome parameters (plant growth, movement cost) arrives with Phase 3 and Phase 4, when its values are decided.

The CLI terrain summary grows with each step: grid size, generation time, terrain type shares, speck count, temperature and rainfall ranges, and biome shares.

**Debug tools**

- Map views, all stepped: biome (default), terrain type, elevation (8 height bands, 3 depth bands), temperature (9°F steps from freezing, blue below and red above), rainfall (10 inch steps of one blue). Temperature and rainfall steps put every biome threshold on a step edge.
- Relief toggle, on by default: shading from elevation in three levels laid over the biome, terrain type, and elevation views, with gentle slopes left plain. Not offered for temperature and rainfall, where shading would change the colors that carry the values.
- Legend for the current view.
- Hover readout: cell coordinates, terrain type, biome, elevation, height in feet, temperature, rainfall, distance to water.
- Smoothness contact sheet (step 2).
- Optional: a Whittaker chart plotting every land cell by temperature and rainfall over the biome regions. Shows at a glance that every cell is classified correctly, and what range of climates the world produces.

**Automated tests**

- Same seed gives the same grid. Different seeds give different grids.
- Water, shallow water, and mountain shares match their coverage knobs.
- The tallest cell is exactly the peak height. Water cells are at height 0.
- With temperature noise at 0, every cell is the sea-level temperature minus exactly the lapse rate times its height. Latitude cooling, when on, lowers sea level toward the top and bottom edges.
- Rainfall spans the driest to wettest range, spread evenly at skew 0 and mostly moderate to dry at skew 1, and is higher near water when rain near water is on.
- Lowland flatness keeps the coast at 0 and the peak at the peak height, never reverses height order, and leaves the land's shape unchanged.
- Every land and mountain cell's biome equals the lookup of its own temperature and rainfall. Water cells have no biome.
- The lookup puts known climates in the right biome: 80°F and 120 in is rainforest, 55°F and 15 in is grassland, 35°F is taiga, and 15°F is tundra at any rainfall.
- Default settings produce few specks across several seeds.
- Map views use only their step colors, put every biome threshold on a step edge, and shade in a few flat levels.

**Manual test checklist**

- [ ] Several seeds produce believable landscapes: continents, lakes, ranges.
- [ ] Every view is crisp pixels in flat steps, with no blur, at any zoom. Hills read clearly with relief on, and gentle slopes show no bumpy texture.
- [ ] Temperature and rainfall band edges line up with biome borders.
- [ ] The temperature view is warmest along the coasts and cools steadily up every mountain.
- [ ] Biomes form zones up every mountain: savanna and desert along warm coasts, grassland and forest on the slopes, taiga higher, tundra on the highest summits.
- [ ] Turning on latitude cooling brings back cold top and bottom edges.
- [ ] Lapse rate 0 removes the cold mountains. Raising it spreads alpine biomes down the slopes.
- [ ] Hovering any cell shows a biome that matches the DESIGN.md §4.4 table for its temperature and rainfall.
- [ ] Dry biomes turn greener near coasts and lakeshores.
- [ ] Coverage knobs hold across seeds and noise settings: 30% water looks like roughly a third of the map every time.
- [ ] Changing cell size changes detail but not the overall shape of the world.
- [ ] Each terrain and climate knob visibly changes the world in the expected direction.
- [ ] The CLI terrain summary matches what the browser shows for the same seed.

**Done when**: you're happy with how worlds look across a range of seeds.

---

## Phase 3 — Plants

**Decided**

- §16 Q18: uPlot for the stats charts. Built for fast live time series, about 50 KB.
- §16 Q19: about 20,000 plants and 1,000 critters on the default 3000 by 3000 world. Spatial hash cells are 32 units. Budget: plants alone run at 5,000 ticks per second or more at Max.
- Biomes differ for plants by one productivity knob each, defaulting to real net primary productivity (Whittaker and Likens). Plant density and regrowth speed both scale with its square root, so plant energy produced per area follows the real ratios. Plant size is the same everywhere (DESIGN.md §4.4).
- Logistic regrowth, so plants grazed down low regrow slowly at first.
- Crowding lowers a seed's chance to take root smoothly (`1 − n / K`) rather than as a hard limit, which let density creep to about twice the knob value (DESIGN.md §5.1).
- Each plant updates every 10 ticks, a tenth of them each tick, so plants are nearly free.

**Build** (DESIGN.md §5.1)

- **Spatial hash** for all entities, with radius queries: one doubly linked list per cell, updated incrementally. This is the core infrastructure for every later phase.
- Plant entities: position, energy, age, lifespan. Full energy is one knob for all plants.
- Regrowth by biome.
- Local seeding within a dispersal radius, crowding check, long-distance dispersal, plant lifespan.
- Grazing death below the root reserve. There are no grazers yet, so it is triggered by the graze brush below.
- Plants in the snapshot as typed arrays, drawn by a Pixi `ParticleContainer` with size and brightness by energy. The map dims while plants are shown.
- First stats panel: plant count and total plant energy over time, overall and per biome. Per biome, both are per 100 by 100 units of that biome's land, so every biome reads on one scale. Stats are recorded in `core` and thinned as a run grows.
- **Live knobs**: knobs marked live apply at once to the running world. All plant knobs except starting plants and plant energy are live, so effects can be toggled mid-run.
- Plant count in the status panel and a plant summary in the CLI.

**Debug tools**

- **Graze brush**: click and drag to graze plants in a circle down to a chosen share of full energy. Below the root reserve, that kills them. This is the stand-in for herbivores, so overgrazing and recovery can be tested now.
- **Plant brush**: click or drag to sow fully grown plants in a circle, following the usual rules for taking root.
- Toggles for local seeding, long-distance dispersal, and lifespan, in the sidebar.

**Automated tests**

- Spatial hash radius queries match a brute-force search on random data, through inserts, moves, and removes.
- Plants never seed into water or where the ground is already as crowded as the biome allows.
- Determinism with plants: same seed, same hash after many ticks.
- Patches spread from a few plants and level off. Density scales with the square root of productivity, and productivity 0 grows nothing.
- Regrowth from 10% to 90% takes the regrowth time at rainforest productivity, and twice as long at a quarter of it.
- Grazing below the root reserve kills, and above it the plant survives and regrows. The graze brush acts only within its radius.
- Lifespan off means no deaths; on, every plant dies within one and a half times the mean.
- A fully stripped world recovers only with long-distance dispersal.
- Live knob changes apply at once and ignore knobs that need a new world.
- The stats recorder thins to every other row when full, keeping the whole history.

**Manual test checklist**

- [ ] Starting from a few plants, patches spread outward and fill suitable land.
- [ ] Plant density differs clearly between biomes and stabilizes over time.
- [ ] Stripping a patch with the graze brush leaves a scar that heals from its edges.
- [ ] With long-distance dispersal off, a fully stripped island never recovers. With it on, it eventually does.
- [ ] Max speed stays fast with the target number of plants.

**Done when**: the plant layer reaches a stable equilibrium on its own, and overgrazing behaves the way you want.

---

## Phase 4 — Bodies and movement

**Decide first**

- §16 Q2: terrain slowdown factors and whether slow terrain costs energy. Energy matters from phase 5.
- §16 Q14: critter-critter collision behavior.

**Build** (DESIGN.md §6, §8)

- Critter entity with body traits only: size, max speed, turn rate. Mass and radius derived from size.
- A `Controller` interface that produces the brain's outputs: turn, thrust, attack, mate. Phase 7 swaps in brains behind the same interface, so movement code never changes.
- Movement physics: heading, acceleration toward target speed, mass.
- Walls and deep water block movement. Shallow water and mountains slow it.
- Collision behavior as decided.
- Critters in the snapshot, drawn with a heading indicator.

**Debug tools**

- Click to select a critter. A basic inspector shows traits, position, heading, speed, and the terrain under it.
- **Keyboard controller**: drive the selected critter with the arrow keys or WASD.
- **Wander controller**: random steering, for crowds.
- **Spawn tool**: place a critter with chosen traits.

**Automated tests**

- Critters never end up inside walls or deep water.
- Same inputs, same trajectory.

**Manual test checklist**

- [ ] Driving a critter feels right. Large critters are sluggish, small ones nimble.
- [ ] Terrain slowdown is noticeable and matches the decided factors.
- [ ] Wandering crowds respect walls and collide as decided.

**Done when**: movement feels good to drive by hand.

---

## Phase 5 — Metabolism, eating, drinking, death

**Decide first**

- §16 Q1: hydration drain drivers, and whether food supplies water.
- §16 Q16: heat stress versus cold stress.
- §16 Q20: confirm automatic eating.
- §16 Q21: confirm corpse decay.

**Build** (DESIGN.md §6.3, §9, §10.1)

- Energy and hydration state. Max energy storage derived from size.
- Automatic eating of plants in range, with bite size per tick. Plant grazing death now happens for real.
- Drinking at shallow water.
- Cost terms: basal (Kleiber), traits upkeep, movement, terrain, thermal. Brain and eye costs exist as zero until phases 6 and 7.
- Max age derived from mass.
- Death from energy, hydration, health, or age. Corpses with mass-based energy and decay.
- Death causes recorded.

**Debug tools**

- **Energy budget** in the inspector: income and each cost term per tick, as a stacked bar.
- Wander controller population, to watch the energy flow without brains.
- Toggles for each cost term.

**Automated tests**

- Energy accounting: a critter's energy change per tick equals income minus the sum of cost terms.
- Kleiber scaling: basal cost grows with mass but falls per unit of mass.
- Larger bodies pay less thermal cost per unit of mass in the cold.

**Manual test checklist**

- [ ] Drive a critter to food and water by keyboard and keep it alive. Let it starve or dehydrate.
- [ ] Spawn a small and a large critter in tundra. The small one suffers more per unit of mass.
- [ ] Sprinting drains energy visibly faster than cruising.
- [ ] Corpses appear at deaths and fade over time.
- [ ] A wandering population grazes down plants and dies back, and plants recover.

**Done when**: the energy model feels fair, and you can keep a critter alive by hand in some biomes but not others.

---

## Phase 6 — Vision

**Decide first**

- §16 Q4: wedge content encoding.

**Build** (DESIGN.md §7.4)

- Eye traits: placement angle, field of view per eye, wedges per eye, vision range. Mirrored eyes.
- Cone query through the spatial hash, binning entities into wedges by angle, nearest per wedge.
- One terrain line per wedge down its center.
- Binocular overlap computation. Exact distances in the binocular zone.
- Seeded Gaussian noise for monocular distances via a precomputed lookup table, scaled by distance and a knob.
- Eye energy cost turned on.

**Debug tools**

- Vision overlay on the selected critter: each wedge drawn, shaded by what it sees, with binocular and monocular zones distinct.
- Inspector table of live wedge readings.
- Eye traits editable in the spawn tool.

**Automated tests**

- A target placed in a wedge is reported by exactly that wedge.
- The nearer of two targets in one wedge wins.
- Binocular wedges report exact distances. Monocular noise has the configured spread.
- Gaussian lookup samples have mean near zero and the expected standard deviation.

**Manual test checklist**

- [ ] Drive a critter around and watch wedges respond to plants, corpses, critters, water, and walls.
- [ ] Forward-facing eyes give a big binocular zone and a narrow view. Side-facing eyes give the opposite.
- [ ] Monocular distance readings jitter, and the jitter grows with distance.
- [ ] Profile: vision cost per critter fits the performance budget. If Gaussian noise is too slow, switch to coarse bins.

**Done when**: the overlay makes it obvious what each critter can see.

---

## Phase 7 — Brains

**Decide first**

- §16 Q7: initial brains fully connected or empty.
- §16 Q9: activation function.

**Build** (DESIGN.md §7)

- NEAT genome: node genes and connection genes.
- Global innovation table keyed by node pair, and split table keyed by connection innovation. Integers only.
- Stable input keys per (eye, wedge, channel) and per internal sense.
- Network evaluation once per tick, with recurrent connections using last tick's values.
- Brain controller behind the phase 4 `Controller` interface.
- Brain energy cost turned on.
- Random initial brains. No reproduction yet, so the population only declines.

**Debug tools**

- Live brain view in the inspector: nodes and connections, with activations and weights shown by color and thickness.
- Toggle any critter between brain and keyboard control.

**Automated tests**

- The same structural mutation in two genomes gets the same innovation number.
- Splitting the same connection in two genomes gives the same new node.
- Feed-forward evaluation matches hand-computed outputs.
- A recurrent self-loop carries a value across ticks.

**Manual test checklist**

- [ ] Random brains produce varied behavior: spinning, wandering, stopping.
- [ ] The brain view's activations change as the critter's surroundings change.
- [ ] Reloading the same seed and config gives the same hash after many ticks.

**Done when**: the full sense, think, act loop runs for a population within the performance budget.

---

## Phase 8 — Asexual reproduction and mutation (first evolution)

**Decide first**

- §16 Q5: asexual threshold formula.
- §16 Q6: mutation rate as a trait or a knob.
- §16 Q12: child starting energy.
- New: what happens if the population dies out. Options are to just end the run, or to allow immigration of random critters when the population falls below a floor. Immigration keeps runs alive during tuning but is an outside input.

**Build** (DESIGN.md §7.7, §12.2, §12.3)

- Automatic asexual reproduction at the derived threshold, with cooldown and energy accounting.
- All mutation operators for brains and traits, with probabilities as knobs.
- Stats recording every K ticks, in `core`, used by both the web app and the CLI.
- Stats panel: population, births, deaths by cause, trait histograms over time, mean brain size.
- Save and load of full world state, including PRNG and innovation tables.
- CLI: run from a config file and write stats as CSV.

**Debug tools**

- Color critters by generation, energy, or any trait.
- Lineage in the inspector: parent and children.
- A "good critter" bookmark to follow one lineage.

**Automated tests**

- Save, load, continue gives the same hash as an uninterrupted run.
- Energy is conserved across a birth: parent loss equals child endowment plus overhead.
- Mutation rates match the configured probabilities over many samples.

**Manual test checklist**

- [ ] The population survives the bootstrap and does not die out, with the knobs you chose.
- [ ] Over a long run at max speed, foraging visibly improves. Critters turn toward food more often than random.
- [ ] Trait histograms drift and settle. Brain size reflects the brain cost knob.
- [ ] Raising the brain cost knob produces smaller brains across runs.
- [ ] A saved world reloads and continues identically.
- [ ] The CLI reproduces a browser run's stats from the same config and seed.

**Done when**: a world sustains itself for a long run and shows clear adaptation. Expect this phase to be mostly tuning.

---

## Phase 9 — Sexual reproduction and species

**Decide first**

- §16 Q10: fitness proxy for disjoint and excess genes.
- §16 Q11: physical trait inheritance.
- §16 Q13: separate sexes.

**Build** (DESIGN.md §12.1, §12.4, §12.5)

- Mate output wired. Mating rules: range, readiness, thresholds, cooldowns, compatibility.
- Compatibility distance with trait term. Coefficients and threshold as knobs.
- NEAT crossover and trait inheritance.
- Energy split between parents.
- Periodic species clustering for labels and colors.
- Stats: species count and sizes, fraction of births that were sexual.

**Debug tools**

- Color by species.
- Species list with size, age, mean traits, and a representative brain.
- Toggle to disable asexual reproduction, to compare.

**Automated tests**

- Crossover keeps all matching genes and takes disjoint and excess genes from the chosen parent.
- Compatibility distance is zero for identical genomes and grows with differences.
- Incompatible pairs never mate.

**Manual test checklist**

- [ ] Critters evolve to approach each other and fire the mate output.
- [ ] Species split and persist. Colors show them occupying different regions or niches.
- [ ] The sexual birth fraction changes over time. Note under which knob settings sex takes over, if it does.

**Done when**: species emerge on their own across several seeds.

---

## Phase 10 — Combat and diet

**Decide first**

- §16 Q15: attack cooldown and energy cost per strike.

**Build** (DESIGN.md §10.2, §11)

- Attack output wired, with damage formula, range, cooldown, and cost.
- Kills produce corpses that anyone can eat.
- Digestion trait with plant and meat efficiency curves. The crossover height is a knob.
- Meat energy density as a knob.

**Debug tools**

- Color by digestion trait.
- Event markers for attacks and kills.
- Toggle combat off, to compare ecosystems with and without predation.

**Automated tests**

- Damage formula matches the design.
- Digestion efficiencies match the curves at the endpoints and the crossover.

**Manual test checklist**

- [ ] The digestion histogram splits into separate peaks over a long run, or you can describe why it does not.
- [ ] Predators visibly chase and strike prey.
- [ ] Changing the crossover height shifts the balance between omnivores and specialists.
- [ ] Prey populations show eye placement shifting sideways, and predators forward, or you can describe why not.

**Done when**: a world supports at least two trophic levels for a long run.

---

## Phase 11 — Experiments and release

**Build**

- CLI knob sweeps: run a grid of knob values across several seeds and write one CSV per run plus a summary.
- Performance pass: profile, move hot data to typed arrays, and consider WebGL instancing in Pixi if entity counts need it.
- Public deploy and README with screenshots.
- Revisit the deferred list in DESIGN.md §18 and choose what comes next: seasons, climate drift, parasites, and others.

**Manual test checklist**

- [ ] A sweep over one knob produces a clear trend across seeds.
- [ ] The deployed site runs well on a typical laptop.

**Done when**: someone else can open a link, run a world, and understand what they are seeing.
