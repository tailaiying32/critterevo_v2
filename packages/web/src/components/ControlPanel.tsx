import { useState, useSyncExternalStore } from "react";
import type { Speed } from "../sim/protocol";
import type { SimClient } from "../sim/SimClient";

const SPEEDS: { label: string; value: Speed }[] = [
  { label: "1 tick/s", value: 1 },
  { label: "10 tick/s", value: 10 },
  { label: "30 tick/s", value: 30 },
  { label: "120 tick/s", value: 120 },
  { label: "600 tick/s", value: 600 },
  { label: "Max", value: "max" },
];

export function SimulationControls({ client }: { client: SimClient }) {
  const status = useSyncExternalStore(client.subscribe, client.getStatus);
  const [speed, setSpeed] = useState<Speed>(30);

  return (
    <section>
      <h2>Simulation</h2>
      <div className="row">
        {status.running ? (
          <button onClick={() => client.pause()}>Pause</button>
        ) : (
          <button onClick={() => client.play()}>Play</button>
        )}
        <button onClick={() => client.step(1)} disabled={status.running}>
          Step
        </button>
      </div>
      <label>
        Speed
        <select
          value={String(speed)}
          onChange={(e) => {
            const value: Speed = e.target.value === "max" ? "max" : Number(e.target.value);
            setSpeed(value);
            client.setSpeed(value);
          }}
        >
          {SPEEDS.map((s) => (
            <option key={String(s.value)} value={String(s.value)}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}

export function StatusPanel({ client }: { client: SimClient }) {
  const status = useSyncExternalStore(client.subscribe, client.getStatus);
  const snapshot = status.snapshot;

  return (
    <section>
      <h2>Status</h2>
      <dl>
        <dt>Seed</dt>
        <dd>{status.activeConfig?.seed ?? "–"}</dd>
        <dt>Tick</dt>
        <dd>{snapshot?.tick.toLocaleString() ?? "–"}</dd>
        <dt>Sim time</dt>
        <dd>{snapshot ? `${snapshot.time.toFixed(1)} s` : "–"}</dd>
        <dt>Measured speed</dt>
        <dd>{`${Math.round(status.measuredTps).toLocaleString()} tick/s`}</dd>
        <dt title="Fingerprint of the full world state. Same seed and settings give the same hash at the same tick.">
          State hash
        </dt>
        <dd className="mono">{status.stateHash || "–"}</dd>
      </dl>
    </section>
  );
}
