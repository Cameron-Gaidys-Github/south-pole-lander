// Sun visibility from terrain horizons.
//
// At the lunar south pole the Sun sits within ~1.5 deg of the horizon, so
// whether a spot is lit depends almost entirely on the terrain between it and
// the Sun, tens of kilometres away. For each sample we march toward the Sun,
// track the highest horizon angle (including the Moon's curvature drop), and
// compare it with the Sun's elevation. The Sun's disk is ~0.53 deg wide, so
// partial occlusion gives a soft penumbra.

import { MOON } from './constants.js';

const DEG = Math.PI / 180;
const SUN_DISK = 0.53 * DEG;

/**
 * @returns visible fraction of the solar disk, 0..1
 */
export function sunVisibility(terrain, x, y, h0, sunAzRad, sunElRad, maxDist = 60000, firstStep = 8) {
  const dx = Math.cos(sunAzRad), dy = Math.sin(sunAzRad);
  let d = firstStep, horizon = -Infinity;
  const stopAngle = sunElRad + SUN_DISK / 2;
  while (d < maxDist) {
    const h = terrain.height(x + dx * d, y + dy * d) - (d * d) / (2 * MOON.radius);
    const a = Math.atan2(h - h0, d);
    if (a > horizon) {
      horizon = a;
      if (horizon >= stopAngle) return 0; // fully hidden, no need to march on
    }
    d *= 1.06; d += firstStep * 0.5;
  }
  const f = (sunElRad - horizon) / SUN_DISK + 0.5;
  return Math.min(1, Math.max(0, f));
}

/** Visibility for every sample of a heightfield grid, optionally strided. */
export function visibilityGrid(terrain, hf, sunAzDeg, sunElDeg, stride = 1, onProgress) {
  const n = Math.floor((hf.n - 1) / stride) + 1;
  const out = new Float32Array(n * n);
  const az = sunAzDeg * DEG, el = sunElDeg * DEG;
  const step = Math.max(4, hf.spacing * stride * 0.75);
  for (let j = 0; j < n; j++) {
    const y = j * stride * hf.spacing - hf.half;
    for (let i = 0; i < n; i++) {
      const x = i * stride * hf.spacing - hf.half;
      const h0 = terrain.height(x, y) + 0.5;
      out[j * n + i] = sunVisibility(terrain, x, y, h0, az, el, 60000, step);
    }
    if (onProgress && j % 32 === 0) onProgress(j / n);
  }
  return { n, data: out };
}
