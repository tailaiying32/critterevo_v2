import { ControllerKind, type CritterInfo, type CritterSnapshot, type DeathRecord } from "@critter-evo/core";
import { Container, Graphics, Particle, ParticleContainer, Texture } from "pixi.js";

/** Smallest radius on screen, in pixels, so critters stay visible when zoomed out. */
const MIN_SCREEN_RADIUS = 2.5;
/** Body color by controller, packed as alpha, blue, green, red for particles. */
const CONTROLLER_COLORS: Record<ControllerKind, [number, number, number]> = {
  [ControllerKind.Idle]: [176, 184, 192],
  [ControllerKind.Wander]: [255, 168, 92],
  [ControllerKind.Keyboard]: [96, 214, 255],
};
const SELECTION_COLOR = 0xffffff;
/** Ring where the selected critter died, in screen pixels. */
const DEATH_RING_PIXELS = 10;
const VELOCITY_COLOR = 0xffe066;
/** The velocity line shows where the selected critter would be after this many seconds. */
const VELOCITY_SECONDS = 0.5;
const TEXTURE_SIZE = 64;

/**
 * Draws critters as particles: a disc the size of the body, with a dark line
 * from the center to the front edge showing the heading, colored by what
 * drives it (docs/DESIGN.md §14.1). The selected critter gets a ring and a
 * line along its velocity, so skidding through a turn shows.
 */
export class CritterLayer {
  readonly container = new Container();
  private readonly particles: ParticleContainer;
  private readonly overlay = new Graphics();
  private readonly texture: Texture;
  private readonly pool: Particle[] = [];
  private readonly colors: Record<number, number> = {};

  constructor() {
    this.texture = critterTexture();
    this.particles = new ParticleContainer({
      texture: this.texture,
      dynamicProperties: { position: true, rotation: true, vertex: true, color: true },
    });
    this.container.addChild(this.particles, this.overlay);
    for (const [kind, [r, g, b]] of Object.entries(CONTROLLER_COLORS)) this.colors[Number(kind)] = (255 << 24) | (b << 16) | (g << 8) | r;
  }

  /**
   * Shows the critters in a snapshot, at a zoom in screen pixels per world
   * unit, with the selected one marked, or where it died if it has.
   */
  update(critters: CritterSnapshot, selected: CritterInfo | null, death: DeathRecord | null, zoom: number): void {
    const n = critters.count;
    const children = this.particles.particleChildren;
    if (children.length !== n) {
      while (this.pool.length < n) this.pool.push(new Particle({ texture: this.texture, anchorX: 0.5, anchorY: 0.5 }));
      children.length = n;
      for (let i = 0; i < n; i++) children[i] = this.pool[i]!;
      this.particles.update();
    }
    const minRadius = MIN_SCREEN_RADIUS / zoom;
    const toScale = 2 / TEXTURE_SIZE;
    for (let i = 0; i < n; i++) {
      const particle = children[i]!;
      particle.x = critters.x[i]!;
      particle.y = critters.y[i]!;
      particle.rotation = critters.heading[i]!;
      particle.scaleX = particle.scaleY = Math.max(minRadius, critters.radius[i]!) * toScale;
      particle.color = this.colors[critters.controller[i]!]!;
    }

    this.overlay.clear();
    if (selected) {
      const px = 1 / zoom;
      const ring = Math.max(minRadius, selected.radius) + 3 * px;
      this.overlay.circle(selected.x, selected.y, ring).stroke({ width: 2 * px, color: SELECTION_COLOR });
      if (selected.speed > 0) {
        this.overlay
          .moveTo(selected.x, selected.y)
          .lineTo(selected.x + selected.vx * VELOCITY_SECONDS, selected.y + selected.vy * VELOCITY_SECONDS)
          .stroke({ width: 1.5 * px, color: VELOCITY_COLOR });
      }
    } else if (death) {
      const px = 1 / zoom;
      this.overlay.circle(death.x, death.y, DEATH_RING_PIXELS * px).stroke({ width: 2 * px, color: SELECTION_COLOR, alpha: 0.6 });
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.texture.destroy(true);
  }
}

/** A white disc with a darker rim and a dark line from the center to the front edge, facing +x. */
function critterTexture(): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = TEXTURE_SIZE;
  const g = canvas.getContext("2d")!;
  const c = TEXTURE_SIZE / 2;
  g.fillStyle = "rgb(90,90,90)";
  g.beginPath();
  g.arc(c, c, c - 0.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#fff";
  g.beginPath();
  g.arc(c, c, c - 5, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgb(30,30,30)";
  g.lineWidth = 7;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(c, c);
  g.lineTo(TEXTURE_SIZE - 4, c);
  g.stroke();
  return Texture.from(canvas);
}
