import {
  KNOB_GROUPS,
  knobEntries,
  makeConfig,
  parseConfig,
  serializeConfig,
  type KnobKey,
  type WorldConfig,
} from "@critter-evo/core";
import { useRef, useState } from "react";
import { KnobInput } from "./KnobInput";

interface SettingsPanelProps {
  draft: WorldConfig;
  activeConfig: WorldConfig | null;
  onDraftChange: (config: WorldConfig) => void;
  onGenerate: (config: WorldConfig) => void;
}

/** World settings, generated entirely from the knob registry in core. */
export function SettingsPanel({ draft, activeConfig, onDraftChange, onGenerate }: SettingsPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [messages, setMessages] = useState<string[]>([]);

  const pending = activeConfig !== null && knobEntries().some(([key]) => draft[key] !== activeConfig[key]);

  const setKnob = (key: KnobKey, value: number | boolean) => {
    onDraftChange(makeConfig({ ...draft, [key]: value }));
  };

  const exportConfig = () => {
    const blob = new Blob([serializeConfig(draft)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `critter-evo-config-seed-${draft.seed}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importConfig = async (file: File) => {
    try {
      const { config, warnings } = parseConfig(JSON.parse(await file.text()));
      onDraftChange(config);
      setMessages(warnings.length ? warnings : [`Loaded ${file.name}. Press Generate to apply.`]);
    } catch (err) {
      setMessages([`Could not load ${file.name}: ${err instanceof Error ? err.message : String(err)}`]);
    }
  };

  return (
    <section className="settings">
      <h2>World settings</h2>

      <div className="row">
        <button className="primary" onClick={() => onGenerate(draft)}>
          Generate world
        </button>
        <button
          onClick={() => {
            // The UI may use Math.random: the chosen seed is recorded in the config, so runs stay replayable.
            const seed = Math.floor(Math.random() * 4294967296);
            const next = makeConfig({ ...draft, seed });
            onDraftChange(next);
            onGenerate(next);
          }}
          title="Pick a random seed and generate"
        >
          Random seed
        </button>
      </div>
      {pending && <p className="notice">Settings changed. Generate a world to apply them.</p>}

      <div className="row">
        <button onClick={exportConfig}>Export config</button>
        <button onClick={() => fileRef.current?.click()}>Import config</button>
        <button onClick={() => onDraftChange(makeConfig())} title="Reset every setting to its default">
          Reset all
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importConfig(file);
            e.target.value = "";
          }}
        />
      </div>
      {messages.length > 0 && (
        <ul className="messages">
          {messages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}

      {KNOB_GROUPS.map((group) => {
        const knobs = knobEntries().filter(([, spec]) => spec.group === group);
        if (knobs.length === 0) return null;
        return (
          <details key={group} open className="knob-group">
            <summary>{group}</summary>
            {knobs.map(([key, spec]) => (
              <KnobInput key={key} spec={spec} value={draft[key]} onChange={(value) => setKnob(key, value)} />
            ))}
          </details>
        );
      })}
    </section>
  );
}
