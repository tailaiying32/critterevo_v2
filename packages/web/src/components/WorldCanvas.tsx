import {
  BIOME_NAMES,
  Biome,
  bodyFits,
  CONTROLLER_NAMES,
  ControllerKind,
  cellIndexAt,
  DEFAULT_CONFIG,
  depthShare,
  heightOf,
  KNOBS,
  radiusOf,
  SHADED_VIEWS,
  TERRAIN_TYPE_NAMES,
  TERRAIN_VIEW_NAMES,
  TERRAIN_VIEWS,
  TerrainType,
  type CritterTraits,
  type Snapshot,
  type TerrainData,
  type TerrainView,
  type WorldConfig,
} from "@critter-evo/core";
import { Application, Container, Graphics } from "pixi.js";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Camera } from "../render/Camera";
import { CritterLayer } from "../render/CritterLayer";
import { PlantLayer } from "../render/PlantLayer";
import { TerrainLayer } from "../render/TerrainLayer";
import type { SimClient } from "../sim/SimClient";
import { CritterInspector } from "./CritterInspector";
import { compass } from "./format";
import { TerrainLegend } from "./TerrainLegend";

const BACKGROUND = 0x0e1013;
const WORLD_BORDER = 0x9aa5a0;
/** Zoom change per pixel of wheel scroll. */
const WHEEL_ZOOM_SPEED = 0.0015;
/** Map brightness while plants are shown, so they stand out on every biome. */
const DIMMED_MAP = 0.55;
const BRUSH_COLORS = { graze: 0xff8a6a, sow: 0xb6f05c, spawn: 0x60d6ff, blocked: 0xff5a5a } as const;
/** A click that moves less than this many pixels selects rather than pans. */
const CLICK_SLOP = 4;
/** How far outside a critter's body, in pixels, a click still selects it. */
const PICK_TOLERANCE = 6;

/** What a left drag on the map does. Brushes and the spawn tool are debug tools that change the world directly. */
type Tool = "pan" | "graze" | "sow" | "spawn";

const TOOLS: { tool: Tool; label: string; title: string }[] = [
  { tool: "pan", label: "Pan", title: "Drag to pan. Scroll to zoom. Click a critter to select it." },
  { tool: "graze", label: "Graze", title: "Drag to graze plants down, standing in for herbivores. Right-drag pans." },
  { tool: "sow", label: "Plant", title: "Click or drag to plant fully grown plants. Right-drag pans." },
  { tool: "spawn", label: "Spawn", title: "Click to place a critter with the traits below and select it. Right-drag pans." },
];

interface BrushSettings {
  tool: Tool;
  radius: number;
  /** Graze brush: share of full energy left in each plant, 0 to 1. */
  leave: number;
}

/** Spawn tool: the critter it places. */
interface SpawnSettings extends CritterTraits {
  controller: ControllerKind;
}

