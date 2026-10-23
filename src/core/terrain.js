// Terrain: two nested heightfields centred on the landing target.
//
//   regional: ~80 km square, used for the braking phase, horizon and shadows
//   site:     ~4 km square at metre-scale, used for approach, hazards, touchdown
//
// Map coordinates are metres in a local azimuthal (tangent-plane) projection
// centred on the target: +x = downrange of the default approach, +y = left.
// Heights are metres relative to the 1737.4 km LOLA reference sphere, with the
// target's own elevation subtracted so the target sits at h = 0.
//
// Real data: tools/lola_to_heightmap.py converts NASA LOLA GeoTIFFs into the
// .json + .bin format read by loadHeightfield(). Without it, makeAnalogTerrain()
// builds a stand-in modelled on Shackleton crater and the connecting ridge.

import { MOON } from './constants.js';

export class Heightfield {
  constructor({ size, spacing, data, name }) {
    this.n = size;               // samples per side
    this.spacing = spacing;      // metres between samples
    this.half = ((size - 1) * spacing) / 2;
    this.data = data;            // Float32Array, row-major, row = y index
    this.name = name;
  }
  contains(x, y, margin = 0) {
    const h = this.half - margin;
    return x >= -h && x <= h && y >= -h && y <= h;
  }
  /** Bilinear height at map coords (clamped at the edges). */
  sample(x, y) {
    const n = this.n;
    let fx = (x + this.half) / this.spacing;
    let fy = (y + this.half) / this.spacing;
    fx = Math.min(Math.max(fx, 0), n - 1.0001);
    fy = Math.min(Math.max(fy, 0), n - 1.0001);
    const ix = fx | 0, iy = fy | 0;
    const tx = fx - ix, ty = fy - iy;
    const d = this.data, i = iy * n + ix;
    const a = d[i], b = d[i + 1], c = d[i + n], e = d[i + n + 1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + e) * tx * ty;
  }
  at(ix, iy) { return this.data[iy * this.n + ix]; }
}

export class Terrain {
  constructor({ regional, site, rocks = [], meta = {} }) {
    this.regional = regional;
    this.site = site;
    this.rocks = rocks;          // [{x, y, r, h}] boulders near the target (site data only)
    this.meta = meta;            // provenance: { source, isAnalog, label, ... }
  }
  /** Terrain height at map coords; blends site into regional at the seam. */
  height(x, y) {
    const R = this.regional.sample(x, y);
    if (!this.site || !this.site.contains(x, y)) return this.regionalOrFar(x, y, R);
    const s = this.site.sample(x, y);
    const edge = this.site.half;
    const d = Math.min(edge - Math.abs(x), edge - Math.abs(y));
    const w = Math.min(1, d / 150); // 150 m blend band
    return R + (s - R) * w;
  }
  regionalOrFar(x, y, R) {
    if (this.regional.contains(x, y)) return R;
    // Beyond the data: fade to the reference sphere so the horizon stays sane.
    const over = Math.max(Math.abs(x), Math.abs(y)) - this.regional.half;
    return R * Math.max(0, 1 - over / 20000);
  }
  /** Slope in degrees from finite differences over `baseline` metres. */
  slopeDeg(x, y, baseline = 4) {
    const dx = (this.height(x + baseline, y) - this.height(x - baseline, y)) / (2 * baseline);
    const dy = (this.height(x, y + baseline) - this.height(x, y - baseline)) / (2 * baseline);
    return Math.atan(Math.hypot(dx, dy)) * 180 / Math.PI;
  }
  /** Tallest rock whose footprint covers (x, y), 0 if none. */
  rockHeightAt(x, y, padRadius = 0.6) {
    let best = 0;
    for (const r of this.rocks) {
      const d = Math.hypot(r.x - x, r.y - y);
      if (d < r.r + padRadius && r.h > best) best = r.h;
    }
    return best;
  }
}

// ---------- projection between map coords and Moon-centred Cartesian ----------
// The target is placed on the +Z axis: Moon-centred position of the target
// surface point is (0, 0, R). Map coords are an azimuthal equidistant
// projection about that point.

export function mapToDir(x, y) {
  const d = Math.hypot(x, y);
  if (d < 1e-9) return [0, 0, 1];
  const th = d / MOON.radius;
  const s = Math.sin(th) / d;
  return [x * s, y * s, Math.cos(th)];
}

export function dirToMap(dx, dy, dz) {
  const rho = Math.hypot(dx, dy);
  if (rho < 1e-12) return [0, 0];
  const th = Math.atan2(rho, dz);
  const k = (th * MOON.radius) / rho;
  return [dx * k, dy * k];
}

