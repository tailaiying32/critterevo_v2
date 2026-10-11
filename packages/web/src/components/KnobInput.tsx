import { normalizeKnobValue, type KnobSpec } from "@critter-evo/core";
import { useState } from "react";

interface KnobInputProps {
  spec: KnobSpec;
  value: number | boolean;
  onChange: (value: number | boolean) => void;
  /** Hide the description line; it stays available as a tooltip. */
  compact?: boolean;
}

/** One generated control for a knob, chosen from the knob's spec. */
export function KnobInput({ spec, value, onChange, compact = false }: KnobInputProps) {
  const isDefault = value === spec.default;
  const live = spec.applies === "live" && (
    <span className="knob-live" title="Applies at once to the running world">
      live
    </span>
  );

  return (
    <div className="knob" title={spec.description}>
      <div className="knob-header">
        {spec.kind === "boolean" ? (
          <label className="knob-label knob-check">
            <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
            {spec.label}
            {live}
          </label>
        ) : (
          <span className="knob-label">
            {spec.label}
            {live}
          </span>
        )}
        {!isDefault && (
          <button className="knob-reset" onClick={() => onChange(spec.default)} title="Reset to default">
            reset
          </button>
        )}
      </div>
      {spec.kind === "number" && <NumberControl spec={spec} value={Number(value)} onChange={onChange} />}
      {!compact && <p className="knob-description">{spec.description}</p>}
    </div>
  );
}

function NumberControl({
  spec,
  value,
  onChange,
}: {
  spec: Extract<KnobSpec, { kind: "number" }>;
  value: number;
  onChange: (value: number) => void;
}) {
  // The text field keeps its own draft so partial input like "0." isn't clamped mid-typing.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? formatNumber(value, spec.step);

  const commit = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    onChange(Number(normalizeKnobValue(spec, Number.isFinite(parsed) ? parsed : value)));
    setDraft(null);
  };

  return (
    <div className="knob-number">
      {(spec.control ?? "slider") === "slider" && (
        <input
          type="range"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={value}
          onChange={(e) => onChange(Number(normalizeKnobValue(spec, Number(e.target.value))))}
        />
      )}
      <div className="knob-field">
        <input
          type="text"
          inputMode="decimal"
          value={shown}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setDraft(null);
          }}
        />
        {spec.unit && <span className="knob-unit">{spec.unit}</span>}
      </div>
    </div>
  );
}

function formatNumber(value: number, step: number): string {
  if (Number.isInteger(step)) return String(Math.round(value));
  const decimals = Math.min(6, Math.max(0, Math.ceil(-Math.log10(step))));
  return value.toFixed(decimals);
}
