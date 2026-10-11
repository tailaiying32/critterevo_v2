import {
  BIOME_NAMES,
  Biome,
  CONTROLLER_NAMES,
  COST_TERM_NAMES,
  ControllerKind,
  cellIndexAt,
  DEATH_CAUSE_NAMES,
  TERRAIN_TYPE_NAMES,
  type CritterInfo,
  type DeathRecord,
  type WorldConfig,
} from "@critter-evo/core";
import { useSyncExternalStore } from "react";
import type { SimClient } from "../sim/SimClient";
import { bearing, compass, formatDuration, formatRate } from "./format";
import { COST_TERM_COLORS, EATEN_COLOR, shownCostTerms } from "./seriesColors";

interface CritterInspectorProps {
  client: SimClient;
  follow: boolean;
  onFollowChange: (follow: boolean) => void;
}

/** Energy and water below this share of full show as low. */
const LOW_SHARE = 0.2;

/**
 * The selected critter, floating over the map: its condition, its energy
 * budget, its traits, how it is moving, the terrain under it and how much that
 * slows it, and what drives it. Once it dies, how it died.
 */
export function CritterInspector({ client, follow, onFollowChange }: CritterInspectorProps) {
  const critter = useSyncExternalStore(client.subscribe, () => client.getStatus().selected);
  const death = useSyncExternalStore(client.subscribe, () => client.getStatus().death);
  if (critter) return <InspectorBody client={client} critter={critter} follow={follow} onFollowChange={onFollowChange} />;
  if (death) return <DeathCard client={client} death={death} />;
  return null;
}