/** Moon-centred position for map coords + height (m above reference sphere). */
export function mapToMCI(x, y, h) {
  const [a, b, c] = mapToDir(x, y);
  const r = MOON.radius + h;
  return [a * r, b * r, c * r];
}

// ---------- loading real data ----------

/**
 * Load one heightfield from its JSON header and Float32 binary.
 * Header: { size, spacing, name, source, ... } written by tools/lola_to_heightmap.py
 */
export async function loadHeightfield(jsonUrl) {
  const meta = await (await fetch(jsonUrl)).json();
  const binUrl = new URL(meta.bin, new URL(jsonUrl, location.href)).href;
  const buf = await (await fetch(binUrl)).arrayBuffer();
  return { hf: new Heightfield({ ...meta, data: new Float32Array(buf) }), meta };
}

export function heightfieldFromBuffers(meta, buf) {
  return new Heightfield({ ...meta, data: new Float32Array(buf) });
}

// ---------- analog terrain (stand-in until real LOLA data is loaded) ----------

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed) {
  // Value noise with smooth interpolation, hashed lattice.
  const rnd = mulberry32(seed);
  const P = new Float32Array(4096);
  for (let i = 0; i < P.length; i++) P[i] = rnd() * 2 - 1;
  const hash = (i, j) => P[((i * 1619 + j * 31337) & 0x7fffffff) % 4096];
  return (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
}

function fbm(noise, x, y, octaves, lacunarity = 2.03, gain = 0.5) {
  let amp = 1, sum = 0, f = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * f + o * 17.3, y * f - o * 9.1);
    norm += amp; amp *= gain; f *= lacunarity;
  }
  return sum / norm;
}

/** Simple-crater elevation change at radial distance r for a crater of radius R. */
function craterDelta(r, R, depth, rimH) {
  const q = r / R;
  if (q < 1) {
    // parabolic bowl from floor (-depth) up to the rim crest
    return -depth + (depth + rimH) * q * q;
  }
  if (q < 4) return rimH * Math.pow(q, -3) * (1 - (q - 1) / 3); // ejecta blanket
  return 0;
}

function stampCrater(hf, cx, cy, R, depth, rimH) {
  const { n, spacing, half, data } = hf;
  const reach = R * 4;
  const x0 = Math.max(0, Math.floor((cx - reach + half) / spacing));
  const x1 = Math.min(n - 1, Math.ceil((cx + reach + half) / spacing));
  const y0 = Math.max(0, Math.floor((cy - reach + half) / spacing));
  const y1 = Math.min(n - 1, Math.ceil((cy + reach + half) / spacing));
  for (let iy = y0; iy <= y1; iy++) {
    const y = iy * spacing - half;
    for (let ix = x0; ix <= x1; ix++) {
      const x = ix * spacing - half;
      const r = Math.hypot(x - cx, y - cy);
      if (r < reach) data[iy * n + ix] += craterDelta(r, R, depth, rimH);
    }
  }
}

/**
 * Stand-in terrain built from Shackleton crater's published dimensions
 * (21 km rim diameter, ~4.2 km deep, ~6.6 km floor) and the ridge that runs
 * to de Gerlache crater (~32 km diameter). Small craters follow a power-law
 * size-frequency distribution typical of old highland terrain.
 * It is NOT measured topography.
 */
