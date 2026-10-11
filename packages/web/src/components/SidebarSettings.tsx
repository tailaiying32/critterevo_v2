import { knobEntries, makeConfig, type KnobKey, type WorldConfig } from "@critter-evo/core";
import { randomSeed } from "./configFile";
import { KnobInput } from "./KnobInput";

interface SidebarSettingsProps {
  draft: WorldConfig;
  pending: boolean;
  onDraftChange: (config: WorldConfig) => void;
  onGenerate: (config: WorldConfig) => void;
  onOpenSettings: () => void;
}

/** The handful of featured knobs, shown beside the world. Everything else lives on the settings page. */
export function SidebarSettings({ draft, pending, onDraftChange, onGenerate, onOpenSettings }: SidebarSettingsProps) {
  const featured = knobEntries().filter(([, spec]) => spec.featured);
  const setKnob = (key: KnobKey, value: number | boolean) => onDraftChange(makeConfig({ ...draft, [key]: value }));

  return (
    <section>
      <h2>World</h2>
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
          title="Pick a random seed and generate"
        >
          Random seed
        </button>
      </div>
      {pending && <p className="notice">Settings changed. Generate a world to apply them.</p>}
      {featured.map(([key, spec]) => (
        <KnobInput key={key} spec={spec} value={draft[key]} onChange={(value) => setKnob(key, value)} compact />
      ))}
      <button className="link" onClick={onOpenSettings}>
        All settings →
      </button>
    </section>
  );
}
