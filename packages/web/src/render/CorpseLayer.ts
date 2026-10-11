import type { CorpseSnapshot } from "@critter-evo/core";
import { Particle, ParticleContainer, Texture } from "pixi.js";

/** Smallest radius on screen, in pixels, so corpses stay visible when zoomed out. */
const MIN_SCREEN_RADIUS = 2;
/** A dull, dark red, distinct from every critter and plant color. */
const CORPSE_COLOR: [number, number, number] = [168, 74, 66];
/** Opacity of a fresh corpse and of one about to be gone. */
const FRESH_ALPHA = 1;
const ROTTEN_ALPHA = 0.25;
const TEXTURE_SIZE = 64;

/**
 * Draws corpses as particles: a dull red disc the size of the body it was,
 * with a dark cross, fading as it decays (docs/DESIGN.md §5.2, §14.1). Drawn
 * above plants and below critters.
 */
export class CorpseLayer {
  readonly container: ParticleContainer;
  private readonly texture: Texture;
  private readonly pool: Particle[] = [];
  /** Packed particle color (alpha, blue, green, red) for each energy byte. */
  private readonly colors = new Int32Array(256);

  constructor() {
    this.texture = corpseTexture();
    this.container = new ParticleContainer({
      texture: this.texture,
      dynamicProperties: { position: true, vertex: true, color: true },
    });
    const [r, g, b] = CORPSE_COLOR;
    for (let k = 0; k < 256; k++) {
      const alpha = Math.round((ROTTEN_ALPHA + ((FRESH_ALPHA - ROTTEN_ALPHA) * k) / 255) * 255);
      this.colors[k] = (alpha << 24) | (b << 16) | (g << 8) | r;
    }
  }

  /** Shows the corpses in a snapshot, at a zoom in screen pixels per world unit. */
  update(corpses: CorpseSnapshot, zoom: number): void {
    const n = corpses.count;
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
      particle.x = corpses.x[i]!;
      particle.y = corpses.y[i]!;
      particle.scaleX = particle.scaleY = Math.max(minRadius, corpses.radius[i]!) * toScale;
      particle.color = this.colors[corpses.energy[i]!]!;
    }
  }

  destroy(): void {
    this.container.destroy();
    this.texture.destroy(true);
  }
}

/** A white disc with a darker rim and a dark diagonal cross. */
function corpseTexture(): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = TEXTURE_SIZE;
  const g = canvas.getContext("2d")!;
  const c = TEXTURE_SIZE / 2;
  g.fillStyle = "rgb(110,110,110)";
  g.beginPath();
  g.arc(c, c, c - 0.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#fff";
  g.beginPath();
  g.arc(c, c, c - 5, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgb(40,40,40)";
  g.lineWidth = 6;
  g.lineCap = "round";
  const arm = c * 0.45;
  g.beginPath();
  g.moveTo(c - arm, c - arm);
  g.lineTo(c + arm, c + arm);
  g.moveTo(c + arm, c - arm);
  g.lineTo(c - arm, c + arm);
  g.stroke();
  return Texture.from(canvas);
}
