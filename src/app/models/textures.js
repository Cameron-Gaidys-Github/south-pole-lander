// Procedural surface maps, generated once at load time (no image downloads).
// Every map is a DataTexture laid out in the model's lathe UVs:
//   u = azimuth / 2π around the hull, v = height up the hull (row 0 = bottom).
import * as THREE from 'three';

const TAU = Math.PI * 2;

function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Tileable value noise on a w x h grid with `cx` x `cy` cells. */
function noiseField(w, h, cx, cy, seed) {
  const r = rng(seed), lat = new Float32Array(cx * cy);
  for (let i = 0; i < lat.length; i++) lat[i] = r();
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = (y / h) * cy, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * cx, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx);
      const x0 = ix % cx, x1 = (ix + 1) % cx, y0 = iy % cy, y1 = (iy + 1) % cy;
      const a = lat[y0 * cx + x0], b = lat[y0 * cx + x1], c = lat[y1 * cx + x0], d = lat[y1 * cx + x1];
      out[y * w + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}

function tex(data, w, h, { srgb = false, wrapU = true } = {}) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.wrapS = wrapU ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Height field (metres-ish units) -> tangent-space normal map. u wraps. */
function normalFromHeight(Hf, w, h, strength, wrapU = true) {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const ym = Math.max(0, y - 1), yp = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const xm = wrapU ? (x - 1 + w) % w : Math.max(0, x - 1), xp = wrapU ? (x + 1) % w : Math.min(w - 1, x + 1);
      const dx = (Hf[y * w + xp] - Hf[y * w + xm]) * strength;
      const dy = (Hf[yp * w + x] - Hf[ym * w + x]) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const k = (y * w + x) * 4;
      out[k] = (nx / l * 0.5 + 0.5) * 255; out[k + 1] = (ny / l * 0.5 + 0.5) * 255; out[k + 2] = (nz / l * 0.5 + 0.5) * 255; out[k + 3] = 255;
    }
  }
  return out;
}

/**
 * Stainless barrel maps.
 * spec: { circ, z0, z1, ringPitch, sheets, legs: [{az, halfW, z0, z1}], panels: [{az, z, w, h}],
 *         stains: [{az, halfW, z}], finish: 'paint'|'steel', w, h, seed }
 * Returns { map, roughnessMap, normalMap } (roughness in the G channel).
 */
