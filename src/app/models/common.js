// Shared building blocks for the lander models.
//
// Conventions (same for every model):
//   origin  centre of the footpad circle, on the ground plane (legs deployed)
//   +Z      body axis, the direction main-engine thrust pushes the vehicle
//   +X      crew windows / hatch / elevator side
//   units   metres, true scale
//   thrust exit nodes: Object3D at the nozzle exit plane; local +Z = thrust
//   direction on the vehicle, so the exhaust leaves along local -Z.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/**
 * Surface of revolution about +Z with analytic normals and clean UVs.
 * profile: [[r, z], ...] bottom to top. Repeat a point to get a hard crease.
 * u = azimuth / 2π (0 at +X, counter-clockwise from above), v = z normalised
 * over vRange (default: the profile's own z span).
 */
export function latheZ(profile, segments = 64, { az0 = 0, az1 = TAU, vRange = null, flip = false } = {}) {
  const n = profile.length, cols = segments + 1;
  const pos = new Float32Array(n * cols * 3), nor = new Float32Array(n * cols * 3), uv = new Float32Array(n * cols * 2);
  const zMin = vRange ? vRange[0] : Math.min(...profile.map(p => p[1]));
  const zMax = vRange ? vRange[1] : Math.max(...profile.map(p => p[1]));
  const zSpan = zMax - zMin || 1;
  for (let i = 0; i < n; i++) {
    const [r, z] = profile[i];
    const p0 = profile[Math.max(i - 1, 0)], p1 = profile[Math.min(i + 1, n - 1)];
    let dr = p1[0] - p0[0], dz = p1[1] - p0[1];
    if (Math.abs(dr) + Math.abs(dz) < 1e-9) { dr = 0; dz = 1; }
    let nr = dz, nz = -dr;
    const l = Math.hypot(nr, nz) || 1; nr /= l; nz /= l;
    if (flip) { nr = -nr; nz = -nz; }
    for (let j = 0; j < cols; j++) {
      const az = az0 + (az1 - az0) * (j / segments);
      const c = Math.cos(az), s = Math.sin(az);
      const k = i * cols + j;
      pos[k * 3] = r * c; pos[k * 3 + 1] = r * s; pos[k * 3 + 2] = z;
      nor[k * 3] = nr * c; nor[k * 3 + 1] = nr * s; nor[k * 3 + 2] = nz;
      uv[k * 2] = az / TAU; uv[k * 2 + 1] = (z - zMin) / zSpan;
    }
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < segments; j++) {
    const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
    if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * Rao-style bell nozzle, z = 0 at the gimbal point (top), extending down.
 * Throat arcs (1.5 rt upstream, 0.382 rt downstream) and a quadratic Bezier
 * bell from initial angle thetaN to exit angle thetaE, as in Rao's
 * thrust-optimised parabola approximation.
 * Returns { profile (bottom to top), throatZ, exitZ }.
 */
export function rocketEngineProfile({ rt, re, bellLen, thetaN = 30, thetaE = 8, chamberR, chamberLen, top = 0, lip = 0.012, bellSamples = 28, arcSamples = 6 }) {
  const tn = Math.tan(thetaN * DEG), te = Math.tan(thetaE * DEG);
  // depth d is measured downward from the throat
  const dN = 0.382 * rt * Math.sin(thetaN * DEG), rN = rt + 0.382 * rt * (1 - Math.cos(thetaN * DEG));
  const dE = bellLen, rE = re;
  const dQ = (rE - rN - te * dE + tn * dN) / (tn - te), rQ = rN + tn * (dQ - dN);
  const down = [];   // from throat downward
  for (let k = 0; k <= arcSamples; k++) {   // downstream throat arc
    const a = (k / arcSamples) * thetaN * DEG;
    down.push([rt + 0.382 * rt * (1 - Math.cos(a)), 0.382 * rt * Math.sin(a)]);
  }
  for (let k = 1; k <= bellSamples; k++) {  // bell
    const t = k / bellSamples;
    const r = (1 - t) * (1 - t) * rN + 2 * t * (1 - t) * rQ + t * t * rE;
    const d = (1 - t) * (1 - t) * dN + 2 * t * (1 - t) * dQ + t * t * dE;
    down.push([r, d]);
  }
  const up = [];     // from throat upward: converging arc, cone, chamber, injector dome
  const convA = 30 * DEG;
  for (let k = 1; k <= arcSamples; k++) {
    const a = (k / arcSamples) * convA;
    up.push([rt + 1.5 * rt * (1 - Math.cos(a)), -1.5 * rt * Math.sin(a)]);
  }
  const [rc0, dc0] = up[up.length - 1];
  const coneLen = (chamberR - rc0) / Math.tan(convA);
  up.push([chamberR, dc0 - coneLen]);
  up.push([chamberR, dc0 - coneLen - chamberLen]);
  up.push([chamberR * 0.75, dc0 - coneLen - chamberLen - chamberR * 0.25]);
  up.push([0.001, dc0 - coneLen - chamberLen - chamberR * 0.35]);
  // place: top of the dome at z = top
  const dTop = up[up.length - 1][1];
  const toZ = (d) => top - (d - dTop);
  const prof = [];
  // exit lip: a small outward roll so the edge reads as a thick rim
  prof.push([rE + lip, toZ(dE) + lip * 0.5]);
  for (let i = down.length - 1; i >= 0; i--) prof.push([down[i][0], toZ(down[i][1])]);
  for (const p of up) prof.push([p[0], toZ(p[1])]);
  return { profile: prof, throatZ: toZ(0), exitZ: toZ(dE) };
}

/** Collects static geometry per material and merges it into one mesh per material. */
export class PartBuilder {
  constructor() { this.byMat = new Map(); }
  add(geometry, material, matrix = null) {
    let g = geometry.clone();
    if (!g.index) g = indexed(g);
    if (matrix) g.applyMatrix4(matrix);
    if (!this.byMat.has(material)) this.byMat.set(material, []);
    this.byMat.get(material).push(stripAttrs(g));
    return this;
  }
  mesh(geometry, material, { pos = [0, 0, 0], rot = null, quat = null, scale = null } = {}) {
    const m = new THREE.Matrix4();
    const q = quat || (rot ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot, 'ZYX')) : new THREE.Quaternion());
    m.compose(new THREE.Vector3(...pos), q, scale ? new THREE.Vector3(...scale) : new THREE.Vector3(1, 1, 1));
    return this.add(geometry, material, m);
  }
  build(name = 'static') {
    const group = new THREE.Group();
    group.name = name;
    for (const [mat, list] of this.byMat) {
      const merged = mergeGeometries(list, false);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.name = `${name}:${mat.name || 'mat'}`;
      group.add(mesh);
    }
    return group;
  }
}
function indexed(g) {
  const n = g.attributes.position.count;
  g.setIndex([...Array(n).keys()]);
  return g;
}
function stripAttrs(g) {
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return g;
}

/** Matrix that takes the unit Y-axis cylinder of three.js to run from a to b. */
export function between(a, b, radiusScale = 1) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(radiusScale, len, radiusScale));
}
export const unitCyl = (seg = 12) => new THREE.CylinderGeometry(1, 1, 1, seg, 1, false);

