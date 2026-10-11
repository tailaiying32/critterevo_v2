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
| Hydration | Separate resource from energy; drinking from water | Decided |
| Shallow water, mountains | Passable but slow; slowdown depends on local conditions | Decided |
| Field of view | Evolvable trait | Decided |
| Asexual threshold | Derived from physical traits, not a gene | Decided |
| Max age | Derived from body mass (lifespan ∝ mass^0.25), not a gene | Proposed |
| Plant reproduction | Plants seed nearby; overgrazing can kill plants | Proposed |
| Recurrent connections | Allowed | Proposed |
| Terrain slowdown | Set by water depth, slope, and critter size; also costs energy | Proposed |
| Temperature effect | Emergent from body size and surface area only | Decided |
| Repo layout | npm workspaces monorepo: `core`, `web`, `cli` packages | Decided (scaffolded) |
| Tooling | Vite, Vitest, ESLint, TypeScript 6.0 | Decided (scaffolded) |
| Hosting | GitHub Pages, deployed by GitHub Actions | Decided |
| Eating | Automatic when in range, not a brain output | Proposed |
| Sexes | No separate sexes; any two compatible critters can mate | Proposed |
| Corpse decay | Corpses lose energy over time | Proposed |
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

A uniform spatial hash, rebuilt or incrementally updated each tick, indexes critters, plants, and corpses. It supports:

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

A coarse grid sits underneath the continuous space. Cells are 10 world units across by default (a knob), about one critter, as v1's cells were, so the default 2000 by 2000 world is 200 by 200 cells. Each cell holds one value per field, with no blending between cells. Entities sample the cell under them, or ahead of them, by converting continuous position to cell coordinates.

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
| Landform size | Terrain | 900 units |
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
| Shore rain range | Climate | 100 units |
| Inland drying | Climate | 0.25 |
| Inland drying range | Climate | 200 units |

With these defaults the tallest peak is 108°F colder than sea level, about −38°F, so climate zones ring every mountain: a thin fringe of savanna and rainforest along the warmest shores, broad grassland and forest plains, taiga up the slopes, and tundra on the summits. Sea level sits just above the 68°F tropical line, so only land within about 550 ft of sea level is tropical.

The climate defaults were tuned for a balanced mix of biomes. Averaged over 8 seeds, land is about 10% tundra, 13% taiga, 38% grassland, 16% temperate forest, 8% temperate rainforest, 1% desert, 9% savanna, and 5% rainforest. These settings matter most:

- **Peak height, lowland flatness, and landform size** decide how much land sits in each climate zone, since height alone sets temperature, and how much of it is plains. With Earth's lapse rate, cold zones need tall peaks: with 12,000 ft peaks there is no tundra at all. Lowland flatness 0.85 and 900 unit landforms leave about a fifth of the land as broad, flat plains with separate mountains rising out of them; plain noise alone gives almost none.
- **Sea-level temperature** sets how much of the world is tropical. Below 68°F there are no tropical biomes at all; at 70°F they are a thin fringe along the shores.
- **Rainfall skew** makes very wet places rare. With rainfall spread evenly, as much land gets 100 to 120 inches as gets 5 to 25, and temperate rainforest covers a fifth of the land.
- **Wetter shores, drier interiors.** Every body of water sits at sea level, the hottest ground, so the land around water is always tropical. Without rain near water and inland drying, that hot ring is mostly desert and savanna. With them, shores are savanna and rainforest, and the few deserts sit inland. Deserts are rare because hot land far from water barely exists when climate follows height.

### 4.3 Terrain types

| Type | Passable | Notes |
|---|---|---|
| Deep water | No | Water below the shallow band. Acts as a wall |
| Shallow water | Yes, slow | The share of water closest to sea level, at the edges of seas and lakes. Drinkable. Slowdown depends on local conditions (open) |
| Land | Yes | Movement cost and plant growth set by biome |
| Mountain | Yes, slow | The highest share of the world. Has a biome like land, and is cold because of its height. Slowdown depends on local conditions (open) |

Terrain type affects movement and drinking. Climate and biome come only from temperature and rainfall.

### 4.3.1 Terrain slowdown (Proposed)

- **Shallow water**: slowdown rises with depth, from near-land speed at the shore to impassable at the deep-water boundary.
- **Mountains**: slowdown rises with local slope from the elevation field. Uphill costs more than downhill.
- **Body size**: larger critters wade deeper water more easily. Smaller critters handle steep ground more easily.
- **Energy**: slow terrain also raises movement energy cost per unit of distance, so crossing it is a tradeoff, not just a delay.