export function makeAnalogTerrain({ seed = 1969, regionalSize = 513, siteSize = 513 } = {}) {
  const noise = makeNoise(seed);
  const rnd = mulberry32(seed + 7);

  // Regional: 80 km at ~156 m
  const regSpan = 80000;
  const reg = new Heightfield({
    size: regionalSize, spacing: regSpan / (regionalSize - 1),
    data: new Float32Array(regionalSize * regionalSize), name: 'regional',
  });
  const SHACK = { x: -13000, y: 900, R: 10500, depth: 4200, rim: 450 };
  const DEGER = { x: 27500, y: -2500, R: 16200, depth: 2900, rim: 380 };
  for (let iy = 0; iy < reg.n; iy++) {
    const y = iy * reg.spacing - reg.half;
    for (let ix = 0; ix < reg.n; ix++) {
      const x = ix * reg.spacing - reg.half;
      // Connecting ridge: raised band along the line between the two craters
      const along = (x - SHACK.x) / (DEGER.x - SHACK.x);
      const lineY = SHACK.y + (DEGER.y - SHACK.y) * along;
      const ridge = 900 * Math.exp(-((y - lineY) ** 2) / (2 * 9000 ** 2));
      const rolling = 380 * fbm(noise, x / 14000, y / 14000, 5);
      reg.data[iy * reg.n + ix] = ridge + rolling;
    }
  }
  // Medium craters first, the big two last so their bowls stay intact.
  const regArea = (regSpan / 1000) ** 2;
  const nMed = Math.round(regArea * 0.055);
  for (let i = 0; i < nMed; i++) {
    const D = 400 * Math.pow(1 - rnd() * 0.985, -1 / 1.8); // 0.4 km .. ~4 km+
    const R = Math.min(D, 9000) / 2;
    const cx = (rnd() * 2 - 1) * regSpan / 2, cy = (rnd() * 2 - 1) * regSpan / 2;
    if (Math.hypot(cx, cy) < R * 1.6 + 600) continue; // keep the site itself on the ridge
    const fresh = 0.12 + 0.08 * rnd();             // degraded d/D for old highland craters
    stampCrater(reg, cx, cy, R, 2 * R * fresh, 2 * R * 0.02);
  }
  stampCrater(reg, DEGER.x, DEGER.y, DEGER.R, DEGER.depth, DEGER.rim);
  stampCrater(reg, SHACK.x, SHACK.y, SHACK.R, SHACK.depth, SHACK.rim);
  // Shackleton has a flat floor ~6.6 km across: clamp the bowl bottom
  {
    const floor = reg.sample(SHACK.x + 3300, SHACK.y);
    for (let iy = 0; iy < reg.n; iy++) for (let ix = 0; ix < reg.n; ix++) {
      const x = ix * reg.spacing - reg.half, y = iy * reg.spacing - reg.half;
      if (Math.hypot(x - SHACK.x, y - SHACK.y) < 3300) {
        const i = iy * reg.n + ix;
        reg.data[i] = Math.max(reg.data[i], floor);
      }
    }
  }

  // Site: 4 km at ~7.8 m (physics samples bilinearly; rocks handled separately)
  const siteSpan = 4000;
  const site = new Heightfield({
    size: siteSize, spacing: siteSpan / (siteSize - 1),
    data: new Float32Array(siteSize * siteSize), name: 'site',
  });
  for (let iy = 0; iy < site.n; iy++) {
    const y = iy * site.spacing - site.half;
    for (let ix = 0; ix < site.n; ix++) {
      const x = ix * site.spacing - site.half;
      // Artemis-style sites sit on local high points with gentle slopes; damp the
      // roughness close to the target and add a low, broad rise there.
      const rT = Math.hypot(x, y);
      const calm = 0.35 + 0.65 * Math.min(1, rT / 400);
      site.data[iy * site.n + ix] = reg.sample(x, y)
        + calm * (5 * fbm(noise, x / 260, y / 260, 4) + 1.0 * fbm(noise, x / 40, y / 40, 3))
        + 12 * Math.exp(-(rT * rT) / (2 * 450 * 450));
    }
  }
  const siteArea = (siteSpan / 1000) ** 2;
  const nSmall = Math.round(siteArea * 260);
  for (let i = 0; i < nSmall; i++) {
    const D = 10 * Math.pow(1 - rnd() * 0.995, -1 / 1.9); // 10 m .. a few hundred m
    const R = Math.min(D, 420) / 2;
    const cx = (rnd() * 2 - 1) * siteSpan / 2, cy = (rnd() * 2 - 1) * siteSpan / 2;
    if (Math.hypot(cx, cy) < R + 35) continue; // keep a ~35 m pad clear at the target
    const dd = 0.08 + 0.12 * rnd();
    stampCrater(site, cx, cy, R, 2 * R * dd, 2 * R * 0.025);
  }

  // Re-zero so the target is h = 0
  const h0 = site.sample(0, 0);
  for (let i = 0; i < site.data.length; i++) site.data[i] -= h0;
  for (let i = 0; i < reg.data.length; i++) reg.data[i] -= h0;

  // Boulders within 700 m of the target: cumulative count ~ D^-2.5
  const rocks = [];
  const nRocks = 2600;
  for (let i = 0; i < nRocks; i++) {
    const D = 0.25 * Math.pow(1 - rnd() * 0.999, -1 / 2.5);
    const dia = Math.min(D, 6);
    const a = rnd() * Math.PI * 2, rr = 700 * Math.sqrt(rnd());
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    if (Math.hypot(x, y) < 12 && dia > 0.3) continue;
    rocks.push({ x, y, r: dia / 2, h: dia * (0.4 + 0.3 * rnd()) });
  }

  return new Terrain({
    regional: reg, site, rocks,
    meta: {
      isAnalog: true,
      label: 'Analog terrain (Shackleton-based stand-in, not measured data)',
      siteName: 'Connecting ridge, near Shackleton rim',
      features: { shackleton: SHACK, deGerlache: DEGER },
    },
  });
}