/** Keys that drive the selected critter, by KeyboardEvent.code. */
const DRIVE_KEYS: Record<string, "left" | "right" | "forward" | "brake"> = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ArrowUp: "forward",
  KeyW: "forward",
  ArrowDown: "brake",
  KeyS: "brake",
};

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
  const [showPlants, setShowPlants] = useState(true);
  const [brush, setBrush] = useState<BrushSettings>({ tool: "pan", radius: 60, leave: 0 });
  const [spawn, setSpawn] = useState<SpawnSettings>({
    size: DEFAULT_CONFIG.critterSize,
    maxSpeed: DEFAULT_CONFIG.critterMaxSpeed,
    turnRate: DEFAULT_CONFIG.critterTurnRate,
    controller: ControllerKind.Wander,
  });
  // While on, the view stays centered on the selected critter. Panning turns it off.
  const [follow, setFollow] = useState(false);
  // The render loop reads these from refs, so changing them doesn't restart the renderer.
  const styleRef = useRef({ view, relief });
  const plantsRef = useRef(showPlants);
  const brushRef = useRef(brush);
  const spawnRef = useRef(spawn);
  const followRef = useRef(follow);
  useEffect(() => {
    styleRef.current = { view, relief };
    plantsRef.current = showPlants;
    brushRef.current = brush;
    spawnRef.current = spawn;
    followRef.current = follow;
  }, [view, relief, showPlants, brush, spawn, follow]);
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

      // --- Scene, all in world units: terrain, plants, critters, the brush outline, and the world border ---
      const worldLayer = new Container();
      const terrainContainer = new Container();
      const plantLayer = new PlantLayer();
      const critterLayer = new CritterLayer();
      const brushOutline = new Graphics();
      const border = new Graphics();
      worldLayer.addChild(terrainContainer, plantLayer.container, critterLayer.container, brushOutline, border);
      app.stage.addChild(worldLayer);

      let terrainLayer: TerrainLayer | null = null;
      let terrainWorldId = -1;
      let terrainStyle: { view: TerrainView; relief: boolean } | null = null;
      let drawnSnapshot: Snapshot | null = null;
      let drawnZoom = 0;
      let drawnCritters: Snapshot | null = null;
      let drawnCritterZoom = 0;

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
        readout.textContent = describeCell(terrain, config, world.x, world.y);
      };

      // --- Input: drag to pan or brush, click to select or spawn, wheel to zoom, F to fit, keys to drive ---
      let drag: { id: number; x: number; y: number } | null = null;
      // World point of the last brush stroke while a brush is held down.
      let stroke: { id: number; x: number; y: number } | null = null;
      // Where a left press with the pan tool started, until it moves too far to be a click.
      let click: { id: number; x: number; y: number } | null = null;

      const localPoint = (e: { clientX: number; clientY: number }) => {
        const rect = canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
      };

      const paint = (x: number, y: number) => {
        const { tool, radius, leave } = brushRef.current;
        if (tool === "graze") client.brush({ kind: "graze", x, y, radius, leave });
        else if (tool === "sow") client.brush({ kind: "sow", x, y, radius });
      };
      // Paints along the segment from the last stroke, so a fast drag leaves no gaps.
      const paintTo = (x: number, y: number) => {
        if (!stroke) return;
        const spacing = Math.max(1, brushRef.current.radius / 2);
        const steps = Math.ceil(Math.hypot(x - stroke.x, y - stroke.y) / spacing);
        for (let k = 1; k <= steps; k++) paint(stroke.x + ((x - stroke.x) * k) / steps, stroke.y + ((y - stroke.y) * k) / steps);
        stroke = { id: stroke.id, x, y };
      };

      const onPointerDown = (e: PointerEvent) => {
        const p = localPoint(e);
        const tool = brushRef.current.tool;
        if (e.button === 0 && tool === "spawn") {
          const world = camera.screenToWorld(p.x, p.y);
          const { controller, ...traits } = spawnRef.current;
          client.spawn(world.x, world.y, traits, controller);
          return;
        }
        const brushing = e.button === 0 && tool !== "pan";
        if (brushing) {
          const world = camera.screenToWorld(p.x, p.y);
          stroke = { id: e.pointerId, ...world };
          paint(world.x, world.y);
        } else if (e.button <= 2) {
          drag = { id: e.pointerId, ...p };
          if (e.button === 0) click = { id: e.pointerId, ...p };
          canvas.style.cursor = "grabbing";
        } else return;
        canvas.setPointerCapture(e.pointerId);
      };
      const onPointerMove = (e: PointerEvent) => {
        const p = localPoint(e);
        hover = p;
        if (click && click.id === e.pointerId && Math.hypot(p.x - click.x, p.y - click.y) > CLICK_SLOP) click = null;
        if (drag && drag.id === e.pointerId && !(click && click.id === e.pointerId)) {
          if (p.x !== drag.x || p.y !== drag.y) {
            autoFit = false;
            setFollow(false);
          }
          camera.panBy(p.x - drag.x, p.y - drag.y);
          drag = { id: drag.id, ...p };
        }
        if (stroke && stroke.id === e.pointerId) {
          const world = camera.screenToWorld(p.x, p.y);
          paintTo(world.x, world.y);
        }
        updateReadout();
      };
      const endDrag = (e: PointerEvent) => {
        if (click && click.id === e.pointerId && e.type === "pointerup") {
          const world = camera.screenToWorld(click.x, click.y);
          client.pick(world.x, world.y, PICK_TOLERANCE / camera.zoom);
        }
        if (click && click.id === e.pointerId) click = null;
        if (drag && drag.id === e.pointerId) drag = null;
        if (stroke && stroke.id === e.pointerId) stroke = null;
        canvas.style.cursor = "";
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
      // Keyboard controller: the drive keys held, sent to the worker whenever they change.
      const held = new Set<string>();
      let sent = { turn: 0, thrust: 0 };
      const sendDrive = () => {
        const turn = (held.has("right") ? 1 : 0) - (held.has("left") ? 1 : 0);
        const thrust = held.has("forward") && !held.has("brake") ? 1 : 0;
        if (turn === sent.turn && thrust === sent.thrust) return;
        sent = { turn, thrust };
        client.drive(turn, thrust);
      };
      const onKeyDown = (e: KeyboardEvent) => {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const drive = DRIVE_KEYS[e.code];
        if (drive && client.getStatus().selected) {
          e.preventDefault();
          held.add(drive);
          sendDrive();
          return;
        }
        if (e.key === "Escape") {
          client.deselect();
          setFollow(false);
        }
        if (e.key === "f" || e.key === "F") fit();
      };
      const onKeyUp = (e: KeyboardEvent) => {
        const drive = DRIVE_KEYS[e.code];
        if (!drive) return;
        held.delete(drive);
        sendDrive();
      };
      // Keys released while the window is in the background never send keyup.
      const onBlur = () => {
        held.clear();
        sendDrive();
      };
      // Right-drag pans, so the browser menu would only get in the way.
      const onContextMenu = (e: Event) => e.preventDefault();

      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerup", endDrag);
      canvas.addEventListener("pointercancel", endDrag);
      canvas.addEventListener("pointerleave", onPointerLeave);
      canvas.addEventListener("wheel", onWheel, { passive: false });
      canvas.addEventListener("contextmenu", onContextMenu);
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      window.addEventListener("blur", onBlur);
      removeListeners = () => {
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", endDrag);
        canvas.removeEventListener("pointercancel", endDrag);
        canvas.removeEventListener("pointerleave", onPointerLeave);
        canvas.removeEventListener("wheel", onWheel);
        canvas.removeEventListener("contextmenu", onContextMenu);
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        window.removeEventListener("blur", onBlur);
      };

      // --- Render loop ---
      app.ticker.add(() => {
        const { activeConfig: config, terrain, worldId, snapshot, selected } = client.getStatus();
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
        if (followRef.current && selected) {
          camera.x = selected.x;
          camera.y = selected.y;
        }
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

        const plantsShown = plantsRef.current;
        plantLayer.container.visible = plantsShown;
        terrainContainer.alpha = plantsShown ? DIMMED_MAP : 1;
        // The snapshot can still be the previous world's until the new world's first frame arrives.
        if (plantsShown && snapshot && snapshot.width === config.width && snapshot.height === config.height) {
          if (snapshot !== drawnSnapshot || camera.zoom !== drawnZoom) {
            plantLayer.update(snapshot.plants, camera.zoom);
            drawnSnapshot = snapshot;
            drawnZoom = camera.zoom;
          }
        }

        // Critters are drawn even while plants are hidden.
        if (snapshot && snapshot.width === config.width && snapshot.height === config.height) {
          if (snapshot !== drawnCritters || camera.zoom !== drawnCritterZoom) {
            critterLayer.update(snapshot.critters, selected, camera.zoom);
            drawnCritters = snapshot;
            drawnCritterZoom = camera.zoom;
          }
        }

        const { tool, radius } = brushRef.current;
        brushOutline.clear();
        if (tool !== "pan" && hover) {
          const at = camera.screenToWorld(hover.x, hover.y);
          if (tool === "spawn") {
            // The body it would place, red where it wouldn't fit.
            const r = radiusOf(spawnRef.current.size);
            const color = bodyFits(terrain, at.x, at.y, r) ? BRUSH_COLORS.spawn : BRUSH_COLORS.blocked;
            brushOutline.circle(at.x, at.y, r).stroke({ width: 1.5 / camera.zoom, color });
          } else {
            brushOutline.circle(at.x, at.y, radius).stroke({ width: 1.5 / camera.zoom, color: BRUSH_COLORS[tool] });
          }
        }
        canvas.style.cursor = drag ? "grabbing" : tool === "pan" ? "grab" : "crosshair";
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
      <div className="canvas-controls">
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
          <label className="toggle" title="Show plants, sized and colored by energy. The map is dimmed so they stand out.">
            <input type="checkbox" checked={showPlants} onChange={(e) => setShowPlants(e.target.checked)} />
            Plants
          </label>
        </div>
        <div className="canvas-toolbar">
          <div className="segmented" role="radiogroup" aria-label="Tool">
            {TOOLS.map(({ tool, label, title }) => (
              <button
                key={tool}
                role="radio"
                aria-checked={brush.tool === tool}
                className={brush.tool === tool ? "active" : ""}
                title={title}
                onClick={() => setBrush({ ...brush, tool })}
              >
                {label}
              </button>
            ))}
          </div>
          {(brush.tool === "graze" || brush.tool === "sow") && (
            <label className="brush-control" title="Brush radius in world units">
              Radius
              <input
                type="range"
                min={5}
                max={300}
                step={5}
                value={brush.radius}
                onChange={(e) => setBrush({ ...brush, radius: Number(e.target.value) })}
              />
              <span className="value">{brush.radius} u</span>
            </label>
          )}
          {brush.tool === "graze" && (
            <label className="brush-control" title="Plants are grazed down to this share of full energy. Below the root reserve, they die.">
              Graze to
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(brush.leave * 100)}
                onChange={(e) => setBrush({ ...brush, leave: Number(e.target.value) / 100 })}
              />
              <span className="value">{Math.round(brush.leave * 100)}%</span>
            </label>
          )}
        </div>
        {brush.tool === "spawn" && <SpawnControls spawn={spawn} onChange={setSpawn} />}
      </div>
      <div ref={readoutRef} className="canvas-readout" />
      <CritterInspector client={client} follow={follow} onFollowChange={setFollow} />
      <TerrainLegend client={client} view={view} />
      <GeneratingOverlay client={client} />
    </div>
  );
}