export function barrelMaps(spec) {
  const { circ, z0, z1, ringPitch = 1.83, sheets = 3, legs = [], panels = [], stains = [], finish = 'paint', w = 2048, h = 2048, seed = 11 } = spec;
  const zSpan = z1 - z0;
  const pu = w / circ, pv = h / zSpan;          // pixels per metre
  const X = (az) => ((((az / TAU) % 1) + 1) % 1) * w;
  const Y = (z) => ((z - z0) / zSpan) * h;
  const Hf = new Float32Array(w * h);           // relief
  const A = new Float32Array(w * h).fill(1);    // albedo factor
  const Rr = new Float32Array(w * h);           // roughness offset
  const T = new Float32Array(w * h);            // heat tint near welds (steel only)
  const r = rng(seed);

  // per-sheet tone: hot-rolled sheets never quite match
  const nRings = Math.ceil(zSpan / ringPitch) + 1;
  const tone = [];
  for (let k = 0; k < nRings * sheets; k++) tone.push((r() - 0.5) * (finish === 'steel' ? 0.07 : 0.012));
  const mott = noiseField(w, h, 64, 64, seed + 1), fine = noiseField(w, h, 512, 512, seed + 2);
  for (let y = 0; y < h; y++) {
    const z = z0 + (y / h) * zSpan;
    const ring = Math.floor((z - z0) / ringPitch);
    const stagger = (ring % 2) * 0.5 / sheets;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const sheet = Math.floor(((u - stagger + 1) % 1) * sheets);
      const i = y * w + x;
      A[i] = 1 + tone[(ring * sheets + sheet) % tone.length] + (mott[i] - 0.5) * 0.02;
      Rr[i] = (mott[i] - 0.5) * 0.08 + (fine[i] - 0.5) * 0.04;
    }
  }
  // horizontal welds (ring joins): raised bead, faint darkening, heat tint either side
  const bead = (dy) => Math.exp(-(dy * dy) / 2.2);
  for (let k = 1; k < nRings; k++) {
    const yc = Y(z0 + k * ringPitch);
    for (let dy = -10; dy <= 10; dy++) {
      const y = Math.round(yc + dy); if (y < 0 || y >= h) continue;
      const b = bead(dy), tint = Math.exp(-(dy * dy) / 40);
      for (let x = 0; x < w; x++) { const i = y * w + x; Hf[i] += 1.6 * b; A[i] -= 0.035 * b; Rr[i] -= 0.08 * b; T[i] = Math.max(T[i], tint); }
    }
  }
  // vertical welds, staggered ring to ring
  for (let k = 0; k < nRings; k++) {
    const ya = Math.max(0, Math.floor(Y(z0 + k * ringPitch))), yb = Math.min(h, Math.ceil(Y(z0 + (k + 1) * ringPitch)));
    const stagger = (k % 2) * 0.5 / sheets;
    for (let s = 0; s < sheets; s++) {
      const xc = ((s / sheets + stagger) % 1) * w;
      for (let dx = -10; dx <= 10; dx++) {
        const x = (Math.round(xc + dx) + w) % w;
        const b = bead(dx), tint = Math.exp(-(dx * dx) / 40);
        for (let y = ya; y < yb; y++) { const i = y * w + x; Hf[i] += 1.6 * b; A[i] -= 0.035 * b; Rr[i] -= 0.08 * b; T[i] = Math.max(T[i], tint); }
      }
    }
  }
  // stow channels for the landing legs: recessed, edges grooved
  for (const L of legs) {
    const xa = X(L.az - L.halfW), xb = X(L.az + L.halfW), ya = Math.max(0, Y(L.z0)), yb = Math.min(h, Y(L.z1));
    const span = ((xb - xa) + w) % w;
    for (let y = Math.floor(ya); y < yb; y++) for (let t = 0; t <= span; t++) {
      const x = Math.round(xa + t) % w, i = y * w + x;
      const edge = Math.min(t, span - t, y - ya, yb - y);
      Hf[i] -= edge < 3 ? 3 : 1.2;
      A[i] *= finish === 'steel' ? 0.94 : 0.86;
      Rr[i] += 0.06;
    }
  }
  // access panels: grooved outlines
  for (const P of panels) {
    const xa = X(P.az) - (P.w * pu) / 2, ya = Y(P.z) - (P.h * pv) / 2, pw = P.w * pu, ph = P.h * pv;
    for (let y = Math.floor(ya); y <= ya + ph; y++) for (let t = 0; t <= pw; t++) {
      const onEdge = y - ya < 2 || ya + ph - y < 2 || t < 2 || pw - t < 2;
      if (!onEdge || y < 0 || y >= h) continue;
      const i = y * w + ((Math.round(xa + t) % w) + w) % w;
      Hf[i] -= 2; A[i] *= 0.9;
    }
  }
  // exhaust staining below the landing thruster pods
  for (const S of stains) {
    const xc = X(S.az), hw = S.halfW * pu, yTop = Y(S.z);
    for (let y = Math.max(0, Math.floor(yTop - 9 * pv)); y < Math.min(h, yTop); y++) {
      const fall = (yTop - y) / (9 * pv);
      for (let dx = -hw; dx <= hw; dx++) {
        const x = ((Math.round(xc + dx) % w) + w) % w, i = y * w + x;
        const across = 1 - Math.abs(dx) / hw;
        const streak = 0.6 + 0.4 * fine[(y * 7 % h) * w + x];
        A[i] *= 1 - 0.1 * across * (1 - fall) * streak;
      }
    }
  }

  const map = new Uint8Array(w * h * 4), rough = new Uint8Array(w * h * 4);
  const brush = finish === 'steel' ? noiseField(w, h, 8, 1024, seed + 5) : null; // streaks along u (rolling direction)
  for (let i = 0; i < w * h; i++) {
    let rC, gC, bC, ro;
    if (finish === 'steel') {
      const a = Math.max(0, A[i]);
      const t = T[i];
      // straw-to-blue heat tint next to welds, as on built Starships
      rC = 182 * a + 18 * t; gC = 186 * a + 6 * t; bC = 192 * a - 10 * t;
      ro = 0.3 + Rr[i] * 0.4 + (brush[i] - 0.5) * 0.05 + t * 0.05;
    } else {
      const a = Math.max(0, A[i]);
      rC = 236 * a; gC = 234 * a; bC = 228 * a;
      ro = 0.5 + Rr[i];
    }
    const k = i * 4;
    map[k] = Math.min(255, Math.max(0, rC)); map[k + 1] = Math.min(255, Math.max(0, gC)); map[k + 2] = Math.min(255, Math.max(0, bC)); map[k + 3] = 255;
    rough[k] = 255; rough[k + 1] = Math.min(255, Math.max(0, ro * 255)); rough[k + 2] = 0; rough[k + 3] = 255;
  }
  return {
    map: tex(map, w, h, { srgb: true }),
    roughnessMap: tex(rough, w, h),
    normalMap: tex(normalFromHeight(Hf, w, h, 0.9), w, h),
  };
}