**Slope comes from the stored values, never the map colors.** The stepped colors and relief shading are drawing only; movement reads each cell's exact elevation and height in feet. Because a cell holds one height, charging for the jump at each cell edge would make climbing jerky. Instead, each cell gets a slope vector from its neighbors (the same math as relief shading, kept as exact numbers), and each tick a critter pays for the distance it moved along that slope: uphill costs more, downhill less, and moving across a slope is neutral. The map leaves gentle slopes unshaded, but critters still feel them; a slope view can show the exact values if that matters. Open: how many feet a world unit represents, since climbing cost depends on real steepness.

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

- plant spawn density and regrowth rate
- plant maximum energy
- movement cost multiplier

Exact values are tuning parameters.

---

## 5. Food

### 5.1 Plants

- Plants are persistent entities with a position, a current energy, a maximum energy, and an age.
- Plants regrow toward their maximum at a rate set by their biome.
- **Local seeding (Proposed)**: a plant above a maturity energy level has a per-tick chance to drop a seed within a dispersal radius. The chance and radius are set by biome.
- **Crowding (Proposed)**: a seed fails if the spot is already dense with plants, standing in for competition over light and soil.
- **Grazing death (Proposed)**: a plant grazed below a root reserve dies. Overgrazing therefore removes seed sources, and a stripped patch can only recover from its edges.
- **Long-distance dispersal (Proposed)**: a small background rate of seeds landing anywhere suitable, standing in for wind and birds. Without it, a fully stripped region can never recover.
- **Plant lifespan (Proposed)**: plants age and eventually die, so patches turn over even without grazing.

This produces meadows and patch edges, real overgrazing with slow recovery, and an incentive for herbivores to move on before a patch collapses.

### 5.2 Corpses (meat)

- When a critter dies, it becomes a corpse at its position.
- Corpse energy is proportional to body mass.
- Meat is more energy-dense than plant matter.
- Corpses decay over time (Proposed), so the world does not fill with meat.

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
| Max age | `k_lifespan × mass^0.25` (larger animals live longer) | Proposed |
| Asexual threshold | Function of physical traits, such as a fraction of max energy storage | Decided; exact formula open |

**Brain genome**: NEAT node genes and connection genes. See section 7.

### 6.2 State

- position, heading, velocity
- energy (stored food energy)
- hydration (stored water)
- health
- age
- reproduction cooldown
- species ID (assigned by clustering, for display and stats only)

### 6.3 Death

A critter dies when energy reaches zero, hydration reaches zero, health reaches zero, or age reaches max age. It becomes a corpse.

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

- Each tick: heading changes by `turn × turnRate × dt`. Velocity moves toward `thrust × maxSpeed` along the heading.
- Mass derives from size. Larger critters accelerate more slowly.
- Terrain movement cost multiplier applies by biome.
- Walls and impassable terrain stop movement.
- Critter-to-critter collision behavior is an open question.

---

## 9. Energy model

Energy is the single currency. Every tick, a critter pays:

```
cost = basal + brain + senses + traits + movement + thermal
```

| Term | Formula (shape) | Biological anchor |
|---|---|---|
| Basal | `k_basal × mass^0.75` | Kleiber's law |
| Brain | `k_neuron × hiddenNodes + k_synapse × enabledConnections` | Brain is about 2% of human mass and 20% of energy use |
| Senses | `k_wedge × totalWedges + k_range × totalWedges × visionRange` | Eyes are costly organs |
| Traits | `k_offense × offense + k_defense × defense + k_speed × maxSpeed + ...` | Weapons, armor, and muscle need upkeep |
| Movement | `k_move × mass × speed²` | Drag-like cost; sprinting is expensive |
| Thermal | see 9.1 | Heat balance |

Every `k_*` is a world parameter. The brain cost knob is the main lever for whether brains grow or stay small.

### 9.1 Thermal cost (emergent from size)

No insulation trait. Temperature affects critters through body geometry alone:

- Heat loss scales with surface area, roughly `mass^(2/3)`.
- Heat production scales with metabolism, roughly `mass^(3/4)`.
- Outside a comfort band around a neutral temperature, a critter pays `k_thermal × |ambient − neutral| × mass^(2/3)` per tick.

Because the cost scales with surface area while capacity scales with mass, larger bodies cope with cold better per unit mass. Bergmann's rule should emerge without being coded. Whether heat stress penalizes large bodies symmetrically is an open question.

