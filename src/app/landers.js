// Vehicle models and engine plumes. Origin = centre of the footpad circle;
// +Z = body axis (thrust direction). Proportions follow published dimensions;
// details are simplified and carry no branding.

import * as THREE from 'three';

function steel(color) {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness: 0.32, envMapIntensity: 1.0 });
}
const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d22, metalness: 0.2, roughness: 0.7 });
const gold = new THREE.MeshStandardMaterial({ color: 0xb88a3a, metalness: 0.6, roughness: 0.45 });
const panel = new THREE.MeshStandardMaterial({ color: 0x1a2742, metalness: 0.3, roughness: 0.35 });

function plumeMaterial(hex) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(hex) }, uI: { value: 0 }, uT: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uI; uniform float uT; varying vec2 vUv;
      void main(){
        float along = vUv.y;                // 1 at the nozzle exit, 0 at the tail
        float core = pow(along, 2.2);
        float flicker = 0.85 + 0.15 * sin(uT * 47.0 + vUv.x * 30.0);
        gl_FragColor = vec4(uColor * core * uI * flicker, 1.0);
      }`,
  });
}

function makePlume(radius, length, hex) {
  // Open cone, apex down at -length, base at the nozzle
  const g = new THREE.ConeGeometry(radius, length, 24, 1, true);
  g.translate(0, -length / 2, 0);
  g.rotateX(-Math.PI / 2); // cone axis to -Z
  const m = new THREE.Mesh(g, plumeMaterial(hex));
  m.frustumCulled = false;
  return m;
}

function leg(from, to, r = 0.25, mat) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, 8);
  const m = new THREE.Mesh(g, mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

export function buildHLS(v) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const R = v.diameter / 2, H = v.height;
  const skin = steel(v.color);
  const base = 3.2; // body bottom above footpads
  // Main tank section
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H - base - 9, 48), skin);
  tank.rotation.x = Math.PI / 2; tank.position.z = base + (H - base - 9) / 2;
  body.add(tank);
  // Nose
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.9, R, 9, 48), skin);
  nose.rotation.x = Math.PI / 2; nose.position.z = H - 4.5;
  body.add(nose);
  // Solar array band around the upper body
  const sa = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.05, R + 0.05, 6, 48, 1, true), panel);
  sa.rotation.x = Math.PI / 2; sa.position.z = H - 15;
  body.add(sa);
  // Crew windows and airlock door
  for (let k = 0; k < 6; k++) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.9, 0.6), dark);
    const a = -0.5 + k * 0.2;
    w.position.set(Math.cos(a) * (R + 0.02), Math.sin(a) * (R + 0.02), H - 9.8);
    w.rotation.z = a;
    body.add(w);
  }
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.2, 3.0), dark);
  door.position.set(R + 0.02, 0, H - 12.5); body.add(door);
  // Landing thruster ring (mid-body)
  const ringZ = H * 0.70;
  const thrusterMounts = [];
  const nT = 8; // visual pods (each pod = 3 thrusters in the config)
  for (let k = 0; k < nT; k++) {
    const a = (k / nT) * Math.PI * 2 + 0.2;
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.3, 1.6), dark);
    pod.position.set(Math.cos(a) * (R + 0.35), Math.sin(a) * (R + 0.35), ringZ);
    pod.rotation.z = a;
    body.add(pod);
    thrusterMounts.push(new THREE.Vector3(Math.cos(a) * (R + 0.6), Math.sin(a) * (R + 0.6), ringZ - 0.8));
  }
  // Aft skirt + Raptor bells
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.96, 2.2, 48, 1, true), dark);
  skirt.rotation.x = Math.PI / 2; skirt.position.z = base + 1.1; body.add(skirt);
  const bellPos = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.65, 1.6, 20, 1, true), dark);
    bell.rotation.x = Math.PI / 2;
    bell.position.set(Math.cos(a) * 1.1, Math.sin(a) * 1.1, base - 0.3);
    body.add(bell);
    bellPos.push(new THREE.Vector3(bell.position.x, bell.position.y, base - 1.1));
  }
  // Legs
  for (let k = 0; k < v.legCount; k++) {
    const a = (k / v.legCount) * Math.PI * 2 + Math.PI / v.legCount;
    const fx = Math.cos(a) * v.legRadius, fy = Math.sin(a) * v.legRadius;
    body.add(leg([Math.cos(a) * (R - 0.3), Math.sin(a) * (R - 0.3), base + 7], [fx, fy, 0.4], 0.32, skin));
    body.add(leg([Math.cos(a) * (R - 0.3), Math.sin(a) * (R - 0.3), base + 0.5], [fx * 0.98, fy * 0.98, 0.4], 0.2, skin));
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 0.25, 16), skin);
    pad.rotation.x = Math.PI / 2; pad.position.set(fx, fy, 0.12);
    body.add(pad);
  }
  body.traverse(o => { if (o.isMesh) { o.castShadow = true; } });

  // Plumes
  const main = bellPos.map(p => { const pl = makePlume(1.0, 30, 0x8fb4ff); pl.position.copy(p); body.add(pl); return pl; });
  const landing = thrusterMounts.map(p => {
    const pl = makePlume(0.5, 10, 0xffd9a8);
    pl.position.copy(p);
    // angle the jets 20 deg outward from straight down, keeps the blast off the regolith
    const out = new THREE.Vector3(p.x, p.y, 0).normalize();
    pl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(out.x * 0.34, out.y * 0.34, -0.94).normalize());
    body.add(pl);
    return pl;
  });
  return { root, plumes: { main, landing }, cabinZ: H - 9.8, cabinR: R, height: H };
}

export function buildBlueMoon(v) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const R = v.diameter / 2, H = v.height;
  const skin = steel(v.color);
  const base = 2.2;
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.82, R * 0.82, 8.5, 6), skin);
  tank.rotation.x = Math.PI / 2; tank.rotation.y = Math.PI / 6; tank.position.z = base + 4.25; body.add(tank);
  const foil = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.84, R * 0.84, 2.2, 6, 1, true), gold);
  foil.rotation.x = Math.PI / 2; foil.position.z = base + 1.2; body.add(foil);
  const cabin = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.5, R * 0.62, 4.2, 24), skin);
  cabin.rotation.x = Math.PI / 2; cabin.position.z = base + 8.5 + 2.1; body.add(cabin);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.3, R * 0.5, 1.4, 24), skin);
  top.rotation.x = Math.PI / 2; top.position.z = base + 8.5 + 4.9; body.add(top);
  for (let k = 0; k < 4; k++) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.4), dark);
    const a = k * 0.35 - 0.5;
    w.position.set(Math.cos(a) * R * 0.56, Math.sin(a) * R * 0.56, base + 11.5); w.rotation.z = a; body.add(w);
  }
  // Solar wings
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.08, 4.5, 3.2), panel);
    wing.position.set(0, s * (R * 0.82 + 2.4), base + 6.5); body.add(wing);
  }
  const bellPos = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.42, 1.1, 18, 1, true), dark);
    bell.rotation.x = Math.PI / 2;
    bell.position.set(Math.cos(a) * 0.9, Math.sin(a) * 0.9, base - 0.4);
    body.add(bell);
    bellPos.push(new THREE.Vector3(bell.position.x, bell.position.y, base - 0.95));
  }
  for (let k = 0; k < v.legCount; k++) {
    const a = (k / v.legCount) * Math.PI * 2 + Math.PI / 4;
    const fx = Math.cos(a) * v.legRadius, fy = Math.sin(a) * v.legRadius;
    body.add(leg([Math.cos(a) * R * 0.7, Math.sin(a) * R * 0.7, base + 3.5], [fx, fy, 0.3], 0.18, skin));
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.2, 14), skin);
    pad.rotation.x = Math.PI / 2; pad.position.set(fx, fy, 0.1); body.add(pad);
  }
  body.traverse(o => { if (o.isMesh) o.castShadow = true; });
  // Hydrogen/oxygen exhaust is nearly invisible in vacuum: a faint violet-blue
  const main = bellPos.map(p => { const pl = makePlume(0.7, 14, 0x9b8cff); pl.position.copy(p); body.add(pl); return pl; });
  return { root, plumes: { main, landing: [] }, cabinZ: base + 11.5, cabinR: R * 0.56, height: H };
}

export function buildLander(v) {
  return v.id === 'hls' ? buildHLS(v) : buildBlueMoon(v);
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
