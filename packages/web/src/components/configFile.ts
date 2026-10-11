import { parseConfig, serializeConfig, type ParsedConfig, type WorldConfig } from "@critter-evo/core";

/** Downloads the config as a JSON file. */
export function downloadConfig(config: WorldConfig): void {
  const blob = new Blob([serializeConfig(config)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `critter-evo-config-seed-${config.seed}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Reads and validates a config file. Throws if the file isn't a JSON object. */
export async function readConfigFile(file: File): Promise<ParsedConfig> {
  return parseConfig(JSON.parse(await file.text()));
}

/** A random 32-bit seed. The UI may use Math.random: the seed is recorded in the config, so runs stay replayable. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 4294967296);
}
