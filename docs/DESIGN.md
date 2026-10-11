# CritterEvo v2 — Design Document

Status: draft for review. Sections marked **Decided** reflect choices already made. Items marked **Proposed** were suggested in discussion but not yet confirmed. Everything unresolved is collected in [Open questions](#16-open-questions) at the end.

---

## 1. Goals

CritterEvo v2 is an artificial life simulator where critters with evolved neural-network brains live, eat, fight, mate, and die in a continuous 2D world with climate-driven biomes. Nothing about behavior is hardcoded beyond physics and metabolism. Diet, hunting, mating strategy, body plan, and sensory investment all emerge from natural selection under one rule: **everything costs energy.**

Design principles:

1. **Mirror biology where practical.** When a design question comes up, look first at how real organisms solve it.
2. **No engineered incentives.** No artificial bonuses to push the sim toward an outcome we want to see (for example, sex beating cloning). Build the real mechanisms and observe.
3. **Every cost is a knob.** All metabolic costs and tuning constants are world parameters exposed in the UI and CLI.
4. **Deterministic and headless-capable.** A seed plus a config reproduces a run exactly. The simulation core never touches the DOM.
5. **Accessible.** Runs in a browser with no install, deployable as a static site.

---

## 2. Decision log

| Area | Decision | Status |
|---|---|---|
| Language | TypeScript | Decided |
| Platform | Browser-first | Decided |
| UI framework | React | Decided |
| Renderer | PixiJS | Decided |
| Timestep | Fixed timestep, decoupled from render rate | Decided |
| Space | Continuous 2D | Decided |
| World edges | Walls on all four sides | Decided |
| Terrain | Coarse grid under continuous space: elevation, temperature, moisture. One value per cell, no blending between cells | Decided |
| Noise | `simplex-noise` library, each field seeded from its own random stream | Decided |
| Terrain shaping | Gentle fractal noise: each octave less steep than the one before (persistence × lacunarity well below 1), so land is smooth rather than bumpy | Decided |
| Terrain thresholds | By coverage: water, shallow water, and mountain shares are knobs | Decided |
| Climate units | Mean annual temperature in °F; moisture as annual rainfall in inches | Decided |
| Elevation cooling | Elevation maps to height in feet; temperature drops by a lapse rate (default Earth's 3.6°F per 1,000 ft) | Decided |
| Temperature | One sea-level temperature everywhere (70°F), so climate zones follow height, like the zones up a mountain. Latitude cooling is a knob, off by default | Decided |
| Biome balance | Tall peaks, lowlands flattened in height, rainfall skewed so most land is moderate to dry, wetter shores and drier interiors | Decided |
| Biomes | Temperature × rainfall lookup with Whittaker's real-world thresholds, on each cell's own climate. Tundra and taiga are set by temperature | Decided |
| Mountain biomes | Mountains get biomes from the same lookup as land | Decided |
| Terrain rendering | Pixel-art style: baked to a texture once per world, one flat-colored pixel per cell, values in steps, and relief shading in three levels | Decided |
| Food | Regrowing plant entities, growth set by biome | Decided |
| Plant growth | Logistic regrowth toward full energy. Each biome has one productivity, defaulting to its real net primary productivity; plant density and regrowth speed both scale with its square root | Decided |
| Spatial index | Uniform hash, 32 unit cells, a linked list per cell | Decided |
| Population target | About 1,000 critters on the default 5000 by 5000 world, where plants settle at about 56,000 | Decided |
| Charts | uPlot | Decided |
| Corpses | Dead critters become meat | Decided |
| Brain | NEAT with crossover, real innovation tracking | Decided |
| Brain control | Direct: brain drives steering and actions | Decided |
| Initial brains | Not seeded with hand-chosen connections | Decided |
| Vision | Two eyes, each a cone sliced into wedges; binocular depth perception; eye traits evolvable, with energy cost | Decided |
| Interaction range | Close enough counts (radius-based), not exact contact | Decided |
| Reproduction | Sexual via a mate output; asexual automatic at an energy threshold | Decided |
| Incentive for sex | None engineered | Decided |
| Mating compatibility | Gated by genome compatibility distance; species emerge | Decided |
| Combat | Attack is a brain output; critters can eat what they kill | Decided |
| Diet | Digestion spectrum trait from herbivore to carnivore | Decided |
| Energy model | All traits and brain size cost energy; costs are knobs | Decided |
| Hydration | Separate resource from energy; drinking from water. Water use follows energy spent; plants hold no water by default (a knob) | Decided |
| Energy units | Every rate is per second, times the tick length, so tick length never changes the biology. Cost knobs are shares of a size 1 critter's basal rate | Decided |
| Thermal stress | Same surface-area shape for heat and cold, with separate strength knobs; only the degrees beyond the comfort band are charged | Decided |
| Shallow water, mountains | Passable but slow; slowdown depends on local conditions | Decided |
| Field of view | Evolvable trait | Decided |
| Asexual threshold | Derived from physical traits, not a gene | Decided |
| Max age | Derived from body mass (lifespan ∝ mass^0.25), not a gene | Decided |
| Plant reproduction | Plants seed nearby, crowding lowers a seed's chance to take root, a few seeds land anywhere, plants age and die, and grazing below a root reserve kills | Decided |
| Recurrent connections | Allowed | Proposed |
| Terrain slowdown | Set by water depth, slope, and critter size; also costs energy. Slope follows Tobler's hiking function on a 240 ft per unit map scale | Decided |
| Biome movement cost | None: every biome is walked at full speed; only slope and water depth slow critters | Decided |
| Body scaling | Radius in proportion to size, mass to size³, acceleration to mass^(−1/3) | Decided |
| Critter collision | Soft repulsion: overlapping critters are pushed apart, heavier ones less | Decided |
| Temperature effect | Emergent from body size and surface area only | Decided |
| Repo layout | npm workspaces monorepo: `core`, `web`, `cli` packages | Decided (scaffolded) |
| Tooling | Vite, Vitest, ESLint, TypeScript 6.0 | Decided (scaffolded) |
| Hosting | GitHub Pages, deployed by GitHub Actions | Decided |
| Eating | Automatic when in range, not a brain output: the fullest plant in reach, at a bite rate growing with mass^0.75 | Decided |
| Sexes | No separate sexes; any two compatible critters can mate | Proposed |
| Corpse decay | Corpses lose half their energy every half-life and are gone at 5% | Decided |
| Deferred | Seasons, climate drift, parasites, insulation trait, day/night | Decided |

---

## 3. Architecture

### 3.1 Package layout (Proposed)

```
critter-evo/
  packages/
    core/   Pure TypeScript simulation. No DOM, no Pixi, no React.
    web/    Vite + React + PixiJS app. Runs core in a Web Worker.
    cli/    Node runner for headless experiments and data export.
```

`core` is the only package that knows the rules. `web` and `cli` are thin shells over it. This is the fix for v1, where the simulation loop lived on the Swing event thread and the UI froze whenever the sim got heavy.

### 3.2 Threading model (web)

```
 Main thread (React + Pixi)            Web Worker (core)
 ──────────────────────────            ─────────────────
 UI controls ── commands ────────────▶ Simulation
                                          │ step() × N per frame
 Pixi renderer ◀── snapshot ───────────── │
 Charts       ◀── stats ──────────────────┘
```

- The worker owns the simulation and runs N ticks per animation frame, where N is set by the speed control. N can be fractional for slow motion.
- After stepping, the worker posts a **snapshot**: positions, headings, radii, and color keys packed into typed arrays and sent as transferable buffers, so there is no copying.
- The main thread never mutates simulation state. It sends commands: pause, resume, set speed, change a knob, select an entity, save, load.
- Inspector requests (full genome and brain of one critter) are sent on demand, not every frame.

### 3.3 Determinism

- All randomness in `core` comes from seeded PRNGs. No `Math.random` anywhere in `core`, enforced by a lint rule.
- Each system draws from its own stream, derived from the world seed and a label such as `terrain` (`Rng.derive`). Adding a system never changes what an existing system does for a given seed.
- Fixed tick size. All entity iteration in stable ID order.
- Known caveat: JavaScript does not guarantee identical results for `Math.sin`, `Math.exp`, and similar across engines. Same machine and browser replays will match exactly. Cross-engine replays may drift. Acceptable for now.

### 3.4 Spatial indexing

A uniform spatial hash indexes critters, plants, and corpses, one hash per kind. Cells are 32 units across, so a radius query for crowding, eating, or vision covers a handful of cells. Each cell keeps a doubly linked list of entity ids, so inserting, removing, and moving are O(1) and the hash is updated incrementally rather than rebuilt. Iteration order depends only on the history of inserts and removes, so it is deterministic. It supports:

- radius queries (interaction range, mating range, attack range)
- cone queries for eyes: gather entities within vision range from nearby hash cells, then bin them into wedges by angle

Without this, every query is O(n²). It is the first piece of infrastructure to build.

### 3.5 Persistence

World state (config, seed, tick, all entities, innovation table, PRNG state) serializes to JSON. Supports save, load, and sharing a world file.

---

## 4. World

### 4.1 Space

- Continuous 2D plane, width × height in world units.
- Walls on all four edges. Entities that hit a wall stop at it.
- Fixed tick duration `dt`.

### 4.2 Terrain grid

A coarse grid sits underneath the continuous space. Cells are 10 world units across by default (a knob), about one critter, as v1's cells were, so the default 5000 by 5000 world is 500 by 500 cells. Each cell holds one value per field, with no blending between cells. Entities sample the cell under them, or ahead of them, by converting continuous position to cell coordinates.

Each cell stores:

| Field | Units | Source |
|---|---|---|
| Elevation | 0 to 1 | Fractal simplex noise (§4.2.1) |
| Temperature | °F, mean annual | Sea-level temperature plus noise, minus a lapse rate times height above sea level |
| Rainfall | inches per year | Noise, raised near water. This is the moisture field |
| Distance to water | world units | Distance from the cell to the nearest water cell |
| Terrain type | enum | Elevation against coverage thresholds: deep water, shallow water, land, mountain |
| Biome | enum | Whittaker lookup on this cell's own temperature and rainfall. Every land and mountain cell has one; water has none |

Height above sea level, in feet, is derived from elevation (§4.2.1 step 4).

Terrain is generated once per world by a pure function of the config and seed, and folded into the state hash.

### 4.2.1 Generation

1. **Random streams.** Elevation, temperature noise, and moisture noise each get their own noise function, seeded from their own stream (`terrain`, `temperature`, `moisture`). Changing a climate knob never changes the land.
2. **Elevation.** At each cell center, in world coordinates, sum octaves of simplex noise. The first octave's wavelength is the *landform size*, the approximate size of the largest features in world units. Each later octave is *lacunarity* times finer and *persistence* times weaker. Normalize the sum to 0 to 1 with `(sum / totalAmplitude + 1) / 2`. Because the noise is in world coordinates, cell size changes only how fine the detail is, not the shape of the world.
3. **Terrain types by coverage.** Sea level is the elevation that has the *water coverage* share of cells below it. The *shallow share* of water cells closest to sea level is shallow water; the rest is deep. The highest *mountain coverage* of cells is mountain. Coverage holds whatever the noise settings, so tuning smoothness never changes how much water or mountain there is.
4. **Height.** With `u = (elevation − sea level) / (highest elevation − sea level)`, height above sea level in feet is `(u + flatness × (u³ − u)) × peak height`. The coast stays at 0 and the tallest point at exactly *peak height*, while *lowland flatness* pulls the land between toward sea level, as on Earth, where most land is low. It changes height, and so temperature, but not the shape of the land. Water is at height 0.
5. **Distance to water.** A two-pass chamfer distance transform gives each cell its distance to the nearest water cell.
6. **Temperature.** `T = seaLevelTemperature + noise × temperatureVariation − lapseRate × height / 1000`. Sea level is the same temperature everywhere, so height alone sets the climate and biomes form zones up every mountain. *Latitude cooling* (off by default) can bring back cold edges: it subtracts `latitudeCooling × lat²`, with `lat` at 0 on the middle row and 1 at the top and bottom edges. A polynomial, not a cosine, keeps it identical across engines.
7. **Rainfall.** Wetness is moisture noise minus *inland drying*, which grows with distance from water up to the *inland drying range*, so interiors are drier than shores, as on real continents. Wetness is converted to rainfall by rank, so the spread from the *driest rainfall* to the *wettest rainfall* knob holds whatever the noise settings, the same idea as coverage. With `r` the rank as a fraction, rainfall is `driest + (wettest − driest) × (r + skew × (r² − r))`: at *rainfall skew* 0 it is spread evenly, and at 1 most land is moderate to dry and very wet places are rare, as on Earth. Then *rain near water* is added, fading linearly to zero at the *shore rain range* from water.
8. **Biomes.** Each land and mountain cell gets the biome from §4.4 for its own final temperature and rainfall. Nothing else feeds in, and nothing is smoothed afterward, so a cell's biome always matches its climate.

### 4.2.2 Smooth landscapes

Fractal noise looks pimply when its fine octaves are as steep as its coarse ones. An octave's slope scales with its amplitude times its frequency, so each octave is persistence × lacunarity as steep as the one before. v1 used 0.5 × 2 = 1: the finest octave was as steep as the continents, so every hillside was covered in bumps. v2 keeps persistence × lacunarity well below 1. The default 0.3 × 2 = 0.6 makes each octave 0.6 times as steep as the one before, so the fifth octave has about an eighth of the first octave's slope. It still roughens coastlines but no longer dots the land.

Smoothness matters more in v2 than in v1 because bumps chain through the climate: a bump in elevation is a cold spot in temperature, and a cold spot is a dot of taiga on the biome map. Temperature and moisture noise therefore use the same gentle octave settings as elevation.

The map is drawn in a pixel-art style (§14.1), which also hides small bumps: a bump shows only if it crosses a color step or tilts the ground enough to be shaded. Smoothness is still measured, not only judged by eye. A *speck* is a connected patch of one terrain type smaller than 900 square units, about 30 by 30 units or three critters across, and the number of specks should stay near zero. Even perfectly smooth noise leaves a few, where a hilltop barely rises above a threshold or a hollow barely dips below one. `npm run sheet` renders a contact sheet of seeds by noise settings, with speck counts averaged over many seeds. If tuning the noise is not enough, a cleanup pass nudges the elevation of tiny islands, lakes, and peaks to match their surroundings, so terrain type still follows elevation and climate still follows height. Biomes are never cleaned up directly, because then a biome would no longer match its climate.

Tried earlier on the `terrain-experiments` branch and dropped: ridged noise, elevation-dependent roughness, gradient damping, and domain warping.

### 4.2.3 Knobs

Starting values, tuned in Phase 2. The noise defaults were chosen from the contact sheet: below persistence 0.3 the land starts to look like plain noise, with evenly spaced domes and winding lakes.

| Knob | Group | Default |
|---|---|---|
| Cell size | World | 10 units |
| Landform size | Terrain | 2,250 units |
| Octaves | Terrain | 5 |
| Persistence | Terrain | 0.3 |
| Lacunarity | Terrain | 2 |
| Water coverage | Terrain | 30% |
| Shallow share of water | Terrain | 25% |
| Mountain coverage | Terrain | 10% |
| Peak height | Climate | 30,000 ft |
| Lowland flatness | Climate | 0.85 |
| Lapse rate | Climate | 3.6°F per 1,000 ft |
| Sea-level temperature | Climate | 70°F |
| Latitude cooling | Climate | 0°F (off) |
| Temperature variation | Climate | ±5°F |
| Driest rainfall, wettest rainfall | Climate | 5, 120 in per year |
| Rainfall skew | Climate | 1 |
| Rain near water | Climate | +40 in per year |
| Shore rain range | Climate | 150 units |
| Inland drying | Climate | 0.25 |
| Inland drying range | Climate | 300 units |

With these defaults the tallest peak is 108°F colder than sea level, about −38°F, so climate zones ring every mountain: a thin fringe of savanna and rainforest along the warmest shores, broad grassland and forest plains, taiga up the slopes, and tundra on the summits. Sea level sits just above the 68°F tropical line, so only land within about 550 ft of sea level is tropical.

Distances that shape the land (landform size, shore rain range, inland drying range) are set in proportion to the world: for the default 5000 unit world, 2,250, 250, and 500 units. Scaling them together with world size keeps the same map at a different size. The climate defaults were tuned for a balanced mix of biomes. Averaged over 8 seeds, land is about 10% tundra, 13% taiga, 37% grassland, 17% temperate forest, 8% temperate rainforest, 1% desert, 9% savanna, and 5% rainforest. These settings matter most:

- **Peak height, lowland flatness, and landform size** decide how much land sits in each climate zone, since height alone sets temperature, and how much of it is plains. With Earth's lapse rate, cold zones need tall peaks: with 12,000 ft peaks there is no tundra at all. Lowland flatness 0.85 and large landforms leave about a fifth of the land as broad, flat plains with separate mountains rising out of them; plain noise alone gives almost none.
- **Sea-level temperature** sets how much of the world is tropical. Below 68°F there are no tropical biomes at all; at 70°F they are a thin fringe along the shores.
- **Rainfall skew** makes very wet places rare. With rainfall spread evenly, as much land gets 100 to 120 inches as gets 5 to 25, and temperate rainforest covers a fifth of the land.
- **Wetter shores, drier interiors.** Every body of water sits at sea level, the hottest ground, so the land around water is always tropical. Without rain near water and inland drying, that hot ring is mostly desert and savanna. With them, shores are savanna and rainforest, and the few deserts sit inland. Deserts are rare because hot land far from water barely exists when climate follows height.

### 4.3 Terrain types

| Type | Passable | Notes |
|---|---|---|
| Deep water | No | Water below the shallow band. Acts as a wall |
| Shallow water | Yes, slow | The share of water closest to sea level, at the edges of seas and lakes. Drinkable. Slower the deeper it is (section 4.3.1) |
| Land | Yes | Plant growth set by biome. Slowed by slope (section 4.3.1) |
| Mountain | Yes, slow | The highest share of the world. Has a biome like land, and is cold because of its height. Slow because it is steep: slope slows it exactly as it slows land (section 4.3.1) |

Terrain type affects movement and drinking. Climate and biome come only from temperature and rainfall.

### 4.3.1 Terrain slowdown (Decided)

Terrain lowers the speed a critter can reach: its target speed is multiplied by a wading factor and a slope factor, both read from the cell under its center. Neither factor is ever above 1. Biomes have no movement cost of their own; only slope and water depth slow critters.

- **Shallow water**: the factor is `(1 − d)^(k / size)`, where `d` is the cell's depth as a share of the shallow band, 0 at the shore and 1 at the deep-water boundary, and `k` is the wading drag knob (default 1). Near the shore it is close to full speed, and it falls to nothing at deep water for every critter. Bigger critters wade deeper water more easily: at half depth, a size 1 critter moves at half speed, a size 2 critter at 71%, and a size ½ critter at 25%.
- **Slope**: the factor follows Tobler's hiking function, `exp(−3.5 × (|s + 0.05| − 0.05))`, capped at 1, where `s` is the grade along the critter's heading (rise over run, positive uphill). Uphill is slower than the same grade downhill, steep downhill is slow too, and moving across a slope is neutral. At a 20% grade a size 1 critter moves at 50% speed uphill and 70% downhill. The 3.5 is the slope sensitivity knob.
- **Body size**: a critter feels slopes as steeper in proportion to its size, so `s` is multiplied by size. Small animals climb with little extra effort compared with what level running already costs them, while large ones pay much more (Taylor, Caldwell & Rowntree, 1972).
- **Energy**: slow terrain also raises the energy cost per unit of distance, so crossing it is a tradeoff, not just a delay. Phase 4 computes the terrain factor; Phase 5 charges for it.
- **Map scale**: a knob for how many feet of horizontal distance one world unit stands for, default 240 ft. The default 5000 unit world is then about 230 miles across, half of all land has a grade under about 5%, half of the mountains are steeper than about 18%, and the steepest are about 50%. Only slopes use the scale; critters are not drawn to it. Like the other distances that shape the land, it goes with world size: scaling the landforms up by some factor and the map scale down by the same factor keeps the same slopes.

**Slope comes from the stored values, never the map colors.** The stepped colors and relief shading are drawing only; movement reads each cell's exact height in feet. Because a cell holds one height, charging for the jump at each cell edge would make climbing jerky. Instead, each cell gets a slope vector from its neighbors (the same central differences as relief shading, kept as exact numbers in feet per world unit), and a critter's grade is that vector's component along its heading, divided by the map scale. The map leaves gentle slopes unshaded, but critters still feel them; the hover readout shows each cell's exact grade.

### 4.4 Biomes

Biome is a lookup on a cell's own temperature and rainfall, following the Whittaker diagram and its real-world thresholds. Every land and mountain cell gets one; water has none.

Tundra and taiga are set by temperature alone, as in reality, where the tree line is a temperature limit. Cold peaks therefore become taiga and then tundra on their own, like real alpine zones.

| Mean annual temperature | Dry | Moderate | Wet |
|---|---|---|---|
| **Tropical** (68°F and above) | Desert (under 20 in) | Savanna (20 to 100 in) | Rainforest (over 100 in) |
| **Temperate** (41 to 68°F) | Grassland (under 40 in) | Temperate forest (40 to 80 in) | Temperate rainforest (over 80 in) |
| **Boreal** (23 to 41°F) | Taiga | Taiga | Taiga |
| **Polar** (below 23°F) | Tundra | Tundra | Tundra |

The thresholds approximate Whittaker's diagram (20°C, 5°C, and −5°C; 50, 100, 200, and 250 cm of rain) and live in one table in `core`.

Each biome defines:

- **plant productivity**, which sets plant density and regrowth speed (§5.1)
- movement cost multiplier (Phase 4)

Productivity is net primary productivity: plant growth per area per year, in g/m²/yr. Each biome's default is the measured mean for the matching ecosystem (Whittaker and Likens, 1975), and each is a knob:

| Biome | Ecosystem | Productivity (g/m²/yr) | Density and regrowth (×) |
|---|---|---|---|
| Rainforest | Tropical rainforest | 2,200 | 1.00 |
| Temperate rainforest | Temperate evergreen forest | 1,300 | 0.77 |
| Temperate forest | Temperate deciduous forest | 1,200 | 0.74 |
| Savanna | Savanna | 900 | 0.64 |
| Taiga | Boreal forest | 800 | 0.60 |
| Grassland | Temperate grassland | 600 | 0.52 |
| Tundra | Tundra and alpine | 140 | 0.25 |
| Desert | Desert and semidesert scrub | 90 | 0.20 |

Plant density and regrowth speed both scale with the square root of productivity relative to rainforest's 2,200, so their product, the plant energy produced per area, follows the real ratios. Desert grows a fifth as many plants as rainforest, each regrowing a fifth as fast. Plant size (full energy) is the same everywhere.

---

## 5. Food

### 5.1 Plants

- Plants are fixed entities with a position, a current energy, an age, and a lifespan. Full energy (*plant energy*) is the same for every plant. Plants grow only on land and mountains, never in water.
- **Regrowth (Decided)**: energy grows logistically toward full, `dE/dt = r × E × (1 − E / full)`, as in classic grazing models (Noy-Meir, 1975). A plant grazed down low regrows slowly at first, which is what makes overgrazing collapse and recovery slow. The *regrowth time* knob is the time for a rainforest plant to go from 10% to 90% of full; `r = ln 81 / regrowth time`, scaled by the biome (§4.4).
- **Local seeding (Decided)**: a plant above the *seeding maturity* share of full energy drops a seed on average once per *seed interval*, landing uniformly within the *seed radius*. Heavily grazed plants stop seeding.
- **Crowding (Decided)**: a seed's chance to take root is `1 − n / K`, where `n` is the number of plants within the *crowding radius* and `K` is the *plant density* knob converted to a count in that circle and scaled by the biome (§4.4). This is density-dependent recruitment, standing in for competition over light and soil. A hard limit ("fail if n ≥ K") was tried first: plants packed around each other until density reached about twice K and kept creeping up. With the chance falling smoothly, density settles a third to a half above K, since seeds take root more easily in gaps, and stays there. New seedlings start at the *seedling energy* share of full.
- **Grazing death (Decided)**: a plant grazed below the *root reserve* share of full energy dies. Overgrazing therefore removes seed sources, and a stripped patch can only recover from its edges.
- **Long-distance dispersal (Decided)**: seeds land at random anywhere at the *long-distance seed rate* per 1,000 by 1,000 units, standing in for wind and birds, and take root by the same rules. Without it, a fully stripped region can never recover.
- **Plant lifespan (Decided)**: each plant draws a lifespan from half to one and a half times the *mean lifespan* when it sprouts, and dies when its age reaches it. Turning lifespan off pauses aging rather than letting overdue plants all die when it is turned back on.
- **Update rate (Decided)**: plants change slowly, so each plant grows, ages, and seeds once every 10 ticks, by 10 ticks' worth, a tenth of the plants each tick. Grazing acts at once. This keeps 20,000 plants nearly free, at about 40,000 ticks per second headless, leaving the time budget for critters.

This produces meadows and patch edges, real overgrazing with slow recovery, and an incentive for herbivores to move on before a patch collapses.

Knobs (Plants group; all but starting plants and plant energy apply live):

| Knob | Default |
|---|---|
| Starting plants | 2,000 |
| Plant energy | 100 |
| Plant density | 40 per 100 by 100 units at rainforest productivity |
| Crowding radius | 20 units |
| Regrowth time | 60 s |
| Seedling energy | 10% |
| Root reserve | 10% |
| Local seeding, seeding maturity, seed interval, seed radius | on, 50%, 30 s, 30 units |
| Long-distance dispersal, seed rate | on, 0.2 per second per 1,000 by 1,000 units |
| Plant lifespan, mean lifespan | on, 600 s |

With these defaults the default world settles at about 20,000 plants within about 15 minutes of sim time, from rainforest at about 58 plants per 100 by 100 units down to desert at about 11.

### 5.2 Corpses (meat)

- When a critter dies, it becomes a corpse at its position, the size of its body. A critter removed with the inspector leaves none.
- Corpse energy is *meat energy* times body mass: 500 per unit of mass by default, so a size 1 corpse holds five full plants' worth.
- Meat is more energy-dense than plant matter.
- **Decay (Decided)**: a corpse loses a fixed share of its energy each tick, so it halves every *half-life* (60 s), as decomposition roughly does, and it is gone once 5% of its starting energy is left, after about 4.3 half-lives. Decay can be turned off.
- Corpses can't be eaten until diets arrive in Phase 10, since without the digestion trait meat would be free food at full value. They have their own spatial hash for then.

---

## 6. Critters

### 6.1 Genome

A critter's genome has two parts.

**Physical traits** (continuous values, each mutable):

| Trait | Effect | Energy cost |
|---|---|---|
| Size | Mass, radius, max energy storage, damage, heat retention | Basal metabolism scales with mass^0.75 |
| Max speed | Top speed | Maintenance cost |
| Turn rate | Max angular velocity | Maintenance cost |
| Eye placement angle | How far each eye points away from the heading. 0° is fully forward-facing | None directly; trades binocular overlap against total coverage |
| Eye field of view | Angular width of each eye's cone | None directly; a wider eye spreads the same wedges wider, lowering angular precision |
| Wedges per eye | Visual resolution of each eye | Per-wedge cost, plus brain cost of extra inputs |
| Vision range | Cone radius | Cost scales with range |
| Offense | Damage dealt | Maintenance cost |
| Defense | Damage reduction | Maintenance cost and speed penalty |
| Digestion | 0 = herbivore, 1 = carnivore | None; tradeoff is built into efficiency curves |
| Mutation rate | Per-offspring mutation probability | See open questions |

**Derived values** (computed from traits, not genes):

| Value | Derivation | Status |
|---|---|---|
| Radius | `5 × size` world units, so a size 1 critter is 10 units across | Decided |
| Mass | `size³`, so a size 1 critter has mass 1 | Decided |
| Max energy | *Energy storage* × mass: fat stores grow in proportion to the body, so fasting time grows as mass^0.25 | Decided |
| Max water | 100 × mass: water has no other unit, so a size 1 critter's water reads as a percentage | Decided |
| Max age | *Lifespan* × mass^0.25 (larger animals live longer). Every critter of one size lives exactly this long unless something else kills it first | Decided |
| Asexual threshold | Function of physical traits, such as a fraction of max energy storage | Decided; exact formula open |

**Brain genome**: NEAT node genes and connection genes. See section 7.

### 6.2 State

- position, heading, velocity
- energy (stored food energy)
- hydration (stored water)
- health, as a share of full. Nothing harms critters until combat arrives in Phase 10, so it stays full until then
- age
- reproduction cooldown
- species ID (assigned by clustering, for display and stats only)

### 6.3 Death

A critter dies when energy reaches zero, hydration reaches zero, health reaches zero, or age reaches max age. It becomes a corpse. The cause is recorded as starvation, dehydration, injury, or old age, checked in that order when more than one applies. Scattered and spawned critters start at age 0 with full energy, water, and health.

---

## 7. Brain (NEAT)

### 7.1 Genes

- **Node gene**: ID, type (input, hidden, output), activation function.
- **Connection gene**: innovation number, source node, target node, weight, enabled flag.

### 7.2 Innovation tracking

This fixes the biggest v1 bug, where every synapse got a fresh global number and the registry held references to every brain ever created.

- A global **innovation table** maps `(sourceNodeKey, targetNodeKey) → innovation number`. The same structural mutation in two unrelated lineages gets the same number.
- A global **split table** maps `connectionInnovation → newNodeKey`, so splitting the same connection in two lineages produces the same hidden node ID.
- Tables store integers only. No references to synapse or brain objects.
- **Input and output node keys are stable**: each wedge channel has a fixed key of (eye, wedge index, channel), and each internal sense has a fixed key. A genome with 5 wedges per eye and one with 7 share keys for wedges 1 through 5 of each eye, so crossover aligns correctly when wedge count is evolvable.

### 7.3 Initial topology

Inputs and outputs only, no hidden nodes, per standard NEAT. No hand-chosen connections. Whether starting brains are fully connected with random weights or start empty is an open question.

### 7.4 Inputs

**Vision: two-eye model (Decided).** Depth perception comes from binocular overlap, as in real animals.

- Each critter has a left and a right eye, mirrored around its heading. The eyes share one set of eye traits (Decided).
- Each eye points outward from the heading by the **eye placement angle** and spans the **eye field of view**, Each eye is a cone of radius equal to **vision range**, sliced into **wedges per eye** of equal angular width.
- The **binocular zone** is where the two eyes' fields overlap. Wedges in this zone report exact distance.
- The **monocular zone** is everything seen by only one eye. Wedges there still report what they contain, but distance is degraded with seeded Gaussian noise (Decided). The noise standard deviation grows with distance, scaled by a knob. Samples come from a precomputed Gaussian lookup table indexed by the seeded PRNG, which is fast and avoids engine-specific `Math.log` and `Math.cos` results that could break cross-browser replay. If profiling shows the noise is too costly, the fallback is coarse distance bins (near, mid, far).
- Total coverage is the union of both eyes' fields.

The tradeoff is purely geometric, so nothing about predators or prey is hardcoded:

- Forward-facing eyes give a large binocular zone and accurate distances ahead, but a narrow total view. Useful for timing a strike.
- Side-facing eyes give a wide, near-panoramic view, but a small binocular zone and poor distance judgment. Useful for noticing threats from any direction.
- Within each eye, angular resolution is field of view divided by wedges. Wedges tile the whole cone, so nothing in range goes unseen. If two things share a wedge, only the nearer one registers, so low resolution blurs crowded scenes into single readings.

**Per wedge**, for each wedge of each eye:

- distance to the nearest thing in the wedge, normalized by vision range (exact if binocular, degraded if monocular)
- type of that thing (encoding is an open question)

Wedge contents categories: nothing, plant, corpse, critter, wall or impassable terrain, water.

**Terrain in wedges.** Critters, plants, and corpses are found through the spatial hash and binned by angle. Terrain is not an entity, so each wedge also casts one line down its center through the terrain grid to find the nearest wall, deep water, or shallow water. Whichever is nearer, the entity or the terrain, is what the wedge reports.

The brain is **not** told which wedges are binocular (Decided). Brains do not learn within a lifetime, so it is selection that must favor wiring which trusts binocular distances and discounts noisy monocular ones.

**Internal senses** (Proposed):

- energy fraction
- hydration fraction
- health fraction
- age fraction
- current speed
- ambient temperature
- bias (constant 1)

### 7.5 Outputs

| Output | Range | Effect |
|---|---|---|
| Turn | −1 to 1 | Angular velocity as a fraction of turn rate |
| Thrust | 0 to 1 | Forward speed as a fraction of max speed |
| Attack | 0 to 1 | Strikes the nearest critter in range when above threshold |
| Mate | 0 to 1 | Signals readiness to mate when above threshold |

Eating is automatic when in range (Proposed). Asexual reproduction is automatic. Neither is a brain output.

### 7.6 Evaluation

Brains are evaluated once per tick. The activation function is an open question.

**Recurrent connections (Proposed: allowed).** A recurrent connection loops backward, from a later neuron to an earlier one or to itself, and carries the previous tick's value. This gives critters short-term memory: remembering where food was after turning away, persisting in a chase, rhythmic search patterns, or staying in a flee state after an attack. Implementation is cheap in a tick-based sim, since each neuron reads its stored value from last tick. The brain energy cost already penalizes the extra connections.

### 7.7 Mutation operators

- Perturb weight (small Gaussian nudge)
- Replace weight (new random value)
- Add connection (between two unconnected nodes)
- Add node (split an existing connection)
- Toggle connection enabled
- Perturb physical traits

Each operator's probability is a world parameter, scaled by the critter's mutation rate trait.

---

## 8. Movement and physics

Each tick, after every critter has decided (section 13):

- **Turning**: heading changes by `turn × turnRate × dt`. Turning depends on the turn rate trait alone.
- **Speed**: velocity moves toward a target velocity along the heading, `thrust × maxSpeed × terrain factor` (section 4.3.1), by at most `acceleration × dt`. Acceleration is `k_accel × mass^(−1/3)`: muscle force grows with cross-section, mass^(2/3), so acceleration falls as mass grows. Large critters are slow to speed up, slow down, and change direction: at full speed their velocity swings around more slowly than their heading, so they skid through turns.
- **Walls**: a critter's whole body stays inside the world and off deep-water cells. A move that would overlap either slides along it instead, keeping only the part of the move that is clear, and the blocked part of the velocity is dropped.
- **Collisions (soft repulsion)**: critters that overlap are pushed apart along the line between their centers. About two thirds of the overlap is removed over the push-apart time knob (default 0.05 s), split by mass so a heavier critter moves less. Every push is computed from everyone's positions after moving, then applied together, so the order critters are processed in doesn't matter. Pushes obey the walls and leave velocity alone. Collisions can be turned off, and critters then pass through each other.

---

## 9. Energy model

Energy is the single currency. Every tick, a critter pays:

```
cost = (basal + brain + senses + traits + movement + terrain + thermal) × dt
```

**Units (Decided).** Every rate is per second and multiplied by the tick length, as plant growth is, so changing the tick length never changes the biology. Every cost knob is a share of one *unit*: the basal rate of a size 1 critter, set by *energy storage* ÷ *fasting time*. Fasting time is how long a full size 1 critter lasts at rest at a comfortable temperature. Knobs that read as times and shares are easier to tune by feel than raw coefficients, and changing the fasting time speeds up or slows down the whole metabolism at once.

| Term | Formula (shape) | Default | Biological anchor |
|---|---|---|---|
| Basal | `unit × mass^0.75` | fasting time 300 s, storage 1,000 | Kleiber's law |
| Brain | `k_neuron × hiddenNodes + k_synapse × enabledConnections` | 0 until Phase 7 | Brain is about 2% of human mass and 20% of energy use |
| Senses | `k_wedge × totalWedges + k_range × totalWedges × visionRange` | 0 until Phase 6 | Eyes are costly organs |
| Traits | `unit × (k_speed × maxSpeed / 10 + k_turn × turnRate / 100 + ...) × mass` | 5% per 10 u/s, 5% per 100°/s | Weapons, armor, and muscle need upkeep, and muscle grows with the body |
| Movement | `unit × k_run × mass × (speed / 40)²` | 4 × the unit at 40 u/s | Drag-like cost; sprinting is expensive |
| Terrain | `movement × k_terrain × (1 / max(0.1, wading × slope) − 1)` | 1 | Slow ground costs more per unit of distance (§4.3.1) |
| Thermal | see 9.1 | | Heat balance |

Every `k_*` is a world parameter, and every term has an on/off toggle. The brain cost knob is the main lever for whether brains grow or stay small.

- **Trait upkeep (Decided)** grows with mass, since muscle grows with the body: a size 4 critter pays more than a size ¼ one for the same top speed.
- **Movement** uses the critter's actual speed after moving. Half speed costs a quarter as much, so going slowly is also cheaper per unit of distance.
- **Terrain (Decided)**: movement plus terrain is the flat-ground cost per unit of distance divided by the slowdown factor (§4.3.1), so ground that halves top speed doubles the cost of each unit of distance at a given speed. The factor is floored at 0.1, since it falls to 0 at deep water while a critter can still be moving. It is 0 on flat, dry ground.

### 9.1 Thermal cost (emergent from size)

No insulation trait. Temperature affects critters through body geometry alone:

- Heat loss scales with surface area, roughly `mass^(2/3)`.
- Heat production scales with metabolism, roughly `mass^(3/4)`.
- Outside a *comfort band* around a *comfort temperature*, a critter pays `unit × k × (degrees beyond the band) × mass^(2/3)`, with `k` the *cold cost* below the band and the *heat cost* above it. Only the degrees beyond the band are charged, so the cost rises smoothly from the band's edge (Decided).
- Ambient temperature is the mean annual temperature of the cell under the critter.

Because the cost scales with surface area while capacity scales with mass, larger bodies cope with cold better per unit mass. Bergmann's rule should emerge without being coded.

**Heat versus cold (Decided)**: the same surface-area shape on both sides, with separate strengths, so making heat and cold differ is tuning rather than code. Heat matters little on the default world, which tops out near 73°F with land averaging 53°F. Heat also costs water, since water use follows energy spent (§9.2).

Defaults: comfortable from 50 to 70°F (60 ± 10), and 3% of the unit per degree either way, roughly what a small mammal pays per °F below the cold end of its comfort range. A size 1 critter in tundra at 0°F pays 1.5 times its basal rate on top of it.

### 9.2 Hydration

Hydration is a second resource, separate from energy.

- **Drinking (Decided)**: a critter drinks whenever any water cell, shallow or deep, is within its reach: its body radius plus the *reach* knob (3 units). Deep water counts because a critter can stand at a deep-water edge where the shallow band is thin. It fills from empty in the *drink time* (5 s), whatever its size.
- **Drain (Decided)**: water use follows energy spent, one unit of water per so much energy, as real water turnover tracks metabolic rate. So it grows with size (Kleiber), activity, and thermal stress with no extra terms. The rate is set by *thirst time*: how long a full size 1 critter lasts at rest at a comfortable temperature (120 s). Turning a cost off also stops the water it would have used.
- **Water in food (Decided)**: plants give water in proportion to energy eaten, set by a knob, 0 by default so drinking matters. Meat gives none until diets arrive.

---

## 10. Eating and digestion

### 10.1 Eating

When a plant or corpse is within the critter's interaction radius, the critter eats from it, up to a bite size per tick, until it is full or the food is gone.

**Decided for plants**:

- Eating is automatic, not a brain output. An eat output has no downside, so it would only evolve to always on.
- Reach is the body radius plus the *reach* knob, the same as for drinking.
- Each tick a critter that isn't full bites the **fullest plant in reach**, as selective grazers do. This grazes a patch evenly rather than killing plants one at a time, and leaves regrowing plants alone.
- The bite is the *bite rate* (50 energy per second for size 1) times mass^0.75, so intake keeps pace with basal cost. A flat bite would starve large critters.
- A plant grazed below its root reserve dies (§5.1), so a critter that stays in one place kills the plants around it.
- When two critters reach for the same plant, the one that feeds first takes its bite. Critters feed in a new random order each tick, from their own random stream, so no critter always gets first pick (§13).

### 10.2 Digestion spectrum

Trait `d` in [0, 1]. Energy gained from a bite:

```
gain = biteEnergy × efficiency(foodType, d)
```

- Plant efficiency is highest at `d = 0` and falls toward a floor at `d = 1`.
- Meat efficiency is highest at `d = 1` and falls toward a floor at `d = 0`.
- The **crossover height** where the curves meet is a knob. A high crossover makes omnivory viable. A low crossover favors specialists.

Herbivores, carnivores, and omnivores are not labels. They are regions of the `d` distribution that we observe.

---

## 11. Combat

### 11.1 Hunting

There is no hardcoded hunting mode. Hunting is expected to emerge from the combination of:

- eyes that report critters
- the speed-squared movement cost, which makes bursts expensive
- the attack output
- meat being energy-dense for high-`d` critters

All critters have the attack output and offense and defense traits from birth. In herbivore lineages the attack output is expected to stay unused and offense to drift down because it costs upkeep. This is the "dormant trait" model.

### 11.2 Attack resolution

When attack output exceeds its threshold and another critter is within attack range:

```
damage = baseDamage × (sizeA × offenseA / (sizeB × defenseB)) ^ damageExponent
```

This carries over v1's formula. `baseDamage` and `damageExponent` are knobs. Attacking also costs energy. Whether there is a cooldown between strikes is an open question.

A critter killed by an attack becomes a corpse at once and can be eaten by the attacker or anyone else.

---

## 12. Reproduction

### 12.1 Sexual

Two critters A and B mate when all hold:

- distance between them ≤ mating range
- both mate outputs above threshold
- both energy above the mating threshold
- both off reproduction cooldown
- compatibility distance δ(A, B) < compatibility threshold

The child is placed between the parents.

**Brain crossover** (standard NEAT):

- Matching genes (same innovation number): inherit from either parent at random.
- Disjoint and excess genes: inherit from the fitter parent. NEAT has no fitness score in an open-ended world, so the fitness proxy is an open question.
- A gene disabled in either parent has a chance of staying disabled.

**Trait inheritance**: the method for combining physical traits is an open question.

Then mutation applies to the child.

### 12.2 Asexual

Automatic, not a brain output. When a critter's energy crosses the asexual threshold and it is off cooldown, it produces a clone with mutation applied. The threshold is derived from the critter's physical traits, not inherited as its own gene.

### 12.3 Energy accounting (Proposed)

To avoid an engineered incentive in either direction, a child always costs the same total investment `E_child`:

- Sexual: each parent pays `E_child / 2` and passes on half its genes.
- Asexual: the parent pays `E_child` and passes on all of its genes.

Genes passed per unit energy are equal. The only differences between the two strategies are the real biological ones: sex requires finding and reaching a compatible mate, and sex recombines genomes, which purges harmful mutations (Muller's ratchet) and combines beneficial ones.

Note: if the asexual threshold is fixed at or below the mating threshold, cloning will usually fire before a mate is found. See open questions.

### 12.4 Compatibility distance

Standard NEAT distance, plus a trait term:

```
δ = c1 × E / N + c2 × D / N + c3 × W̄ + c4 × traitDistance
```

E is excess genes, D is disjoint genes, W̄ is the mean weight difference of matching genes, and N is the size of the larger genome. Every `c` and the threshold are knobs. Reproductive isolation, and therefore species, emerge from this gate.

### 12.5 Species labels

For display and statistics only, the population is periodically clustered into species by δ. Labels do not affect the simulation.

---

## 13. Tick order

All critters sense and decide from the same world state before anyone acts, so iteration order cannot bias outcomes. v1 updated critters one at a time, so early critters always moved first.

1. **Sense**: fill each eye's wedges and read internal state for every critter.
2. **Think**: evaluate every brain and record outputs.
3. **Move**: apply turning and thrust, resolve walls and terrain.
4. **Attack**: resolve strikes and apply damage.
5. **Eat**: resolve feeding on plants and corpses, and drinking, in a random order each tick.
6. **Reproduce**: resolve mating pairs, then asexual births.
7. **Metabolize**: deduct all energy costs, age everyone, tick cooldowns.
8. **Die**: remove dead critters in slot order, count them by cause, and spawn corpses.
9. **Environment**: grow and seed plants, decay corpses.
10. **Index**: update the spatial hash.
11. **Stats**: record metrics every K ticks.

Conflict rules, such as two critters eating the last bite of one plant or one critter being chosen as mate by two others, resolve in a deterministic order using the seeded PRNG.

---

## 14. Interfaces

### 14.1 Web app

- **World view** (PixiJS): terrain baked to a texture once at generation, in a pixel-art style. Each cell is one flat-colored pixel, scaled up without smoothing, and values come in steps rather than smooth gradients, so edges stay crisp at any zoom. Map views:
  - **Biome** (default) and **terrain type**: one color per biome or type.
  - **Elevation**: 8 bands of height, from green lowlands to white peaks, and 3 bands of water depth.
  - **Temperature**: 9°F steps starting at freezing, blue below and red above. The biome thresholds (23, 41, and 68°F) fall on step edges, so bands line up with biome borders.
  - **Rainfall**: 10 inch steps of one blue. The biome thresholds (20, 40, 80, and 100 in) fall on step edges.
  - **Relief** (on by default): shading from elevation, lit from the northwest, in three levels (lit, plain, shadow, plus a deeper shadow on steep slopes) over the biome, terrain type, and elevation views. Gentle slopes stay plain. Not offered for temperature and rainfall, where lightness carries the value. The shading's exaggeration scales with landform size, so a bigger world with proportionally bigger landforms looks the same.

  The views are pure functions in `core`, shared with the CLI contact sheet so both draw the same thing. Pan and zoom; click to select. Optional vision-cone overlay for the selected critter, showing each wedge, with binocular and monocular zones shaded differently.
- **Plants** are drawn as particles in one Pixi `ParticleContainer`, sized and colored by energy: dim olive when grazed, bright lime when full. They never shrink below about two pixels across, so density stays visible when zoomed out. While plants are shown, the map is dimmed so they stand out on every biome. Corpses and critters will be drawn as sprites.
- **Brushes** (debug tools): a graze brush grazes plants down to a chosen share of full energy, killing those left below the root reserve, and a plant brush sows fully grown plants. Right-drag pans while a brush is selected.
- **Critter coloring modes**: by species, by digestion trait, by energy, by generation.
- **Controls**: play, pause, single step, speed.
- **World setup**: a Settings page with every knob, grouped by category and searchable, plus a few featured knobs beside the world. Generate new world. Knobs marked live apply at once to the running world; the rest apply to the next world.
- **Inspector** for the selected critter: energy, water, health, and age; the energy budget as two bars on one scale, what it ate and its costs stacked by term, per second, with the net and when energy or water runs out; traits; state; live brain graph with activations; lineage. When the selected critter dies, the inspector says how and a ring marks the spot.
- **Corpses** are drawn as dull red discs with a dark cross, the size of the body, fading as they decay.
- **Statistics**, on its own tab beside World and Settings, drawn with uPlot: plant count and plant energy over time, in total or per biome as density, so sparse and dense biomes share one scale; population over time, deaths by cause, energy eaten and spent per second in total and by cost, energy held in critters and corpses, species count, trait histograms over time (digestion, size, eye placement angle, eye field of view, wedges per eye, vision range), sexual vs asexual birth fraction, average brain size.
- **Save, load, and export** of world state and stats.

### 14.2 CLI

```
critter-evo run --config world.json --seed 42 --ticks 100000 --out results/
```

- Runs `core` in Node with no rendering.
- Writes periodic stats as CSV and optional world snapshots.
- Intended for experiments such as sweeping a knob across seeds.

---

## 15. Metrics

Recorded in `core` every 30 ticks from tick 0, column by column. When 2,048 rows are full, every other row is dropped and the interval doubles, so a long run keeps its whole history at a coarser resolution in bounded memory. The web app and the CLI read the same recorder. Plant count and plant energy, in total and per biome, are recorded from Phase 3; population, deaths by cause, critter and corpse energy, and energy eaten and spent from Phase 5. Deaths and energy eaten and spent are running totals, so they stay exact when rows are thinned; charts take the difference between rows. The full list:

- population, births, deaths by cause (starvation, dehydration, injury, old age)
- species count and sizes
- fraction of births that were sexual
- mean and distribution of each physical trait
- mean hidden nodes and enabled connections
- total plant energy, total corpse energy, total critter energy
- energy spent by cost category, population-wide

---

## 16. Open questions

### Decided in spirit, details open

1. ~~Hydration details~~ Resolved: water use follows energy spent; plants give water through a knob, 0 by default (section 9.2).
2. ~~Terrain slowdown conditions~~ Resolved: wading by depth and size, slope by Tobler's hiking function and size, on a 240 ft per unit map scale knob. No movement cost by biome (section 4.3.1).
3. ~~Field of view~~ Resolved: evolvable.
4. **Wedge content encoding.** One-hot per category (about 6 inputs per wedge), a smaller encoding, or extra detail about critters seen, such as relative size or genetic similarity?
4a. ~~Monocular distance degradation~~ Resolved: seeded Gaussian noise, with coarse bins as the fallback if too slow.
4b. ~~Zone awareness~~ Resolved: no binocular input; selection favors brains that trust the right distances.
4c. ~~Eye symmetry~~ Resolved: mirrored eyes sharing one set of traits.
5. **Asexual threshold formula.** Decided: derived from physical traits, not a gene. Open: the exact formula, and how it relates to the mating threshold so cloning does not always fire before mating.
6. **Mutation rate.** Evolvable trait as in v1, or world knob? Max age is derived from mass (section 6.1).

### Brain

7. Initial brains fully connected with random weights, or empty?
8. ~~Allow recurrent connections?~~ Proposed: allowed (section 7.6).
9. Activation function: tanh everywhere, or per-node evolvable?
10. Fitness proxy for disjoint and excess gene inheritance: parent energy, age, or offspring count?

### Reproduction

11. Physical trait inheritance: average of parents, random pick per trait, or blend with noise?
12. Child starting energy: equal to `E_child`, or a fraction?
13. Separate sexes: skip (Proposed) or include?

### Physics and combat

14. ~~Critter-critter collision~~ Resolved: soft repulsion, split by mass (section 8).
15. Attack cooldown, and energy cost per strike.
16. ~~Heat stress~~ Resolved: the same surface-area shape as cold, with its own strength knob (section 9.1).

### Project

17. ~~Hosting~~ Resolved: GitHub Pages.
18. ~~Charting library for the stats panel~~ Resolved: uPlot, for fast live time series. Trait-over-time heatmaps (Phase 8) will be custom canvas.
19. ~~Target world size and population~~ Resolved: about 1,000 critters on the default world. Plants alone must run at 5,000 ticks per second or more at Max. On the earlier 3000 by 3000 default, about 20,000 plants ran at about 11,000 in the browser and 40,000 headless. On the 5000 by 5000 default, about 56,000 plants at the same density run at about 4,200 in the browser and 21,000 headless, short of that budget. Closing the gap is left to the Phase 11 performance pass.
20. ~~Eating automatic or a brain output~~ Resolved: automatic, from the fullest plant in reach (section 10.1).
21. ~~Corpse decay~~ Resolved: yes, by half-life (section 5.2).

---

## 17. v1 to v2 mapping

| v1 feature | v2 |
|---|---|
| Grid world | Continuous space over a coarse terrain grid |
| OpenSimplex terrain, 4 octaves | Kept for elevation, with gentler persistence so land is smooth; temperature and rainfall fields added |
| Mountains and water | Kept, with shares set by coverage knobs; shallow water and biomes added |
| Random food spawn on grass | Regrowing plants by biome |
| Hunger, thirst, health | Energy, water, and health |
| 8-way orientation and rotation costs | Continuous heading and turn rate |
| A* pathfinding with path cache | Removed; the brain steers |
| Brain picks a priority; code finds target | Brain controls movement and actions directly |
| Brain inputs: health, hunger, thirst | Wedge-based eyes plus internal senses |
| Vision radius trait | Two eyes with evolvable placement, field of view, wedge count, and range; binocular depth perception |
| Partial NEAT, asexual only | Full NEAT with crossover and speciation |
| Offense, defense, size, damage formula | Kept, with upkeep costs |
| Aggression trait | Removed; aggression is brain behavior |
| Sex trait (unused) | Removed (Proposed) |
| Corpse becomes food | Kept, as meat with a digestion spectrum |
| Trait mutation up to 20% | Kept in spirit; magnitudes become knobs |
| Swing GUI on the event thread | React and Pixi on main thread, sim in a Worker |
| Unused ThreadPool and dirty cells | Replaced by Worker, typed-array snapshots, Pixi |
| Statistics tab with bar charts | Time-series charts, trait histograms, inspector |
| No reproducibility | Seeded, deterministic, save and load |

---

## 18. Deferred features

Not in v2 scope. Listed so the architecture leaves room for them.

- **Seasons**: periodic global temperature cycle driving plant growth.
- **Climate drift**: slow random walk in global temperature that shifts biomes.
- **Parasites**: pathogens whose transmission scales with host genetic similarity (Red Queen hypothesis).
- **Evolving plants**: plant genomes with toxins, thorns, or growth rate, coevolving with herbivores.
- **Animal seed dispersal**: seeds carried in critter guts and dropped elsewhere.
- **Insulation trait**: explicit fur or fat if size alone produces too little regional variation.
- **Day and night**: light level affecting vision.
- **Rain belts by latitude**: wet at the equator, dry around 30°, wetter at mid-latitudes, and dry at the poles, as on Earth, so deserts form in belts beside the tropics and rainforest along the equator. Only meaningful with latitude cooling on.
- **Sensing other critters' kinship** or emitting signals (color, sound) for communication.
