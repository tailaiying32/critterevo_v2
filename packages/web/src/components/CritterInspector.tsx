import { BIOME_NAMES, Biome, CONTROLLER_NAMES, ControllerKind, cellIndexAt, TERRAIN_TYPE_NAMES, type CritterInfo } from "@critter-evo/core";
import { useSyncExternalStore } from "react";
import type { SimClient } from "../sim/SimClient";
import { bearing, compass } from "./format";

interface CritterInspectorProps {
  client: SimClient;
  follow: boolean;
  onFollowChange: (follow: boolean) => void;
}

/**
 * The selected critter, floating over the map: its traits, how it is moving,
 * the terrain under it and how much that slows it, and what drives it.
 */
export function CritterInspector({ client, follow, onFollowChange }: CritterInspectorProps) {
  const critter = useSyncExternalStore(client.subscribe, () => client.getStatus().selected);
  if (!critter) return null;
  return <InspectorBody client={client} critter={critter} follow={follow} onFollowChange={onFollowChange} />;
}

function InspectorBody({ client, critter: c, follow, onFollowChange }: CritterInspectorProps & { critter: CritterInfo }) {
  const terrain = useSyncExternalStore(client.subscribe, () => client.getStatus().terrain);
  const cell = terrain ? cellIndexAt(terrain, c.x, c.y) : -1;
  const biome = terrain && cell >= 0 ? (terrain.biome[cell] as Biome) : Biome.None;
  const cos = Math.cos(c.heading);
  const sin = Math.sin(c.heading);

  return (
    <div className="inspector">
      <div className="inspector-header">
        <h2>Critter {c.id}</h2>
        <button className="icon" onClick={() => client.deselect()} title="Deselect (Esc)" aria-label="Deselect">
          ×
        </button>
      </div>
      <div className="row">
        <select
          value={c.controller}
          onChange={(e) => client.setController(c.id, Number(e.target.value) as ControllerKind)}
          title="What drives this critter. The arrow keys or WASD switch it to keyboard."
        >
          {CONTROLLER_NAMES.map((name, kind) => (
            <option key={name} value={kind}>
              {name}
            </option>
          ))}
        </select>
        <label className="toggle" title="Keep the view centered on this critter. Panning turns it off.">
          <input type="checkbox" checked={follow} onChange={(e) => onFollowChange(e.target.checked)} />
          Follow
        </label>
        <button onClick={() => client.removeCritter(c.id)}>Remove</button>
      </div>
      {c.controller === ControllerKind.Keyboard && <p className="hint">Arrow keys or WASD: up to go, left and right to turn.</p>}

      <h3>Body</h3>
      <dl>
        <dt>Size</dt>
        <dd>
          {c.size.toFixed(2)} · {(c.radius * 2).toFixed(1)} u across
        </dd>
        <dt>Mass</dt>
        <dd>{c.mass.toFixed(2)}</dd>
        <dt>Max speed</dt>
        <dd>{c.maxSpeed.toFixed(1)} u/s</dd>
        <dt>Turn rate</dt>
        <dd>{Math.round(c.turnRate)}°/s</dd>
        <dt title="Falls with mass^(−1/3)">Acceleration</dt>
        <dd>{Math.round(c.acceleration)} u/s²</dd>
      </dl>

      <h3>Motion</h3>
      <dl>
        <dt>Position</dt>
        <dd>
          {c.x.toFixed(1)}, {c.y.toFixed(1)}
        </dd>
        <dt>Heading</dt>
        <dd>
          {Math.round(bearing(cos, sin))}° {compass(cos, sin)}
        </dd>
        <dt>Speed</dt>
        <dd>
          {c.speed.toFixed(1)} u/s{c.speed > 0.5 ? ` ${compass(c.vx, c.vy)}` : ""}
        </dd>
        <dt>Turn · thrust</dt>
        <dd>
          {formatSigned(c.turn)} · {c.thrust.toFixed(2)}
        </dd>
      </dl>
      {c.blocked && <p className="hint warn">Against a wall or deep water.</p>}

      <h3>Terrain</h3>
      <dl>
        <dt>Ground</dt>
        <dd>
          {terrain && cell >= 0 ? TERRAIN_TYPE_NAMES[terrain.terrainType[cell]!] : "–"}
          {biome !== Biome.None ? ` · ${BIOME_NAMES[biome]}` : ""}
        </dd>
        <dt title="Rise over run along the heading, scaled by size">Grade ahead</dt>
        <dd>{formatSigned(c.grade * 100, 1)}%</dd>
        <dt>Slope speed</dt>
        <dd>{formatShare(c.slope)}</dd>
        <dt>Wading speed</dt>
        <dd>{formatShare(c.wading)}</dd>
        <dt>Top speed here</dt>
        <dd>{(c.maxSpeed * c.slope * c.wading).toFixed(1)} u/s</dd>
      </dl>
    </div>
  );
}

function formatSigned(value: number, digits = 2): string {
  const text = Math.abs(value).toFixed(digits);
  if (Number(text) === 0) return text;
  return `${value < 0 ? "−" : "+"}${text}`;
}

function formatShare(share: number): string {
  return `${Math.round(share * 100)}%`;
}
