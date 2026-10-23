// Three.js scene: terrain meshes, Sun, Earth, boulders.
// World frame = Moon-centred frame shifted so the target surface point is the
// origin; +Z is (approximately) local up at the target.

import * as THREE from 'three';
import { MOON } from '../core/constants.js';
import { mapToDir } from '../core/terrain.js';
import { visibilityGrid, sunVisibility } from '../core/illumination.js';
import { makeTerrainMaterial, attachTerrainAttributes } from './terrainMaterial.js';

const DEG = Math.PI / 180;

export function mciToWorld(r, out = new THREE.Vector3()) {
  return out.set(r[0], r[1], r[2] - MOON.radius);
}

function worldPoint(x, y, h) {
  const [a, b, c] = mapToDir(x, y);
  const R = MOON.radius + h;
  return [a * R, b * R, c * R - MOON.radius];
}

/** Sun direction (unit, world) for azimuth/elevation in the target's local frame. */
export function sunDirection(azDeg, elDeg) {
  const az = azDeg * DEG, el = elDeg * DEG;
  return new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)).normalize();
}

// Regolith albedo: highland material is brighter than mare, ~0.12-0.18 normal albedo.
function albedo(h, x, y) {
  const n = Math.sin(x * 0.0013 + Math.sin(y * 0.0009) * 2.1) * Math.cos(y * 0.0011 - x * 0.0004);
  return 0.62 + 0.08 * n;
}

function buildGridMesh(terrain, hf, stride, vis, holeHalf, onProgress) {
  const n = Math.floor((hf.n - 1) / stride) + 1;
  const pos = new Float32Array(n * n * 3);
  const col = new Float32Array(n * n * 3);
  const alb = new Float32Array(n * n), vv = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const y = j * stride * hf.spacing - hf.half;
    for (let i = 0; i < n; i++) {
      const x = i * stride * hf.spacing - hf.half;
      const h = terrain.height(x, y);
      const p = worldPoint(x, y, h);
      const k = j * n + i;
      pos.set(p, k * 3);
      alb[k] = albedo(h, x, y);
      vv[k] = vis.data[k];
    }
  }
  const idx = [];
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      if (holeHalf) {
        const x0 = i * stride * hf.spacing - hf.half, y0 = j * stride * hf.spacing - hf.half;
        const x1 = x0 + stride * hf.spacing, y1 = y0 + stride * hf.spacing;
        if (x0 > -holeHalf && x1 < holeHalf && y0 > -holeHalf && y1 < holeHalf) continue;
      }
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, b, c, b, d, c); // counter-clockwise seen from above
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.userData = { alb, vis: vv };
  return g;
}

