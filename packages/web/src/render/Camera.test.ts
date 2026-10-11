import { describe, expect, it } from "vitest";
import { Camera } from "./Camera";

function makeCamera(): Camera {
  const camera = new Camera();
  camera.setViewport(800, 600);
  camera.fit(1000, 1000, 0);
  return camera;
}

describe("Camera", () => {
  it("fit centers the world and fits its larger dimension", () => {
    const camera = makeCamera();
    expect(camera.x).toBe(500);
    expect(camera.y).toBe(500);
    expect(camera.zoom).toBeCloseTo(0.6);
    const topLeft = camera.worldToScreen(0, 0);
    const bottomRight = camera.worldToScreen(1000, 1000);
    expect(topLeft.y).toBeCloseTo(0);
    expect(bottomRight.y).toBeCloseTo(600);
  });

  it("screenToWorld inverts worldToScreen", () => {
    const camera = makeCamera();
    camera.zoomAt(123, 456, 2.5);
    camera.panBy(37, -12);
    const world = camera.screenToWorld(321, 210);
    const screen = camera.worldToScreen(world.x, world.y);
    expect(screen.x).toBeCloseTo(321);
    expect(screen.y).toBeCloseTo(210);
  });

  it("zoomAt keeps the point under the cursor fixed", () => {
    const camera = makeCamera();
    const before = camera.screenToWorld(200, 150);
    camera.zoomAt(200, 150, 3);
    const after = camera.screenToWorld(200, 150);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("zoom is clamped to its limits", () => {
    const camera = makeCamera();
    camera.zoomAt(0, 0, 1e-9);
    expect(camera.zoom).toBe(camera.minZoom);
    camera.zoomAt(0, 0, 1e9);
    expect(camera.zoom).toBe(camera.maxZoom);
  });

  it("panning moves the view opposite to the drag", () => {
    const camera = makeCamera();
    camera.panBy(60, 0);
    expect(camera.x).toBeCloseTo(500 - 60 / camera.zoom);
  });
});