/** Nose fairing: two halves with meridional seams, a base seam, faint panel lines. */
export function noseMaps({ finish = 'paint', w = 1024, h = 512, seed = 21 } = {}) {
  const Hf = new Float32Array(w * h), A = new Float32Array(w * h).fill(1);
  const mott = noiseField(w, h, 32, 16, seed);
  for (let i = 0; i < w * h; i++) A[i] += (mott[i] - 0.5) * (finish === 'steel' ? 0.06 : 0.015);
  const line = (x0, depth) => { for (let y = 0; y < h * 0.96; y++) for (let dx = -2; dx <= 2; dx++) { const i = y * w + ((x0 + dx + w) % w); Hf[i] -= depth * Math.exp(-dx * dx / 1.5); A[i] *= 0.93; } };
  line(Math.round(w * 0.25), 2.5); line(Math.round(w * 0.75), 2.5);   // fairing split at ±90°
  for (const v of [0.012, 0.35, 0.7]) { const y0 = Math.round(v * h); for (let dy = -2; dy <= 2; dy++) for (let x = 0; x < w; x++) { const i = Math.min(h - 1, Math.max(0, y0 + dy)) * w + x; Hf[i] -= 2 * Math.exp(-dy * dy / 1.5); A[i] *= 0.95; } }
  const map = new Uint8Array(w * h * 4), rough = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = A[i], k = i * 4;
    if (finish === 'steel') { map[k] = 180 * a; map[k + 1] = 184 * a; map[k + 2] = 190 * a; rough[k + 1] = 70; }
    else { map[k] = 236 * a; map[k + 1] = 234 * a; map[k + 2] = 228 * a; rough[k + 1] = 128; }
    map[k + 3] = 255; rough[k] = 255; rough[k + 3] = 255;
  }
  return { map: tex(map, w, h, { srgb: true }), roughnessMap: tex(rough, w, h), normalMap: tex(normalFromHeight(Hf, w, h, 0.9), w, h) };
}

/** Black engine-section paint with panel joints and soot near the bottom. */
export function aftMaps({ w = 1024, h = 256, zSpan = 5.5, seed = 31 } = {}) {
  const Hf = new Float32Array(w * h), A = new Float32Array(w * h).fill(1);
  const mott = noiseField(w, h, 48, 12, seed);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, v = y / h;
    A[i] = 1 + (mott[i] - 0.5) * 0.25 - (1 - v) * 0.25;   // sootier at the bottom edge
    if (x % (w / 12) < 2) { Hf[i] -= 2; A[i] *= 0.7; }  // 12 skirt panels
    if (Math.abs(y - h * 0.62) < 2) { Hf[i] -= 2; A[i] *= 0.7; }
  }
  const map = new Uint8Array(w * h * 4), rough = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = Math.max(0.2, A[i]), k = i * 4;
    map[k] = 30 * a; map[k + 1] = 31 * a; map[k + 2] = 34 * a; map[k + 3] = 255;
    rough[k] = 255; rough[k + 1] = 175 + (mott[i] - 0.5) * 40; rough[k + 3] = 255;
  }
  return { map: tex(map, w, h, { srgb: true }), roughnessMap: tex(rough, w, h), normalMap: tex(normalFromHeight(Hf, w, h, 0.9), w, h) };
}