/** Spawn tool settings: the traits and controller of the critter it places. */
function SpawnControls({ spawn, onChange }: { spawn: SpawnSettings; onChange: (spawn: SpawnSettings) => void }) {
  const slider = (trait: keyof CritterTraits, knob: "critterSize" | "critterMaxSpeed" | "critterTurnRate", label: string, format: (v: number) => string) => {
    const spec = KNOBS[knob];
    return (
      <label className="brush-control" title={spec.description}>
        {label}
        <input
          type="range"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={spawn[trait]}
          onChange={(e) => onChange({ ...spawn, [trait]: Number(e.target.value) })}
        />
        <span className="value">{format(spawn[trait])}</span>
      </label>
    );
  };
  return (
    <div className="canvas-toolbar">
      {slider("size", "critterSize", "Size", (v) => v.toFixed(2))}
      {slider("maxSpeed", "critterMaxSpeed", "Speed", (v) => `${v} u/s`)}
      {slider("turnRate", "critterTurnRate", "Turn", (v) => `${v}°/s`)}
      <select
        value={spawn.controller}
        onChange={(e) => onChange({ ...spawn, controller: Number(e.target.value) as ControllerKind })}
        title="What drives the new critter"
      >
        {CONTROLLER_NAMES.map((name, kind) => (
          <option key={name} value={kind}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}

function GeneratingOverlay({ client }: { client: SimClient }) {
  const { generating } = useSyncExternalStore(client.subscribe, client.getStatus);
  return generating ? <div className="generating">Generating world…</div> : null;
}

function describeCell(terrain: TerrainData, config: WorldConfig, x: number, y: number): string {
  const i = cellIndexAt(terrain, x, y);
  const elevation = terrain.elevation[i]!;
  const feet = Math.round(heightOf(terrain, elevation)).toLocaleString("en-US");
  return [
    `x ${x.toFixed(1)}  y ${y.toFixed(1)}  ·  cell ${i % terrain.cols}, ${Math.floor(i / terrain.cols)}`,
    `${TERRAIN_TYPE_NAMES[terrain.terrainType[i]!]}${terrain.biome[i] === Biome.None ? "" : `  ·  ${BIOME_NAMES[terrain.biome[i]!]}`}  ·  elevation ${elevation.toFixed(3)}  ·  ${feet} ft`,
    `${terrain.temperature[i]!.toFixed(1)}°F  ·  ${Math.round(terrain.rainfall[i]!)} in rain  ·  ${describeDistance(terrain.distanceToWater[i]!)}`,
    describeFooting(terrain, config, i),
  ].join("\n");
}

/** What the cell is like to move through: water depth, or the grade and which way it rises. */
function describeFooting(terrain: TerrainData, config: WorldConfig, i: number): string {
  const type = terrain.terrainType[i];
  if (type === TerrainType.DeepWater) return "too deep to wade";
  if (type === TerrainType.ShallowWater) return `depth ${Math.round(depthShare(terrain, i) * 100)}% of the way to deep water`;
  const sx = terrain.slopeX[i]!;
  const sy = terrain.slopeY[i]!;
  const grade = Math.hypot(sx, sy) / config.mapScale;
  if (grade < 0.005) return "flat";
  return `grade ${(grade * 100).toFixed(grade < 0.1 ? 1 : 0)}%, rising to the ${compass(sx, sy)}`;
}

function describeDistance(distance: number): string {
  if (distance === 0) return "water";
  return Number.isFinite(distance) ? `${Math.round(distance)} u to water` : "no water";
}
