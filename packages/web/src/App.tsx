import { DEFAULT_CONFIG, makeConfig, type WorldConfig } from "@critter-evo/core";
import { useEffect, useState, useSyncExternalStore } from "react";
import { SimulationControls, StatusPanel } from "./components/ControlPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { WorldCanvas } from "./components/WorldCanvas";
import { SimClient } from "./sim/SimClient";

export function App() {
  const [client, setClient] = useState<SimClient | null>(null);
  const [draft, setDraft] = useState<WorldConfig>(() => makeConfig(DEFAULT_CONFIG));

  // Create the worker in an effect so React StrictMode's double mount doesn't leak one.
  useEffect(() => {
    const c = new SimClient();
    c.init(makeConfig(DEFAULT_CONFIG));
    setClient(c);
    return () => c.dispose();
  }, []);

  if (!client) return null;

  return (
    <div className="app">
      <WorldCanvas client={client} />
      <aside className="panel">
        <h1>CritterEvo</h1>
        <SimulationControls client={client} />
        <StatusPanel client={client} />
        <ConnectedSettings client={client} draft={draft} onDraftChange={setDraft} />
      </aside>
    </div>
  );
}

function ConnectedSettings({
  client,
  draft,
  onDraftChange,
}: {
  client: SimClient;
  draft: WorldConfig;
  onDraftChange: (config: WorldConfig) => void;
}) {
  const status = useSyncExternalStore(client.subscribe, client.getStatus);
  return (
    <SettingsPanel
      draft={draft}
      activeConfig={status.activeConfig}
      onDraftChange={onDraftChange}
      onGenerate={(config) => client.init(config)}
    />
  );
}
