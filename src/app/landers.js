// Lander models. Origin = centre of the footpad circle on the ground; +Z = body
// axis (thrust direction); +X = the side the crew windows and the elevator face.
//
// Starship HLS follows the published lunar configuration: 52 m stainless hull
// painted white except the dark engine section, a rounded nose fairing with a
// docking port, crew cabin and windows high on the body, 18 landing thrusters
// in six pods just below the cabin, five deployable solar arrays (the sixth
// position left clear for the elevator and the pilots' view), four landing legs
// that fold flush against the hull, an airlock with a crew elevator running down
// the side, and six Raptors (three sea-level in the middle, three vacuum outside).
//
// Blue Moon MK2 follows Blue Origin's published layout: ~16 m tall, crew cabin
// on top of the hydrogen and oxygen tanks, three BE-7 engines, four legs, solar
// arrays on the sides. Blue Origin has released far less detail, so its
// proportions are an approximation (see docs/ASSUMPTIONS.md).
//
// Neither model carries logos or markings.

import * as THREE from 'three';
import { buildHLS } from './models/hls.js';

const mat = {
  white: new THREE.MeshStandardMaterial({ color: 0xeceae6, metalness: 0.05, roughness: 0.55 }),
  steel: new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.9, roughness: 0.3 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x1c1e22, metalness: 0.3, roughness: 0.65 }),
  nozzle: new THREE.MeshStandardMaterial({ color: 0x3a3532, metalness: 0.7, roughness: 0.4, side: THREE.DoubleSide }),
  glass: new THREE.MeshStandardMaterial({ color: 0x0a0d12, metalness: 0.9, roughness: 0.08 }),
  cell: new THREE.MeshStandardMaterial({ color: 0x15233d, metalness: 0.5, roughness: 0.25, side: THREE.DoubleSide }),
  gold: new THREE.MeshStandardMaterial({ color: 0xc69a45, metalness: 0.75, roughness: 0.4 }),
  grey: new THREE.MeshStandardMaterial({ color: 0x8d9097, metalness: 0.4, roughness: 0.5 }),
};