### 9.2 Hydration

Hydration is a second resource, separate from energy.

- Critters drink when within interaction range of shallow water.
- Hydration drains every tick. How the drain scales (with size, activity, ambient temperature) is open.
- Whether meat or plants also supply some water is open.

---

## 10. Eating and digestion

### 10.1 Eating

When a plant or corpse is within the critter's interaction radius, the critter eats from it, up to a bite size per tick, until it is full or the food is gone.

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
5. **Eat**: resolve feeding on plants and corpses.
6. **Reproduce**: resolve mating pairs, then asexual births.
7. **Metabolize**: deduct all energy costs, age everyone, tick cooldowns.
8. **Die**: remove dead critters and spawn corpses.
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
  - **Relief** (on by default): shading from elevation, lit from the northwest, in three levels (lit, plain, shadow, plus a deeper shadow on steep slopes) over the biome, terrain type, and elevation views. Gentle slopes stay plain. Not offered for temperature and rainfall, where lightness carries the value.

  The views are pure functions in `core`, shared with the CLI contact sheet so both draw the same thing. Plants, corpses, and critters are drawn as sprites; plants, corpses, and critters as sprites; pan and zoom; click to select. Optional vision-cone overlay for the selected critter, showing each wedge, with binocular and monocular zones shaded differently.
- **Critter coloring modes**: by species, by digestion trait, by energy, by generation.
- **Controls**: play, pause, single step, speed.
- **World setup**: a Settings page with every knob, grouped by category and searchable, plus a few featured knobs beside the world. Generate new world.
- **Inspector** for the selected critter: traits, state, energy budget breakdown by cost term, live brain graph with activations, lineage.
- **Statistics**: population over time, species count, trait histograms over time (digestion, size, eye placement angle, eye field of view, wedges per eye, vision range), sexual vs asexual birth fraction, average brain size.
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

Recorded every K ticks:

- population, births, deaths by cause (starvation, combat, old age)
- species count and sizes
- fraction of births that were sexual
- mean and distribution of each physical trait
- mean hidden nodes and enabled connections
- total plant energy, total corpse energy, total critter energy
- energy spent by cost category, population-wide

---

## 16. Open questions

### Decided in spirit, details open

1. **Hydration details.** Decided: hydration is a separate resource. Open: what drives the drain rate, and whether food supplies any water.
2. **Terrain slowdown conditions.** Decided: shallow water and mountains are passable but slow, and slope is read from stored heights through a per-cell slope vector, not from the map's steps. Proposed factors in section 4.3.1. Open: the scale of a world unit in feet.
3. ~~Field of view~~ Resolved: evolvable.
4. **Wedge content encoding.** One-hot per category (about 6 inputs per wedge), a smaller encoding, or extra detail about critters seen, such as relative size or genetic similarity?
4a. ~~Monocular distance degradation~~ Resolved: seeded Gaussian noise, with coarse bins as the fallback if too slow.
4b. ~~Zone awareness~~ Resolved: no binocular input; selection favors brains that trust the right distances.
4c. ~~Eye symmetry~~ Resolved: mirrored eyes sharing one set of traits.
5. **Asexual threshold formula.** Decided: derived from physical traits, not a gene. Open: the exact formula, and how it relates to the mating threshold so cloning does not always fire before mating.
6. **Mutation rate.** Evolvable trait as in v1, or world knob? Max age is proposed as derived from mass (section 6.1).

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

14. Critter-critter collision: pass through, soft repulsion, or hard?
15. Attack cooldown, and energy cost per strike.
16. Heat stress: symmetric with cold stress, or does it scale differently with size?

### Project

17. ~~Hosting~~ Resolved: GitHub Pages.
18. Charting library for the stats panel.
19. Target world size and population for performance budgeting.
20. Eating automatic (Proposed) or a brain output?
21. Corpse decay (Proposed): yes or no?

---

## 17. v1 to v2 mapping

| v1 feature | v2 |
|---|---|
| Grid world | Continuous space over a coarse terrain grid |
| OpenSimplex terrain, 4 octaves | Kept for elevation, with gentler persistence so land is smooth; temperature and rainfall fields added |
| Mountains and water | Kept, with shares set by coverage knobs; shallow water and biomes added |
| Random food spawn on grass | Regrowing plants by biome |
| Hunger, thirst, health | Energy and health; hydration open |
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
