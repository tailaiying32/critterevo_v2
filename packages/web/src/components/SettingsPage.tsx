import { KNOB_GROUPS, knobEntries, makeConfig, type KnobKey, type WorldConfig } from "@critter-evo/core";
import { useRef, useState } from "react";
import { downloadConfig, randomSeed, readConfigFile } from "./configFile";
import { KnobInput } from "./KnobInput";

interface SettingsPageProps {
  draft: WorldConfig;
  pending: boolean;
  onDraftChange: (config: WorldConfig) => void;
  /** Generates a world from the config and returns to the world page. */
  onGenerate: (config: WorldConfig) => void;
}

/** Every knob, grouped and searchable. Generated entirely from the knob registry in core. */
export function SettingsPage({ draft, pending, onDraftChange, onGenerate }: SettingsPageProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<string[]>([]);

  const setKnob = (key: KnobKey, value: number | boolean) => onDraftChange(makeConfig({ ...draft, [key]: value }));
  const q = query.trim().toLowerCase();
  const matches = (label: string, description: string) =>
    q === "" || label.toLowerCase().includes(q) || description.toLowerCase().includes(q);

  const importConfig = async (file: File) => {
    try {
      const { config, warnings } = await readConfigFile(file);
      onDraftChange(config);
      setMessages(warnings.length ? warnings : [`Loaded ${file.name}. Generate a world to apply it.`]);
    } catch (err) {
      setMessages([`Could not load ${file.name}: ${err instanceof Error ? err.message : String(err)}`]);
    }
  };

  return (
    <div className="settings-page">
      <header className="settings-header">
        <div className="settings-title">
          <h1>Settings</h1>
          {pending && <span className="notice">Changes apply when you generate a new world.</span>}
        </div>
        <input
          className="search"
          type="search"
          placeholder="Search settings"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="row">
          <button className="primary" onClick={() => onGenerate(draft)}>
            Generate world
          </button>
          <button
            onClick={() => {
              const next = makeConfig({ ...draft, seed: randomSeed() });
              onDraftChange(next);
              onGenerate(next);
            }}
          >
            Random seed
          </button>
          <button onClick={() => downloadConfig(draft)}>Export config</button>
          <button onClick={() => fileRef.current?.click()}>Import config</button>
          <button onClick={() => onDraftChange(makeConfig())}>Reset all</button>
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
      </header>

      <div className="settings-grid">
        {KNOB_GROUPS.map((group) => {
          const knobs = knobEntries().filter(([, spec]) => spec.group === group && matches(spec.label, spec.description));
          if (knobs.length === 0) return null;
          const changed = knobs.filter(([key, spec]) => draft[key] !== spec.default);
          return (
            <section key={group} className="settings-card">
              <div className="card-header">
                <h2>{group}</h2>
                {changed.length > 0 && (
                  <button
                    className="knob-reset"
                    onClick={() => {
                      const reset: Partial<WorldConfig> = {};
                      for (const [key, spec] of changed) Object.assign(reset, { [key]: spec.default });
                      onDraftChange(makeConfig({ ...draft, ...reset }));
                    }}
                  >
                    reset {changed.length === 1 ? "1 change" : `${changed.length} changes`}
                  </button>
                )}
              </div>
              {knobs.map(([key, spec]) => (
                <KnobInput key={key} spec={spec} value={draft[key]} onChange={(value) => setKnob(key, value)} />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
