// Hazard detection, in the spirit of NASA's ALHAT / SPLICE hazard detection and
// avoidance: scan the ground around the landing target and score each candidate
// spot on the slope across the lander's footprint, boulders under the pads, and
// small-scale roughness. Green cells are safe for this vehicle's limits.

/** Spatial index of boulders so per-cell lookups stay cheap. */
export class RockIndex {
  constructor(rocks, cell = 10) {
    this.cell = cell;
    this.map = new Map();
    for (const r of rocks) {
      const k = this.key(Math.floor(r.x / cell), Math.floor(r.y / cell));
      if (!this.map.has(k)) this.map.set(k, []);
      this.map.get(k).push(r);
    }
  }
  key(i, j) { return i * 100003 + j; }
  /** Tallest rock within `radius` of (x, y). */
  maxHeightNear(x, y, radius) {
    const c = this.cell, n = Math.ceil(radius / c) + 1;
    const i0 = Math.floor(x / c), j0 = Math.floor(y / c);
    let best = 0;
    for (let i = i0 - n; i <= i0 + n; i++) for (let j = j0 - n; j <= j0 + n; j++) {
      const list = this.map.get(this.key(i, j));
      if (!list) continue;
      for (const r of list) if (r.h > best && Math.hypot(r.x - x, r.y - y) < radius + r.r) best = r.h;
    }
    return best;
  }
}

/**
 * Score a square of ground centred on (cx, cy).
 * @returns { n, cell, half, cx, cy, score: Float32Array (0 safe .. 1+ unsafe), safe: Uint8Array }
 */
export function scanHazards(terrain, rockIndex, veh, cx, cy, half = 150, cell = 6) {
  const n = Math.floor((2 * half) / cell) + 1;
  const score = new Float32Array(n * n), safe = new Uint8Array(n * n);
  const L = veh.limits, R = veh.legRadius;
  const pads = [];
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; pads.push([Math.cos(a) * R, Math.sin(a) * R]); }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = cx - half + i * cell, y = cy - half + j * cell;
    // best-fit tilt across the footprint (worst opposite pair)
    let tilt = 0;
    for (let k = 0; k < 4; k++) {
      const [ax, ay] = pads[k], [bx, by] = pads[k + 4];
      const dh = terrain.height(x + ax, y + ay) - terrain.height(x + bx, y + by);
      tilt = Math.max(tilt, Math.abs(Math.atan(dh / (2 * R))) * 180 / Math.PI);
    }
    const rock = rockIndex.maxHeightNear(x, y, R * 1.05);
    const s = Math.max(tilt / L.slopeDeg, rock / L.rockHeight);
    score[j * n + i] = s;
    safe[j * n + i] = s < 0.75 ? 1 : 0;
  }
  return { n, cell, half, cx, cy, score, safe };
}

/** Nearest safe cell to (x, y) with some clearance from unsafe neighbours. */
export function nearestSafe(scan, x, y) {
  const { n, cell, half, cx, cy, safe } = scan;
  let best = null, bestD = Infinity;
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
    if (!safe[j * n + i]) continue;
    // require the 8 neighbours to be safe too
    let ok = true;
    for (let dj = -1; dj <= 1 && ok; dj++) for (let di = -1; di <= 1; di++) if (!safe[(j + dj) * n + i + di]) { ok = false; break; }
    if (!ok) continue;
    const px = cx - half + i * cell, py = cy - half + j * cell;
    const d = Math.hypot(px - x, py - y);
    if (d < bestD) { bestD = d; best = { x: px, y: py, d }; }
  }
  return best;
}

export function scoreAt(scan, x, y) {
  const { n, cell, half, cx, cy, score } = scan;
  const i = Math.round((x - (cx - half)) / cell), j = Math.round((y - (cy - half)) / cell);
  if (i < 0 || j < 0 || i >= n || j >= n) return null;
  return score[j * n + i];
}
