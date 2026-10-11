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
