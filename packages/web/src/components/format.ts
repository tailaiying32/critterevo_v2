const COMPASS_POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** Compass bearing of a direction on the map, x east and y south, in degrees clockwise from north. */
export function bearing(x: number, y: number): number {
  const degrees = (Math.atan2(x, -y) * 180) / Math.PI;
  return (degrees + 360) % 360;
}

/** The nearest of the eight compass points to a direction on the map, x east and y south. */
export function compass(x: number, y: number): string {
  return COMPASS_POINTS[Math.round(bearing(x, y) / 45) % 8]!;
}

/** A span of sim time: seconds, then minutes, then hours. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "never";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

/** A rate such as energy per second, with more digits when it is small. */
export function formatRate(value: number): string {
  const v = Math.abs(value);
  return v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
}
