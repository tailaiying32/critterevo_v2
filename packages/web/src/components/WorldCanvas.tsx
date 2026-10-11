import {
  BIOME_NAMES,
  Biome,
  cellIndexAt,
  heightOf,
  SHADED_VIEWS,
  TERRAIN_TYPE_NAMES,
  TERRAIN_VIEW_NAMES,
  TERRAIN_VIEWS,
  type TerrainData,
  type TerrainView,
} from "@critter-evo/core";
import { Application, Container, Graphics } from "pixi.js";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Camera } from "../render/Camera";
import { TerrainLayer } from "../render/TerrainLayer";
import type { SimClient } from "../sim/SimClient";
import { TerrainLegend } from "./TerrainLegend";

const BACKGROUND = 0x0e1013;
const WORLD_BORDER = 0x9aa5a0;
/** Zoom change per pixel of wheel scroll. */
const WHEEL_ZOOM_SPEED = 0.0015;

/**
 * PixiJS view of the world with pan (drag) and zoom (scroll wheel, toward the cursor).
 * Owns its own render loop and reads the latest state straight from the SimClient,
 * so React never re-renders per frame.
 */
export function WorldCanvas({ client }: { client: SimClient }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<() => void>(() => {});
  const [view, setView] = useState<TerrainView>("biome");
  const [relief, setRelief] = useState(true);
  // The render loop reads these from a ref, so changing them doesn't restart the renderer.
  const styleRef = useRef({ view, relief });
  useEffect(() => {
    styleRef.current = { view, relief };
  }, [view, relief]);
  const shadeable = SHADED_VIEWS.includes(view);

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

      // --- Scene, all in world units: the terrain layer and the world border ---
      const worldLayer = new Container();
      const terrainContainer = new Container();
      const border = new Graphics();
      worldLayer.addChild(terrainContainer, border);
      app.stage.addChild(worldLayer);

      let terrainLayer: TerrainLayer | null = null;
      let terrainWorldId = -1;
      let terrainStyle: { view: TerrainView; relief: boolean } | null = null;

      let fittedWorldId = -1;
      let hover: { x: number; y: number } | null = null;
      // While true, the view refits whenever the canvas is resized. Cleared when the user pans or zooms.
      let autoFit = true;
      let lastViewport = "";

      // Fit uses the active config, not the snapshot: the "world" message arrives
      // before the new world's first frame, so the snapshot can still be the old world.
      const fit = () => {
        const config = client.getStatus().activeConfig;
        if (!config) return;
        camera.setViewport(app.screen.width, app.screen.height);
        camera.fit(config.width, config.height);
        autoFit = true;
      };
      fitRef.current = fit;

      const updateReadout = () => {
        const readout = readoutRef.current;
        if (!readout) return;
        const { activeConfig: config, terrain } = client.getStatus();
        if (!hover || !config || !terrain) {
          readout.textContent = "";
          return;
        }
        const world = camera.screenToWorld(hover.x, hover.y);
        if (world.x < 0 || world.y < 0 || world.x >= config.width || world.y >= config.height) {
          readout.textContent = "outside world";
          return;
        }
        readout.textContent = describeCell(terrain, world.x, world.y);
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
          if (p.x !== drag.x || p.y !== drag.y) autoFit = false;
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
        autoFit = false;
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
        const { activeConfig: config, terrain, worldId } = client.getStatus();
        if (!config || !terrain) return;
        // Skip frames while the canvas is hidden or collapsed, so fitting never uses a bogus size.
        if (app.screen.width < 2 || app.screen.height < 2) return;

        camera.setViewport(app.screen.width, app.screen.height);
        const viewport = `${app.screen.width}x${app.screen.height}`;
        if (worldId !== fittedWorldId || (autoFit && viewport !== lastViewport)) {
          fit();
          fittedWorldId = worldId;
        }
        lastViewport = viewport;
        camera.clampTo(config.width, config.height);

        worldLayer.scale.set(camera.zoom);
        worldLayer.position.set(
          app.screen.width / 2 - camera.x * camera.zoom,
          app.screen.height / 2 - camera.y * camera.zoom,
        );

        const style = styleRef.current;
        if (worldId !== terrainWorldId || style !== terrainStyle) {
          terrainLayer?.destroy();
          terrainLayer = new TerrainLayer(terrain, style.view, style.relief);
          terrainContainer.addChild(terrainLayer.container);
          terrainWorldId = worldId;
          terrainStyle = style;
          updateReadout();
        }
        // Border width is in screen pixels, so it stays crisp at any zoom.
        border.clear().rect(0, 0, config.width, config.height).stroke({ width: 1.5 / camera.zoom, color: WORLD_BORDER });
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
        <select value={view} onChange={(e) => setView(e.target.value as TerrainView)} title="Map view">
          {TERRAIN_VIEWS.map((v) => (
            <option key={v} value={v}>
              {TERRAIN_VIEW_NAMES[v]}
            </option>
          ))}
        </select>
        <label
          className="toggle"
          title={shadeable ? "Shade the map by slope, lit from the northwest, to show elevation" : "Not available here: shading would change the colors that show values"}
        >
          <input type="checkbox" checked={relief && shadeable} disabled={!shadeable} onChange={(e) => setRelief(e.target.checked)} />
          Relief
        </label>
      </div>
      <div ref={readoutRef} className="canvas-readout" />
      <TerrainLegend client={client} view={view} />
      <GeneratingOverlay client={client} />
    </div>
  );
}

function GeneratingOverlay({ client }: { client: SimClient }) {
  const { generating } = useSyncExternalStore(client.subscribe, client.getStatus);
  return generating ? <div className="generating">Generating world…</div> : null;
}

function describeCell(terrain: TerrainData, x: number, y: number): string {
  const i = cellIndexAt(terrain, x, y);
  const elevation = terrain.elevation[i]!;
  const feet = Math.round(heightOf(terrain, elevation)).toLocaleString("en-US");
  return [
    `x ${x.toFixed(1)}  y ${y.toFixed(1)}  ·  cell ${i % terrain.cols}, ${Math.floor(i / terrain.cols)}`,
    `${TERRAIN_TYPE_NAMES[terrain.terrainType[i]!]}${terrain.biome[i] === Biome.None ? "" : `  ·  ${BIOME_NAMES[terrain.biome[i]!]}`}  ·  elevation ${elevation.toFixed(3)}  ·  ${feet} ft`,
    `${terrain.temperature[i]!.toFixed(1)}°F  ·  ${Math.round(terrain.rainfall[i]!)} in rain  ·  ${describeDistance(terrain.distanceToWater[i]!)}`,
  ].join("\n");
}

function describeDistance(distance: number): string {
  if (distance === 0) return "water";
  return Number.isFinite(distance) ? `${Math.round(distance)} u to water` : "no water";
}
