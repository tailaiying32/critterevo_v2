import { DEFAULT_CONFIG, knobEntries, makeConfig, type WorldConfig } from "@critter-evo/core";
import { useEffect, useState, useSyncExternalStore } from "react";
import { SimulationControls, StatusPanel } from "./components/ControlPanel";
import { SettingsPage } from "./components/SettingsPage";
import { SidebarSettings } from "./components/SidebarSettings";
import { StatsPanel } from "./components/StatsPanel";
import { WorldCanvas } from "./components/WorldCanvas";
import { SimClient } from "./sim/SimClient";

type Page = "world" | "settings";

export function App() {
  const [client, setClient] = useState<SimClient | null>(null);

  // Create the worker in an effect so React StrictMode's double mount doesn't leak one.
  useEffect(() => {
    const c = new SimClient();
    c.init(makeConfig(DEFAULT_CONFIG));
    setClient(c);
    return () => c.dispose();
  }, []);

  if (!client) return null;
  return <Shell client={client} />;
}

function Shell({ client }: { client: SimClient }) {
  const [page, goTo] = useHashPage();
  const [draft, setDraft] = useState<WorldConfig>(() => makeConfig(DEFAULT_CONFIG));
  const status = useSyncExternalStore(client.subscribe, client.getStatus);
  const active = status.activeConfig;
  // Live knobs apply to the running world as soon as they change, so only the others can be pending.
  const pending = active !== null && knobEntries().some(([key, spec]) => spec.applies === "new-world" && draft[key] !== active[key]);

  const changeDraft = (next: WorldConfig) => {
    setDraft(next);
    if (!active) return;
    const live: Partial<WorldConfig> = {};
    for (const [key, spec] of knobEntries()) {
      if (spec.applies === "live" && next[key] !== active[key]) Object.assign(live, { [key]: next[key] });
    }
    if (Object.keys(live).length > 0) client.updateConfig(live);
  };

  const generate = (config: WorldConfig) => {
    client.init(config);
    goTo("world");
  };

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">CritterEvo</span>
        <nav className="tabs">
          <button className={page === "world" ? "active" : ""} onClick={() => goTo("world")}>
            World
          </button>
          <button className={page === "settings" ? "active" : ""} onClick={() => goTo("settings")}>
            Settings{pending ? " •" : ""}
          </button>
        </nav>
      </header>

      <div className="content">
        {/* The world page stays mounted so the renderer and camera survive visits to settings. */}
        <div className="world-page">
          <div className="world-column">
            <WorldCanvas client={client} />
            <StatsPanel client={client} />
          </div>
          <aside className="panel">
            <SimulationControls client={client} />
            <SidebarSettings
              draft={draft}
              pending={pending}
              onDraftChange={changeDraft}
              onGenerate={generate}
              onOpenSettings={() => goTo("settings")}
            />
            <StatusPanel client={client} />
          </aside>
        </div>
        {page === "settings" && (
          <SettingsPage draft={draft} pending={pending} onDraftChange={changeDraft} onGenerate={generate} />
        )}
      </div>
    </div>
  );
}

/** The current page, kept in the URL hash so the browser back button works. */
function useHashPage(): [Page, (page: Page) => void] {
  const read = (): Page => (window.location.hash === "#/settings" ? "settings" : "world");
  const [page, setPage] = useState<Page>(read);
  useEffect(() => {
    const onHashChange = () => setPage(read());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  const goTo = (next: Page) => {
    if (read() !== next) window.location.hash = next === "settings" ? "#/settings" : "#/world";
    setPage(next);
  };
  return [page, goTo];
}
