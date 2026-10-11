import { viewPixels, type TerrainData, type TerrainView } from "@critter-evo/core";
import { BufferImageSource, Container, Graphics, Sprite, Texture } from "pixi.js";

/**
 * Draws one view of the terrain grid: baked to a texture, one pixel per cell, and
 * scaled up with nearest-neighbor sampling so each cell is one flat color
 * (docs/DESIGN.md §14.1). Masked to the world, since the last row and column of
 * cells can extend past its edge. Rebuilt when the world, the view, or relief
 * shading changes.
 */
export class TerrainLayer {
  readonly container = new Container();
  private readonly texture: Texture;

  constructor(terrain: TerrainData, view: TerrainView, relief: boolean) {
    const source = new BufferImageSource({
      resource: new Uint8Array(viewPixels(terrain, view, { relief }).buffer),
      width: terrain.cols,
      height: terrain.rows,
      format: "rgba8unorm",
      scaleMode: "nearest",
      autoGenerateMipmaps: false,
    });
    this.texture = new Texture({ source });

    const sprite = new Sprite(this.texture);
    sprite.scale.set(terrain.cellSize);
    const mask = new Graphics().rect(0, 0, terrain.width, terrain.height).fill(0xffffff);
    this.container.addChild(sprite, mask);
    this.container.mask = mask;
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.texture.destroy(true);
  }
}