function InspectorBody({ client, critter: c, follow, onFollowChange }: CritterInspectorProps & { critter: CritterInfo }) {
  const terrain = useSyncExternalStore(client.subscribe, () => client.getStatus().terrain);
  const config = useSyncExternalStore(client.subscribe, () => client.getStatus().activeConfig);
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
        <button onClick={() => client.removeCritter(c.id)} title="Take it out of the world. It leaves no corpse.">
          Remove
        </button>
      </div>
      {c.controller === ControllerKind.Keyboard && <p className="hint">Arrow keys or WASD: up to go, left and right to turn.</p>}

      <h3>Condition</h3>
      <div className="meters">
        <Meter
          label="Energy"
          share={c.energy / c.maxEnergy}
          color={c.energy < LOW_SHARE * c.maxEnergy ? "var(--warn)" : "var(--accent)"}
          text={`${Math.round(c.energy).toLocaleString("en-US")} / ${Math.round(c.maxEnergy).toLocaleString("en-US")}`}
        />
        <Meter
          label="Water"
          share={c.water / c.maxWater}
          color={c.water < LOW_SHARE * c.maxWater ? "var(--warn)" : "var(--water)"}
          text={`${c.water.toFixed(c.maxWater < 100 ? 1 : 0)} / ${c.maxWater.toFixed(c.maxWater < 100 ? 1 : 0)}`}
        />
        <Meter label="Health" share={c.health} color="var(--muted)" text={`${Math.round(c.health * 100)}%`} />
        <Meter
          label="Age"
          share={Number.isFinite(c.maxAge) ? c.age / c.maxAge : 0}
          color="var(--muted)"
          text={Number.isFinite(c.maxAge) ? `${formatDuration(c.age)} of ${formatDuration(c.maxAge)}` : `${formatDuration(c.age)}, not aging`}
        />
      </div>

      <h3>Energy per second</h3>
      <EnergyBudget critter={c} />

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
        <dt title="Mean annual temperature of the ground under it">Temperature</dt>
        <dd>
          {Math.round(c.temperature)}°F{config ? ` · ${comfort(c.temperature, config)}` : ""}
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

/** A labeled bar showing a share of full, with the value beside it. */
function Meter({ label, share, color, text }: { label: string; share: number; color: string; text: string }) {
  const width = Math.min(1, Math.max(0, share)) * 100;
  return (
    <div className="meter">
      <span className="meter-label">{label}</span>
      <span className="meter-track" role="meter" aria-label={label} aria-valuenow={Math.round(width)} aria-valuemin={0} aria-valuemax={100}>
        <span className="meter-fill" style={{ width: `${width}%`, background: color }} />
      </span>
      <span className="meter-value">{text}</span>
    </div>
  );
}

/**
 * Last tick's energy in and out, per second, as two bars on one scale: what it
 * ate, and its costs stacked by term. Then each cost, the net, and the same for
 * water.
 */
function EnergyBudget({ critter: c }: { critter: CritterInfo }) {
  const terms = shownCostTerms(c.costs);
  const spent = c.costs.reduce((a, b) => a + b, 0);
  const scale = Math.max(c.eating, spent);
  const share = (value: number) => (scale > 0 ? `${(value / scale) * 100}%` : "0%");
  const net = c.eating - spent;
  const water = c.drinking - c.waterUse;

  return (
    <div className="budget">
      <div className="budget-row" title={`Eating ${formatRate(c.eating)} energy per second`}>
        <span className="budget-label">In</span>
        <span className="budget-track">
          {c.eating > 0 && <span className="budget-segment" style={{ flexBasis: share(c.eating), background: EATEN_COLOR }} />}
        </span>
        <span className="budget-value">+{formatRate(c.eating)}</span>
      </div>
      <div className="budget-row">
        <span className="budget-label">Out</span>
        <span className="budget-track">
          {terms.map(
            (term) =>
              c.costs[term]! > 0 && (
                <span
                  key={term}
                  className="budget-segment"
                  style={{ flexBasis: share(c.costs[term]!), background: COST_TERM_COLORS[term] }}
                  title={`${COST_TERM_NAMES[term]} ${formatRate(c.costs[term]!)} per second`}
                />
              ),
          )}
        </span>
        <span className="budget-value">−{formatRate(spent)}</span>
      </div>
      <ul className="budget-legend">
        {terms.map((term) => (
          <li key={term} className={c.costs[term]! > 0 ? "" : "zero"}>
            <span className="swatch" style={{ background: COST_TERM_COLORS[term] }} />
            {COST_TERM_NAMES[term]}
            <span className="value">{formatRate(c.costs[term]!)}</span>
          </li>
        ))}
      </ul>
      <p className="budget-net">
        Net {formatSigned(net, net !== 0 && Math.abs(net) < 10 ? 2 : 1)} · {outlook(c.energy, c.maxEnergy, net, "runs out", "full")}
      </p>
      <p className="budget-net">
        Water +{formatRate(c.drinking)} −{formatRate(c.waterUse)} · {outlook(c.water, c.maxWater, water, "runs out", "full")}
      </p>
    </div>
  );
}

/** Shown in place of the inspector once the selected critter has died. */
function DeathCard({ client, death }: { client: SimClient; death: DeathRecord }) {
  const dt = useSyncExternalStore(client.subscribe, () => client.getStatus().activeConfig?.dt ?? 0);
  return (
    <div className="inspector">
      <div className="inspector-header">
        <h2>Critter {death.id} died</h2>
        <button className="icon" onClick={() => client.deselect()} title="Close (Esc)" aria-label="Close">
          ×
        </button>
      </div>
      <dl>
        <dt>Cause</dt>
        <dd>{DEATH_CAUSE_NAMES[death.cause]}</dd>
        <dt>When</dt>
        <dd>{formatDuration(death.tick * dt)} into the run</dd>
        <dt>Age</dt>
        <dd>{formatDuration(death.age)}</dd>
        <dt>Where</dt>
        <dd>
          {death.x.toFixed(0)}, {death.y.toFixed(0)}
        </dd>
      </dl>
      <p className="hint">The ring on the map marks where it died.</p>
    </div>
  );
}

/** How a temperature sits against the comfort band. */
function comfort(temperature: number, config: WorldConfig): string {
  const low = config.comfortTemperature - config.comfortBand;
  const high = config.comfortTemperature + config.comfortBand;
  if (temperature < low) return `${Math.round(low - temperature)}° too cold`;
  if (temperature > high) return `${Math.round(temperature - high)}° too hot`;
  return "comfortable";
}

/** When a store at this level runs out or fills at this net rate per second. */
function outlook(level: number, max: number, net: number, empty: string, full: string): string {
  if (net < 0) return `${empty} in ${formatDuration(level / -net)}`;
  if (net > 0 && level < max) return `${full} in ${formatDuration((max - level) / net)}`;
  return level >= max ? full : "steady";
}

function formatSigned(value: number, digits = 2): string {
  const text = Math.abs(value).toFixed(digits);
  if (Number(text) === 0) return text;
  return `${value < 0 ? "−" : "+"}${text}`;
}

function formatShare(share: number): string {
  return `${Math.round(share * 100)}%`;
}
