import { Application, Container, Graphics } from "pixi.js";
import { useEffect, useRef } from "react";
import { Camera } from "../render/Camera";
import type { SimClient } from "../sim/SimClient";

const BACKGROUND = 0x0e1013;
const WORLD_FILL = 0x1d2a1f;
const WORLD_BORDER = 0x5a6b5c;
/** Zoom change per pixel of wheel scroll. */
const WHEEL_ZOOM_SPEED = 0.0015;

/**
 * PixiJS view of the world with pan (drag) and zoom (scroll wheel, toward the cursor).
 * Owns its own render loop and reads the latest snapshot straight from the SimClient,
 * so React never re-renders per frame.
 */
export function WorldCanvas({ client }: { client: SimClient }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<() => void>(() => {});

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const app = new Application();
    const camera = new Camera();
    let initialized = false;
    let cancelled = false;
    let removeListeners = () => {};

    void app.init({ resizeTo: host, background: BACKGROUND, antialias: true }).then(() => {
      initialized = true;
      // React StrictMode mounts effects twice in development. Clean up a stale init.
      if (cancelled) {
        app.destroy(true, { children: true });
        return;
      }
      const canvas = app.canvas;
      host.appendChild(canvas);

      const worldLayer = new Container();
      const worldRect = new Graphics();
      worldLayer.addChild(worldRect);
      app.stage.addChild(worldLayer);

      let fittedWorldId = -1;
      let hover: { x: number; y: number } | null = null;

      // Fit uses the active config, not the snapshot: the "world" message arrives
      // before the new world's first frame, so the snapshot can still be the old world.
      const fit = () => {
        const config = client.getStatus().activeConfig;
        if (!config) return;
        camera.setViewport(app.screen.width, app.screen.height);
        camera.fit(config.width, config.height);
      };
      fitRef.current = fit;

      const updateReadout = () => {
        const readout = readoutRef.current;
        const snapshot = client.getStatus().snapshot;
        if (!readout) return;
        if (!hover || !snapshot) {
          readout.textContent = "";
          return;
        }
        const world = camera.screenToWorld(hover.x, hover.y);
        const inside = world.x >= 0 && world.y >= 0 && world.x <= snapshot.width && world.y <= snapshot.height;
        readout.textContent = inside
          ? `x ${world.x.toFixed(1)}   y ${world.y.toFixed(1)}`
          : "outside world";
      };

      // --- Input: drag to pan, wheel to zoom, F to fit ---
      let drag: { id: number; x: number; y: number } | null = null;

      const localPoint = (e: { clientX: number; clientY: number }) => {
        const rect = canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
      };

      const onPointerDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        drag = { id: e.pointerId, ...localPoint(e) };
        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = "grabbing";
      };
      const onPointerMove = (e: PointerEvent) => {
        const p = localPoint(e);
        hover = p;
        if (drag && drag.id === e.pointerId) {
          camera.panBy(p.x - drag.x, p.y - drag.y);
          drag = { id: drag.id, ...p };
        }
        updateReadout();
      };
      const endDrag = (e: PointerEvent) => {
        if (drag && drag.id === e.pointerId) {
          drag = null;
          canvas.style.cursor = "grab";
        }
      };
      const onPointerLeave = () => {
        hover = null;
        updateReadout();
      };
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const p = localPoint(e);
        camera.zoomAt(p.x, p.y, Math.exp(-e.deltaY * WHEEL_ZOOM_SPEED));
        updateReadout();
      };
      const onKeyDown = (e: KeyboardEvent) => {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) return;
        if (e.key === "f" || e.key === "F") fit();
      };

      canvas.style.cursor = "grab";
      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerup", endDrag);
      canvas.addEventListener("pointercancel", endDrag);
      canvas.addEventListener("pointerleave", onPointerLeave);
      canvas.addEventListener("wheel", onWheel, { passive: false });
      window.addEventListener("keydown", onKeyDown);
      removeListeners = () => {
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", endDrag);
        canvas.removeEventListener("pointercancel", endDrag);
        canvas.removeEventListener("pointerleave", onPointerLeave);
        canvas.removeEventListener("wheel", onWheel);
        window.removeEventListener("keydown", onKeyDown);
      };

      // --- Render loop ---
      app.ticker.add(() => {
        const { snapshot, worldId } = client.getStatus();
        if (!snapshot) return;

        camera.setViewport(app.screen.width, app.screen.height);
        if (worldId !== fittedWorldId) {
          fit();
          fittedWorldId = worldId;
        }
        camera.clampTo(snapshot.width, snapshot.height);

        worldLayer.scale.set(camera.zoom);
        worldLayer.position.set(
          app.screen.width / 2 - camera.x * camera.zoom,
          app.screen.height / 2 - camera.y * camera.zoom,
        );

        // Border width is in screen pixels, so it stays crisp at any zoom.
        worldRect
          .clear()
          .rect(0, 0, snapshot.width, snapshot.height)
          .fill(WORLD_FILL)
          .stroke({ width: 2 / camera.zoom, color: WORLD_BORDER });
      });
    });

    return () => {
      cancelled = true;
      fitRef.current = () => {};
      removeListeners();
      if (initialized) app.destroy(true, { children: true });
    };
  }, [client]);

  return (
    <div className="world-view">
      <div ref={hostRef} className="world-canvas" />
      <div className="canvas-toolbar">
        <button onClick={() => fitRef.current()} title="Fit world to view (F)">
          Fit world
        </button>
      </div>
      <div ref={readoutRef} className="canvas-readout" />
    </div>
  );
}