// ---------------- helpers ----------------
function lathe(profile, material, segments = 64) {
  // profile: [[radius, z], ...] bottom to top; LatheGeometry is Y-up, so rotate to Z-up
  const g = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, z)), segments);
  g.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(g, material);
  return m;
}
function box(w, d, h, material) { return new THREE.Mesh(new THREE.BoxGeometry(w, d, h), material); }
function rod(from, to, r, material) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 10), material);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}
function bell(throatR, exitR, length, material = mat.nozzle) {
  // nozzle opening downward, top at z = 0
  return lathe([[exitR, -length], [throatR * 1.15, -length * 0.25], [throatR, 0]], material, 32);
}
function onRing(obj, angle, radius, z) {
  obj.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, z);
  obj.rotation.z = angle;
  return obj;
}

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
        float along = vUv.y;                // 1 at the nozzle exit, 0 at the tail
        float core = pow(along, 2.2);
        float flicker = 0.85 + 0.15 * sin(uT * 47.0 + vUv.x * 30.0);
        gl_FragColor = vec4(uColor * core * uI * flicker, 1.0);
      }`,
  });
}
function makePlume(radius, length, hex) {
  const g = new THREE.ConeGeometry(radius, length, 24, 1, true);
  g.translate(0, -length / 2, 0);
  g.rotateX(-Math.PI / 2); // axis to -Z
  const m = new THREE.Mesh(g, plumeMaterial(hex));
  m.frustumCulled = false;
  return m;
}

// ---------------- Blue Moon MK2 ----------------
export function buildBlueMoon(v) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const H = v.height;
  const zBase = 2.0;
  // Aft propulsion module (oxygen tanks, thrust structure), wrapped in gold MLI
  body.add(lathe([[2.9, zBase], [3.1, zBase + 0.4], [3.1, zBase + 2.8], [2.8, zBase + 3.2]], mat.gold, 8));
  // Hydrogen tank: tall white barrel
  body.add(lathe([[2.75, zBase + 3.2], [2.75, zBase + 9.6], [2.5, zBase + 10.2]], mat.white, 48));
  // Equipment ring with radiators
  body.add(lathe([[2.5, zBase + 10.2], [2.6, zBase + 10.4], [2.6, zBase + 11.0], [2.2, zBase + 11.2]], mat.grey, 48));
  // Crew cabin on top, with windows facing +X and a docking port
  const zCab = zBase + 11.2;
  body.add(lathe([[2.2, zCab], [2.2, zCab + 2.0], [1.7, zCab + 2.5], [0.9, zCab + 2.7]], mat.white, 48));
  body.add(lathe([[0.75, zCab + 2.7], [0.75, zCab + 2.95], [0, zCab + 2.95]], mat.grey, 24));
  for (let k = -1; k <= 1; k++) {
    const w = box(0.1, 0.55, 0.5, mat.glass);
    onRing(w, k * 0.22, 2.21, zCab + 1.3);
    body.add(w);
  }
  const hatch = box(0.1, 1.0, 1.4, mat.dark);
  onRing(hatch, Math.PI / 2, 2.21, zCab + 0.9);
  body.add(hatch);
  // Ladder from the hatch side down to the footpad
  body.add(rod([0, 2.95, zCab + 0.2], [0, 4.6, 0.3], 0.05, mat.grey));
  body.add(rod([0.5, 2.95, zCab + 0.2], [0.5, 4.6, 0.3], 0.05, mat.grey));
  // Solar arrays: two wings on the sides
  for (const s of [-1, 1]) {
    const boom = rod([s * 2.75, 0, zBase + 7], [s * 3.6, 0, zBase + 7], 0.08, mat.grey);
    const wing = box(0.06, 3.0, 5.2, mat.cell);
    wing.position.set(s * 3.66, 0, zBase + 7);
    body.add(boom, wing);
  }
  // Three BE-7 engines
  const bellPos = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 2;
    const b = bell(0.18, 0.5, 1.4);
    b.position.set(Math.cos(a) * 1.0, Math.sin(a) * 1.0, zBase + 0.1);
    body.add(b);
    bellPos.push(new THREE.Vector3(b.position.x, b.position.y, zBase - 1.3));
  }
  // Four legs
  for (let k = 0; k < v.legCount; k++) {
    const a = (k / v.legCount) * Math.PI * 2 + Math.PI / 4;
    const c = Math.cos(a), s = Math.sin(a);
    const fx = c * v.legRadius, fy = s * v.legRadius;
    body.add(rod([c * 2.9, s * 2.9, zBase + 3.0], [fx, fy, 0.35], 0.2, mat.steel));
    body.add(rod([c * 2.8, s * 2.8, zBase + 0.3], [fx * 0.96, fy * 0.96, 0.4], 0.14, mat.steel));
    const pad = lathe([[0.85, 0], [0.9, 0.12], [0.6, 0.28], [0, 0.3]], mat.steel, 20);
    pad.position.set(fx, fy, 0);
    body.add(pad);
  }
  body.traverse(o => { if (o.isMesh) o.castShadow = true; });
  // Hydrogen/oxygen exhaust is almost invisible in vacuum: a faint violet-blue
  const main = bellPos.map(p => { const pl = makePlume(0.7, 14, 0x9b8cff); pl.position.copy(p); body.add(pl); return pl; });
  return { root, plumes: { main, landing: [] }, cabinZ: zCab + 1.3, cabinR: 2.2, height: H, setDeploy() {} };
}

/**
 * Build the visual model for a vehicle. Every model shares one interface:
 * root, plumes { main[], landing[] }, cabinZ, cabinR, height, setDeploy(t, sunAz),
 * and optionally setLegs(t), setFinish(f), setDebug(on), parts, nodes, com,
 * cockpitMount, collision. See src/app/models/common.js for the conventions.
 */
export function buildLander(v, opts = {}) {
  return v.id === 'hls' ? buildHLS(v, opts) : buildBlueMoon(v);
}

/** Drive plume brightness/length from engine state. */
export function updatePlumes(model, sim, time) {
  const active = sim.activeEngines;
  const thr = sim.throttle;
  for (const key of ['main', 'landing']) {
    const list = model.plumes[key];
    const on = sim.engine === key && thr > 0.02 && sim.prop > 0;
    list.forEach((pl, i) => {
      // main engines light one bell per running engine; thrusters fire as a ring
      const lit = on && (key === 'landing' || i < active);
      const intensity = lit ? (0.35 + 0.65 * Math.min(1, thr * list.length / Math.max(1, active))) : 0;
      pl.material.uniforms.uI.value = intensity * (key === 'main' ? 0.55 : 0.8);
      pl.material.uniforms.uT.value = time;
      pl.scale.setScalar(lit ? 0.6 + 0.6 * Math.min(1, thr * 1.5) : 0.001);
      pl.visible = lit;
    });
  }
}
