import { KNOB_GROUPS, knobEntries, makeConfig, type KnobKey, type WorldConfig } from "@critter-evo/core";
import { randomSeed } from "./configFile";
import { KnobInput } from "./KnobInput";

interface SidebarSettingsProps {
  draft: WorldConfig;
  pending: boolean;
  onDraftChange: (config: WorldConfig) => void;
  onGenerate: (config: WorldConfig) => void;
  onOpenSettings: () => void;
}

/**
 * The handful of featured knobs, shown beside the world under their group's
 * heading. World and terrain knobs share the World section with the generate
 * buttons. Everything else lives on the settings page.
 */
export function SidebarSettings({ draft, pending, onDraftChange, onGenerate, onOpenSettings }: SidebarSettingsProps) {
  const setKnob = (key: KnobKey, value: number | boolean) => onDraftChange(makeConfig({ ...draft, [key]: value }));
  const featured = (groups: readonly string[]) =>
    knobEntries()
      .filter(([, spec]) => spec.featured && groups.includes(spec.group))
      .map(([key, spec]) => <KnobInput key={key} spec={spec} value={draft[key]} onChange={(value) => setKnob(key, value)} compact />);
  const worldGroups = ["World", "Terrain", "Climate"];
  const otherGroups = KNOB_GROUPS.filter((group) => !worldGroups.includes(group) && knobEntries().some(([, s]) => s.featured && s.group === group));

  return (
    <>
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
        {featured(worldGroups)}
      </section>
      {otherGroups.map((group) => (
        <section key={group}>
          <h2>{group}</h2>
          {featured([group])}
        </section>
      ))}
      <button className="link" onClick={onOpenSettings}>
        All settings →
      </button>
    </>
  );
}
