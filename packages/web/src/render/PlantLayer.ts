import type { PlantSnapshot, RGB } from "@critter-evo/core";
import { Particle, ParticleContainer, Texture } from "pixi.js";

/** Plant radius in world units with no energy and at full energy. A critter is about 10 units across. */
const EMPTY_RADIUS = 1.2;
const FULL_RADIUS = 3.2;
/** Smallest radius on screen, in pixels, so plants stay visible when zoomed out. */
const MIN_SCREEN_RADIUS = 0.9;
/** Plant colors from no energy to full: a grazed plant is dim, a full one bright. */
const EMPTY_COLOR: RGB = [92, 104, 40];
const FULL_COLOR: RGB = [196, 245, 92];
const TEXTURE_SIZE = 32;

/**
 * Draws plants as particles, sized and colored by energy (docs/DESIGN.md §14.1).
 * Particles are reused from frame to frame; only their count changes as plants
 * sprout and die.
 */
export class PlantLayer {
  readonly container: ParticleContainer;
  private readonly texture: Texture;
  private readonly pool: Particle[] = [];
  /** Packed particle color (alpha, blue, green, red) for each energy byte. */
  private readonly colors = new Int32Array(256);

  constructor() {
    this.texture = discTexture();
    this.container = new ParticleContainer({
      texture: this.texture,
      dynamicProperties: { position: true, vertex: true, color: true },
    });
    for (let k = 0; k < 256; k++) {
      const f = k / 255;
      const [r, g, b] = EMPTY_COLOR.map((c, i) => Math.round(c + (FULL_COLOR[i]! - c) * f)) as [number, number, number];
      this.colors[k] = (255 << 24) | (b << 16) | (g << 8) | r;
    }
  }

  /** Shows the plants in a snapshot, at a zoom in screen pixels per world unit. */
  update(plants: PlantSnapshot, zoom: number): void {
    const n = plants.count;
    const children = this.container.particleChildren;
    if (children.length !== n) {
      while (this.pool.length < n) this.pool.push(new Particle({ texture: this.texture, anchorX: 0.5, anchorY: 0.5 }));
      children.length = n;
      for (let i = 0; i < n; i++) children[i] = this.pool[i]!;
      this.container.update();
    }
    const minRadius = MIN_SCREEN_RADIUS / zoom;
    const toScale = 2 / TEXTURE_SIZE;
    for (let i = 0; i < n; i++) {
      const particle = children[i]!;
      const e = plants.energy[i]!;
      const radius = Math.max(minRadius, EMPTY_RADIUS + ((FULL_RADIUS - EMPTY_RADIUS) * e) / 255);
      particle.x = plants.x[i]!;
      particle.y = plants.y[i]!;
      particle.scaleX = particle.scaleY = radius * toScale;
      particle.color = this.colors[e]!;
    }
  }

  destroy(): void {
    this.container.destroy();
    this.texture.destroy(true);
  }
}

/** A white disc with a slightly darker rim, so neighboring plants stay distinct when zoomed in. */
function discTexture(): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = TEXTURE_SIZE;
  const g = canvas.getContext("2d")!;
  const c = TEXTURE_SIZE / 2;
  g.fillStyle = "rgb(150,150,150)";
  g.beginPath();
  g.arc(c, c, c - 0.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#fff";
  g.beginPath();
  g.arc(c, c, c - 3, 0, Math.PI * 2);
  g.fill();
  return Texture.from(canvas);
}
