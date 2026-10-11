export interface Point {
  x: number;
  y: number;
}

/**
 * 2D camera mapping world units to screen pixels. Pure math with no Pixi or DOM,
 * so it can be unit tested.
 *
 * (x, y) is the world point at the center of the viewport.
 * zoom is screen pixels per world unit.
 */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  minZoom = 0.01;
  maxZoom = 50;
  viewportWidth = 1;
  viewportHeight = 1;

  setViewport(width: number, height: number): void {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
  }

  /** Centers the world and zooms so it fits the viewport with a margin in pixels. */
  fit(worldWidth: number, worldHeight: number, margin = 16): void {
    const fitZoom = Math.min(
      (this.viewportWidth - margin * 2) / worldWidth,
      (this.viewportHeight - margin * 2) / worldHeight,
    );
    this.zoom = Math.max(1e-6, fitZoom);
    // Allow zooming out to half the fit level, and in far enough to see small entities.
    this.minZoom = this.zoom * 0.5;
    this.maxZoom = Math.max(this.zoom * 4, 40);
    this.x = worldWidth / 2;
    this.y = worldHeight / 2;
  }

  worldToScreen(wx: number, wy: number): Point {
    return {
      x: (wx - this.x) * this.zoom + this.viewportWidth / 2,
      y: (wy - this.y) * this.zoom + this.viewportHeight / 2,
    };
  }

  screenToWorld(sx: number, sy: number): Point {
    return {
      x: (sx - this.viewportWidth / 2) / this.zoom + this.x,
      y: (sy - this.viewportHeight / 2) / this.zoom + this.y,
    };
  }

  /** Moves the view by a screen-space drag. */
  panBy(dxScreen: number, dyScreen: number): void {
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
  }

  /** Zooms by a factor while keeping the world point under the screen point fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.screenToWorld(sx, sy);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }

  /** Keeps the view center inside the world so it can't be lost off-screen. */
  clampTo(worldWidth: number, worldHeight: number): void {
    this.x = Math.min(worldWidth, Math.max(0, this.x));
    this.y = Math.min(worldHeight, Math.max(0, this.y));
  }
}
