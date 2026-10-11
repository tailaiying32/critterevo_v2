# Terrain prototypes (paused)

Standalone scripts from exploring realistic terrain generation. They render comparison PNGs and are not part of the app. Terrain was reset to flat land and water so work could move on to critters; these are kept here to pick back up later.

- `noise-comparison/proto.ts`: current noise vs gentle noise vs gentle noise plus droplet erosion.
- `plates/plates.ts`: Layer 1, tectonic plates and uplift. Renders plates, uplift, and an elevation preview.
- `plates/coast-stats.ts`: slope versus distance from the coast, and inland sea sizes.
- `plates/scale.ts`: critters drawn to scale on a plates world.
- `erosion/layer2.ts`: Layer 2, uplift plus stream-power river erosion (Braun and Willett 2013), with rivers traced by the app's river code.

Settings agreed so far: 10 plates, 85% continental, 20% water, no inland sea cap, soil creep 4 m²/yr, rock hardness variation 0.6, critters about 10 units across.

Open issues when work stopped:
- Closed map edges make rivers run along the walls; the next step was opening the edges so rivers flow off the map.
- Rock hardness can push peaks above 10,000 m; the next step was scaling heights to a target peak of about 6,000 m.

Run from the repo root, for example:

```bash
WATER=0.2 LAND_SHARE=0.85 NO_RENDER=1 npx tsx experiments/terrain-prototypes/erosion/layer2.ts /tmp 1,2,3
```