function buildFarField(terrain, inner, outer) {
  // Polar ring of the reference sphere out to well past the horizon at 15 km
  const nr = 90, na = 160;
  const pos = [], col = [], idx = [], alb = [];
  for (let i = 0; i <= nr; i++) {
    const r = inner * Math.pow(outer / inner, i / nr);
    for (let j = 0; j < na; j++) {
      const a = (j / na) * Math.PI * 2;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      const h = terrain.height(x, y) + 300 * Math.sin(x / 23000) * Math.cos(y / 31000);
      pos.push(...worldPoint(x, y, h));
      alb.push(0.6 * (0.8 + 0.2 * Math.sin(a * 7 + r / 9000)));
      col.push(0, 0, 0);
    }
  }
  for (let i = 0; i < nr; i++) for (let j = 0; j < na; j++) {
    const a = i * na + j, b = i * na + ((j + 1) % na), c = a + na, d = b + na;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.userData = { alb: Float32Array.from(alb), vis: new Float32Array(alb.length).fill(1) };
  return g;
}

/**
 * Bake surface brightness into vertex colours.
 * Regolith scatters close to the Lommel-Seeliger law, I ~ mu0 / (mu0 + mu), which
 * stays brighter than Lambert at grazing sun. A camera exposed for the lit surface
 * is modelled by a fixed gain; ACES tone mapping rolls off sun-facing slopes.
 * Shadowed ground keeps ~1% from light bounced off sunlit slopes.
 */
export function shadeTerrain(g, sunDir, enhanced) {
  const { alb, vis } = g.userData;
  const P = g.attributes.position.array, N = g.attributes.normal.array, C = g.attributes.color.array;
  const sx = sunDir.x, sy = sunDir.y, sz = sunDir.z;
  for (let k = 0; k < alb.length; k++) {
    const nx = N[k * 3], ny = N[k * 3 + 1], nz = N[k * 3 + 2];
    const mu0 = Math.max(0, nx * sx + ny * sy + nz * sz);
    const ls = mu0 / (mu0 + 0.5);
    let b = alb[k] * (vis[k] * 5.5 * ls + 0.012);
    if (enhanced) {
      // local up for a soft sky-fill term
      const px = P[k * 3], py = P[k * 3 + 1], pz = P[k * 3 + 2] + MOON.radius;
      const l = Math.hypot(px, py, pz);
      const nUp = (nx * px + ny * py + nz * pz) / l;
      b += alb[k] * 0.16 * (0.55 + 0.45 * nUp);
    }
    C[k * 3] = b; C[k * 3 + 1] = b * 0.985; C[k * 3 + 2] = b * 0.955;
  }
  g.attributes.color.needsUpdate = true;
}

function makeEarthTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(110, 100, 10, 128, 128, 128);
  grd.addColorStop(0, '#9cc3ff'); grd.addColorStop(0.6, '#2d62b5'); grd.addColorStop(1, '#0d2350');
  g.fillStyle = grd; g.beginPath(); g.arc(128, 128, 124, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 100;
    g.beginPath(); g.ellipse(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 8 + Math.random() * 22, 3 + Math.random() * 7, Math.random() * 3, 0, Math.PI * 2); g.fill();
  }
  // terminator: the Earth is in a phase opposite the Sun as seen from the Moon
  const sh = g.createLinearGradient(0, 0, 256, 0);
  sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(0.55, 'rgba(0,0,0,0)'); sh.addColorStop(0.7, 'rgba(0,0,0,0.92)');
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = sh; g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

export class World {
  constructor(renderer, terrain, opts = {}) {
    this.renderer = renderer;
    this.terrain = terrain;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000); // no atmosphere: black sky, no haze
    this.sunAz = opts.sunAz ?? 285;
    this.sunEl = opts.sunEl ?? 1.0;
    this.enhanced = false;

    this.sun = new THREE.DirectionalLight(0xfff6ea, 7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target);
    // Earthshine is ~1/10000 of sunlight; ambient here stands in for it plus
    // light scattered off sunlit slopes. "Enhanced" raises it for playability.
    this.ambient = new THREE.AmbientLight(0x8fa3c8, 0.18);
    this.scene.add(this.ambient);
    this.fill = new THREE.HemisphereLight(0xc9d6ff, 0x3a3630, 0);
    this.scene.add(this.fill);
    // Sunlit regolith bounces light up onto the vehicle's underside and flanks
    this.bounce = new THREE.HemisphereLight(0x000000, 0xb8b0a2, 0.7);
    this.scene.add(this.bounce);

    this.terrainMat = makeTerrainMaterial();
    this.groups = new THREE.Group();
    this.scene.add(this.groups);

    // Earth: ~1.9 deg across, low over the horizon from the south pole
    const earthDist = 1.2e6;
    const earthR = earthDist * Math.tan(0.95 * DEG);
    this.earth = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeEarthTexture(), depthWrite: false, fog: false }));
    this.earth.scale.set(earthR * 2, earthR * 2, 1);
    const eAz = (this.sunAz + 150) * DEG, eEl = 4.5 * DEG;
    this.earthDir = new THREE.Vector3(Math.cos(eAz) * Math.cos(eEl), Math.sin(eAz) * Math.cos(eEl), Math.sin(eEl));
    this.earthDist = earthDist;
    this.scene.add(this.earth);

    this.makeEnvironment(renderer);
    this.stars = this.makeStars();
    this.stars.visible = false;
    this.scene.add(this.stars);
  }

  /** Reflection environment for the vehicle: black sky, grey regolith, glare toward the Sun. */
  makeEnvironment(renderer) {
    const env = new THREE.Scene();
    const sd = sunDirection(this.sunAz, this.sunEl);
    const geo = new THREE.SphereGeometry(10, 64, 32);
    const col = [];
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).normalize();
      const w = v; // the environment is sampled by world direction (Z-up here)
      const below = w.z < 0;
      const toward = Math.max(0, w.dot(new THREE.Vector3(sd.x, sd.y, 0).normalize()));
      let c = below ? 0.22 + 0.5 * Math.pow(toward, 3) : 0.0;
      if (!below && w.dot(sd) > 0.9995) c = 40;
      col.push(c, c * 0.98, c * 0.95);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    env.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const pm = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pm.fromScene(env, 0.02).texture;
    pm.dispose();
  }

  makeStars() {
    const n = 3000, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      p.set([s * Math.cos(t) * 1.5e6, s * Math.sin(t) * 1.5e6, u * 1.5e6], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: false, depthWrite: false }));
  }

  /** (Re)build terrain meshes for the current Sun. Heavy: call on setup only. */
  async build(onProgress = () => {}) {
    const T = this.terrain;
    for (const c of [...this.groups.children]) { c.geometry.dispose(); this.groups.remove(c); }
    const tick = () => new Promise(r => setTimeout(r, 0));
    onProgress('Tracing sunlight across the region', 0.1); await tick();
    const regStride = T.regional.n > 600 ? 4 : 2;
    const visReg = visibilityGrid(T, T.regional, this.sunAz, this.sunEl, regStride);
    onProgress('Tracing sunlight at the landing site', 0.45); await tick();
    const siteStride = T.site.n > 1100 ? 2 : 1;
    const visSite = visibilityGrid(T, T.site, this.sunAz, this.sunEl, siteStride);
    onProgress('Building terrain', 0.8); await tick();
    const reg = new THREE.Mesh(buildGridMesh(T, T.regional, regStride, visReg, T.site.half - 120), this.terrainMat);
    const site = new THREE.Mesh(buildGridMesh(T, T.site, siteStride, visSite, 0), this.terrainMat);
    const far = new THREE.Mesh(buildFarField(T, T.regional.half * 0.97, 700000), this.terrainMat);
    this.groups.add(far, reg, site);
    this.terrainMeshes = [far, reg, site];
    for (const m of this.terrainMeshes) attachTerrainAttributes(m.geometry);
    this.buildRocks();
    this.siteVis = visSite;
    this.regVis = visReg;
    this.targetLit = sunVisibility(T, 0, 0, 0.5, this.sunAz * DEG, this.sunEl * DEG);
    this.updateSun();
    onProgress('Ready', 1);
  }

  buildRocks() {
    if (this.rocks) { this.rocks.geometry.dispose(); this.groups.remove(this.rocks); }
    const rocks = this.terrain.rocks;
    if (!rocks.length) return;
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = 0.75 + 0.5 * Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1);
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ color: 0x9a968f });
    const mesh = new THREE.InstancedMesh(geo, mat, rocks.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3();
    const az = this.sunAz * DEG, el = this.sunEl * DEG;
    const c = new THREE.Color();
    rocks.forEach((r, i) => {
      const h = this.terrain.height(r.x, r.y);
      const w = worldPoint(r.x, r.y, h + r.h * 0.3);
      t.set(w[0], w[1], w[2]);
      q.setFromEuler(new THREE.Euler(i * 1.3, i * 0.7, i * 2.1));
      s.set(r.r, r.r * 0.9, r.h * 0.75);
      m.compose(t, q, s);
      mesh.setMatrixAt(i, m);
      const v = sunVisibility(this.terrain, r.x, r.y, h + r.h, az, el, 20000, 6);
      c.setScalar(0.05 + 0.95 * v);
      mesh.setColorAt(i, c);
    });
    mesh.castShadow = true;
    this.rocks = mesh;
    this.groups.add(mesh);
  }

  updateSun() {
    const d = sunDirection(this.sunAz, this.sunEl);
    this.sunDir = d;
    this.terrainMat.uniforms.uSun.value.copy(d);
    this.sun.position.copy(d).multiplyScalar(3000);
    this.sun.target.position.set(0, 0, 0);
  }

  setEnhanced(on) {
    this.enhanced = on;
    this.terrainMat.uniforms.uFill.value = on ? 0.16 : 0;
    this.ambient.intensity = on ? 0.6 : 0.18;
    this.fill.intensity = on ? 0.9 : 0;
  }

  /**
   * The vehicle's own shadow. With the Sun ~1 deg up, a 52 m Starship throws a
   * shadow ~3 km long, so it is traced along the ground rather than shadow-mapped.
   */
  updateVehicleShadow(sim, model) {
    const SEG = 260;
    if (!this.shadowStrip) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEG + 1) * 2 * 3), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array((SEG + 1) * 2 * 4), 4));
      const idx = [];
      for (let i = 0; i < SEG; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      g.setIndex(idx);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        color: 0x000000, vertexColors: true, transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide,
      }));
      m.frustumCulled = false;
      this.scene.add(m);
      this.shadowStrip = m;
    }
    const g = this.shadowStrip.geometry;
    const P = g.attributes.position.array, C = g.attributes.color.array;
    const [x0, y0] = sim.map;
    const az = this.sunAz * DEG, tEl = Math.tan(this.sunEl * DEG);
    const dx = -Math.cos(az), dy = -Math.sin(az);           // shadow runs away from the Sun
    const px = -dy, py = dx;                               // across the shadow
    const h0 = this.terrain.height(x0, y0);
    const zb = Math.max(0, sim.altitude), zt = zb + model.height * Math.cos(sim.tiltDeg * DEG);
    const halfW = sim.v.diameter / 2;
    const dMax = Math.min(6000, (zt + 80) / Math.max(tEl, 1e-3));
    for (let i = 0; i <= SEG; i++) {
      const d = dMax * Math.pow(i / SEG, 1.6);
      const gx = x0 + dx * d, gy = y0 + dy * d;
      const dh = this.terrain.height(gx, gy) - h0;
      const lo = zb - d * tEl, hi = zt - d * tEl;
      const inShadow = dh >= lo - 1 && dh <= hi;
      const fade = 1 - Math.min(1, Math.max(0, (d - dMax * 0.85) / (dMax * 0.15)));
      const a = inShadow ? 0.88 * fade : 0;
      for (let s = 0; s < 2; s++) {
        const sx = gx + px * halfW * (s ? 1 : -1), sy = gy + py * halfW * (s ? 1 : -1);
        const w = worldPoint(sx, sy, this.terrain.height(sx, sy) + 0.08);
        const k = i * 2 + s;
        P[k * 3] = w[0]; P[k * 3 + 1] = w[1]; P[k * 3 + 2] = w[2];
        C[k * 4] = 0; C[k * 4 + 1] = 0; C[k * 4 + 2] = 0; C[k * 4 + 3] = a;
      }
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    this.shadowStrip.visible = zb < 600;
  }

  /** Landing point reticle on the ground: footprint ring, green safe / red unsafe. */
  setReticle(x, y, radius, safe, visible) {
    if (!this.reticle) {
      const g = new THREE.RingGeometry(1, 1.12, 64);
      const m = new THREE.MeshBasicMaterial({ color: 0x6fd39a, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
      this.reticle = new THREE.Mesh(g, m);
      const cross = new THREE.Mesh(new THREE.RingGeometry(0, 0.08, 16), m);
      this.reticle.add(cross);
      this.scene.add(this.reticle);
    }
    const r = this.reticle;
    r.visible = visible;
    if (!visible) return;
    const h = this.terrain.height(x, y);
    const p = worldPoint(x, y, h + 0.25);
    r.position.set(p[0], p[1], p[2]);
    const up = new THREE.Vector3(p[0], p[1], p[2] + MOON.radius).normalize();
    r.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), up);
    r.scale.setScalar(radius);
    r.material.color.set(safe ? 0x6fd39a : 0xff6a55);
  }

  /** Keep the vehicle's shadow camera centred on the vehicle. */
  follow(vehiclePos, camera) {
    const d = this.sunDir;
    this.sun.target.position.copy(vehiclePos);
    this.sun.position.copy(vehiclePos).addScaledVector(d, 4000);
    const sc = this.sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70;
    sc.near = 10; sc.far = 9000;
    sc.updateProjectionMatrix();
    this.earth.position.copy(camera.position).addScaledVector(this.earthDir, this.earthDist);
    this.stars.position.copy(camera.position);
  }
}