/** Regeneratively cooled nozzle: tube wall around the bell, heat tint toward the throat. */
export function nozzleMaps({ tubes = 288, w = 1024, h = 256, vac = false } = {}) {
  const Hf = new Float32Array(w * h);
  const map = new Uint8Array(w * h * 4), rough = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const v = y / h;   // 0 = exit, 1 = top
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!vac) Hf[i] = Math.cos((x / w) * tubes * TAU) * 0.6;       // tube walls
      else Hf[i] = (Math.abs(((v * 22) % 1) - 0.5) < 0.03 ? -1 : 0); // radiatively cooled extension: stiffener rings
      const k = i * 4;
      let c;
      if (vac) c = v < 0.85 ? [70 + 30 * v, 66 + 20 * v, 72 - 10 * v] : [120, 90, 70];
      else c = [118 - 40 * (1 - v), 84 - 30 * (1 - v), 66 - 20 * (1 - v)];     // copper-bronze, darker at the exit
      map[k] = c[0]; map[k + 1] = c[1]; map[k + 2] = c[2]; map[k + 3] = 255;
      rough[k] = 255; rough[k + 1] = vac ? 95 : 120; rough[k + 3] = 255;
    }
  }
  return { map: tex(map, w, h, { srgb: true }), roughnessMap: tex(rough, w, h), normalMap: tex(normalFromHeight(Hf, w, h, 2.0), w, h) };
}

/** Solar array: cells with silver busbars and gaps. */
export function solarMaps({ w = 256, h = 1024, cellsU = 8, cellsV = 64 } = {}) {
  const map = new Uint8Array(w * h * 4), rough = new Uint8Array(w * h * 4), Hf = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const cu = (x * cellsU / w) % 1, cv = (y * cellsV / h) % 1, i = y * w + x, k = i * 4;
    const gap = cu < 0.04 || cv < 0.04;
    const bus = Math.abs(cu - 0.5) < 0.012 || Math.abs(cu - 0.25) < 0.006 || Math.abs(cu - 0.75) < 0.006;
    let c = gap ? [205, 205, 210] : bus ? [170, 172, 178] : [16, 24, 46];
    if (gap) Hf[i] = -1;
    map[k] = c[0]; map[k + 1] = c[1]; map[k + 2] = c[2]; map[k + 3] = 255;
    rough[k] = 255; rough[k + 1] = gap ? 140 : 40; rough[k + 2] = gap ? 0 : 0; rough[k + 3] = 255;
  }
  return { map: tex(map, w, h, { srgb: true, wrapU: false }), roughnessMap: tex(rough, w, h, { wrapU: false }), normalMap: tex(normalFromHeight(Hf, w, h, 1.5, false), w, h, { wrapU: false }) };
}

/** Quilted multilayer insulation (engine bay shield, sensor pods). */
export function blanketMaps({ w = 512, h = 512, tint = [52, 52, 56], quilt = 24, seed = 41 } = {}) {
  const Hf = new Float32Array(w * h), map = new Uint8Array(w * h * 4), rough = new Uint8Array(w * h * 4);
  const n = noiseField(w, h, 64, 64, seed);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, cu = (x * quilt / w) % 1, cv = (y * quilt / h) % 1;
    const pillow = Math.sin(cu * Math.PI) * Math.sin(cv * Math.PI);
    Hf[i] = pillow * 1.2 + (n[i] - 0.5) * 0.8;
    const a = 0.8 + 0.2 * pillow + (n[i] - 0.5) * 0.2, k = i * 4;
    map[k] = tint[0] * a; map[k + 1] = tint[1] * a; map[k + 2] = tint[2] * a; map[k + 3] = 255;
    rough[k] = 255; rough[k + 1] = 150 + (n[i] - 0.5) * 60; rough[k + 3] = 255;
  }
  return { map: tex(map, w, h, { srgb: true }), roughnessMap: tex(rough, w, h), normalMap: tex(normalFromHeight(Hf, w, h, 1.2), w, h) };
}

/** Fine brushed-metal roughness for small steel parts (legs, rails, docking ring). */
export function brushedMaps({ w = 256, h = 256, seed = 51 } = {}) {
  const n = noiseField(w, h, 4, 256, seed), rough = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { const k = i * 4; rough[k] = 255; rough[k + 1] = (0.26 + (n[i] - 0.5) * 0.12) * 255; rough[k + 3] = 255; }
  return { roughnessMap: tex(rough, w, h) };
}