/** Point on a cylinder of radius r at azimuth az and height z. */
export const onHull = (r, az, z) => [r * Math.cos(az), r * Math.sin(az), z];
/** Quaternion that turns a part so its local +X faces outward at azimuth az. */
export const facing = (az) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), az);

// ---------------- plumes ----------------
function plumeMaterial(hex) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(hex) }, uI: { value: 0 }, uT: { value: 0 } },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uColor; uniform float uI; uniform float uT; varying vec2 vUv;
      void main(){
        #include <logdepthbuf_fragment>
        float along = vUv.y;
        float core = pow(along, 2.2);
        float flicker = 0.85 + 0.15 * sin(uT * 47.0 + vUv.x * 30.0);
        gl_FragColor = vec4(uColor * core * uI * flicker, 1.0);
      }`,
  });
}
/** Plume cone: base at the node origin, extending along the node's local -Z. */
export function makePlume(radius, length, hex) {
  const g = new THREE.ConeGeometry(radius, length, 24, 1, true);
  g.translate(0, -length / 2, 0);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, plumeMaterial(hex));
  m.frustumCulled = false;
  m.name = 'plume';
  m.visible = false;
  return m;
}

/** Thrust exit node at `pos`, thrusting along `thrustDir` (exhaust opposite). */
export function exitNode(name, pos, thrustDir) {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(...pos);
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...thrustDir).normalize());
  return o;
}

/** Debug marker: a black/yellow quartered sphere (centre of mass convention). */
export function comMarker(radius = 0.6) {
  const g = new THREE.SphereGeometry(radius, 24, 16);
  const p = g.attributes.position, col = [];
  for (let i = 0; i < p.count; i++) {
    const s = Math.sign(p.getX(i) || 1) * Math.sign(p.getY(i) || 1) * Math.sign(p.getZ(i) || 1);
    const c = s > 0 ? [1, 0.82, 0.1] : [0.05, 0.05, 0.05];
    col.push(...c);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, depthTest: false }));
  m.renderOrder = 999;
  return m;
}
