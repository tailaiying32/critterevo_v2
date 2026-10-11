/**
 * Two-pass chamfer distance transform on a grid. Returns, for each cell, the
 * approximate Euclidean distance in cells to the nearest source cell, using
 * steps of 1 (orthogonal) and sqrt(2) (diagonal). Sources get 0. If there are
 * no sources, every cell is Infinity.
 *
 * Uses only addition and comparison, so results are identical on every engine.
 */
export function chamferDistance(isSource: (index: number) => boolean, cols: number, rows: number): Float64Array {
  const d = new Float64Array(cols * rows);
  for (let i = 0; i < d.length; i++) d[i] = isSource(i) ? 0 : Infinity;

  const diag = Math.SQRT2;

  // Forward pass: top-left to bottom-right, looking at already-visited neighbors.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      let v = d[i]!;
      if (v === 0) continue;
      if (c > 0) v = Math.min(v, d[i - 1]! + 1);
      if (r > 0) {
        v = Math.min(v, d[i - cols]! + 1);
        if (c > 0) v = Math.min(v, d[i - cols - 1]! + diag);
        if (c < cols - 1) v = Math.min(v, d[i - cols + 1]! + diag);
      }
      d[i] = v;
    }
  }

  // Backward pass: bottom-right to top-left.
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      const i = r * cols + c;
      let v = d[i]!;
      if (v === 0) continue;
      if (c < cols - 1) v = Math.min(v, d[i + 1]! + 1);
      if (r < rows - 1) {
        v = Math.min(v, d[i + cols]! + 1);
        if (c < cols - 1) v = Math.min(v, d[i + cols + 1]! + diag);
        if (c > 0) v = Math.min(v, d[i + cols - 1]! + diag);
      }
      d[i] = v;
    }
  }

  return d;
}

/**
 * Like chamferDistance, but also carries a value from the nearest source, such
 * as the surface level of the nearest body of water. Ties keep the first found.
 */
export function chamferNearest(
  isSource: (index: number) => boolean,
  sourceValue: (index: number) => number,
  fallback: number,
  cols: number,
  rows: number,
): { distance: Float64Array; value: Float64Array } {
  const d = new Float64Array(cols * rows);
  const value = new Float64Array(cols * rows);
  for (let i = 0; i < d.length; i++) {
    const source = isSource(i);
    d[i] = source ? 0 : Infinity;
    value[i] = source ? sourceValue(i) : fallback;
  }
  const diag = Math.SQRT2;
  const relax = (i: number, j: number, step: number) => {
    const candidate = d[j]! + step;
    if (candidate < d[i]!) {
      d[i] = candidate;
      value[i] = value[j]!;
    }
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (d[i] === 0) continue;
      if (c > 0) relax(i, i - 1, 1);
      if (r > 0) {
        relax(i, i - cols, 1);
        if (c > 0) relax(i, i - cols - 1, diag);
        if (c < cols - 1) relax(i, i - cols + 1, diag);
      }
    }
  }
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      const i = r * cols + c;
      if (d[i] === 0) continue;
      if (c < cols - 1) relax(i, i + 1, 1);
      if (r < rows - 1) {
        relax(i, i + cols, 1);
        if (c < cols - 1) relax(i, i + cols + 1, diag);
        if (c > 0) relax(i, i + cols - 1, diag);
      }
    }
  }
  return { distance: d, value };
}
