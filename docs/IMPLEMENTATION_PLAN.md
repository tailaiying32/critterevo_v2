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
| 2 | Terrain and climate | Generated landscape with biomes and climate overlays |
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

## Phase 2 — Terrain and climate

**Decided**

- Noise from the `simplex-noise` library, seeded from the world's random streams.
- Continuous terrain field: samples every 5 units, blended smoothly, classified at any point. Drawn by a GPU shader, smooth at any zoom.
- Default world 2000 by 2000 units (400 by 400 samples), 15% sea plus lakes and rivers, landform size 800.
- Water, shallow water, mountain, and moisture thresholds by coverage. Temperature thresholds in absolute °F.
- Mountains get biomes from the same lookup as land.
- Edge falloff as a knob, off by default.
- Hillshading.
- Terrain shaping: gentle fractal noise, flattened lowlands, then simulated rain erosion. Ridged noise, elevation-dependent roughness, gradient damping, and domain warping were tried and dropped.
- Lakes in basins protected from erosion. Rivers from drainage flow, as smooth capsules that widen downstream, ending in lakes, the sea, or off the map edge. Streams are shallow; wide rivers are deep and impassable.
- A dedicated Settings page for every knob. The world page sidebar keeps only featured knobs.

**Build** (DESIGN.md §4)

1. Per-system random streams: `Rng.derive(seed, label)`.
2. Terrain and Climate knob groups in the registry. A cell-count cap keeps very large worlds from exhausting memory by raising cell size.
3. `generateTerrain(config)` in `core`: fractal elevation, edge falloff, coverage thresholds, chamfer distance to water, moisture, temperature, biomes.
4. Terrain held by `Simulation`, folded into the state hash, with continuous point lookups (`terrainTypeAt`, `biomeAt`, `temperatureAt`, and others) for later phases.
5. Terrain sent to the main thread once per world as transferable typed arrays.
6. Renderer: a GPU shader that blends and classifies the field per pixel, with hillshading.
8. Settings page with search, per-group reset, import, export. Featured knobs in the sidebar.
9. Hydraulic erosion, priority-flood drainage, lakes, signed water depth, flow accumulation, river tracing and smoothing, river point queries, river rendering, and a "generating" indicator.
7. CLI prints a terrain summary: grid size, generation time, terrain type shares, biome shares, temperature range.

**Debug tools**

- View selector: biome (default), elevation, temperature, moisture, terrain type.
- Relief shading toggle.
- Legend for the current view.
- Hover readout: cell coordinates, terrain type, biome, elevation, temperature, moisture, distance to water.

**Automated tests**

- Same seed gives identical grids. Different seeds give different grids.
- Water, shallow water, and mountain shares match their coverage knobs.
- Temperature rises toward the middle row and falls with elevation.
- Moisture is higher near water when the boost is on.
- Every non-water cell has a biome. Water cells have none.
- Full edge falloff turns every border cell into water.
- Random streams with different labels are independent.

**Manual test checklist**

- [ ] Several seeds produce believable landscapes: continents, lakes, ranges.
- [ ] The temperature view shows a clear latitude gradient, and mountains read as cold.
- [ ] Biomes form sensible bands: tundra near the edges, rainforest and desert near the middle.
- [ ] Mountains show alpine biomes such as tundra or taiga where cold.
- [ ] Each terrain and climate knob visibly changes the world in the expected direction.
- [ ] Coverage knobs hold across seeds: 35% water looks like roughly a third of the map every time.
- [ ] Edge falloff at 1 produces an island surrounded by ocean.
- [ ] Changing terrain resolution changes detail but not the overall shape of the world.
- [ ] Zooming all the way in shows smooth coastlines and biome borders, no squares.
- [ ] Hills and mountains look eroded, with gullies running down them, not covered in bumps. Rain erosion at 0 shows the un-eroded terrain for comparison.
- [ ] Rivers start in highlands, merge, widen downstream, and end in lakes, the sea, or at the map edge.
- [ ] Hovering over a river reports its width, and wide rivers read as deep water.
- [ ] Lakes sit in basins at different heights, including some in the highlands.
- [ ] River source area, river width, and lake depth threshold visibly change the water network.
- [ ] Dry biomes show greener strips along rivers.
- [ ] The hover readout agrees with what is drawn under the cursor, including right at coastlines.
- [ ] The Settings page lists every knob, search filters them, and Generate returns to the world.
- [ ] Hillshading makes mountain ranges easy to read, and can be turned off.
- [ ] The CLI terrain summary matches what the browser shows for the same seed.

**Done when**: you're happy with how worlds look across a range of seeds.

---

## Phase 3 — Plants

**Decide first**

- §16 Q18: charting library for the stats panel. This is the first phase with a time-series chart.
- §16 Q19: target world size and population. This sets spatial hash cell size and the performance budget.

**Build** (DESIGN.md §5.1)

- **Spatial hash** for all entities, with radius queries. This is the core infrastructure for every later phase.
- Plant entities: position, energy, max energy, age.
- Regrowth by biome.
- Local seeding within a dispersal radius, crowding check, long-distance dispersal, plant lifespan.
- Grazing death below the root reserve. There are no grazers yet, so it is triggered by the graze brush below.
- Plants in the snapshot as typed arrays, drawn by Pixi with size or brightness by energy.
- First stats panel: plant count and total plant energy over time, overall and per biome.

**Debug tools**

- **Graze brush**: click and drag to strip plant energy in a circle. This is the stand-in for herbivores, so overgrazing and recovery can be tested now.
- **Plant brush**: click to place plants.
- Toggles for local seeding, long-distance dispersal, and lifespan.

**Automated tests**

- Spatial hash radius queries match a brute-force search on random data.
- Plants never seed into impassable terrain or past the crowding limit.
- Determinism with plants: same seed, same hash after many ticks.

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
