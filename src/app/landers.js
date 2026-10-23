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

// ---------------- Starship HLS ----------------
export function buildHLS(v) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const R = v.diameter / 2, H = v.height;
  const zBase = 2.6;            // bottom of the hull above the footpads
  const zNose = H - 8.5;        // start of the nose fairing
  const zCabin = H - 12.5;      // cabin floor
  const zPods = zCabin - 2.2;   // landing thruster pods, just below the cabin
  const zAirlock = zPods - 6;   // airlock / elevator door

  // Hull: dark engine section, white barrel, rounded nose fairing
  body.add(lathe([[R * 0.97, zBase], [R, zBase + 0.6], [R, zBase + 4.2]], mat.dark));
  body.add(lathe([[R, zBase + 4.2], [R, zNose]], mat.white));
  const nose = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;                         // tangent ogive with a blunt cap
    const r = R * Math.sqrt(Math.max(0, 1 - Math.pow(t, 2.2))) * (1 - 0.08 * t);
    nose.push([Math.max(r, t > 0.97 ? 0 : 1.1), zNose + t * (H - zNose)]);
  }
  nose[nose.length - 1] = [0, H];
  body.add(lathe(nose, mat.white));
  // Docking port on the nose
  const port = lathe([[0.95, H - 0.9], [0.95, H - 0.3], [0.7, H - 0.05], [0, H - 0.05]], mat.grey, 32);
  body.add(port);
  // Hull seams (rings) for scale
  for (let z = zBase + 9; z < zNose; z += 9) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R + 0.005, 0.03, 4, 64), mat.grey);
    ring.position.z = z; body.add(ring);
  }

  // Crew cabin windows: a row facing +X, above the pods
  for (let k = -2; k <= 2; k++) {
    const a = k * 0.12;
    const w = box(0.12, 0.75, 0.55, mat.glass);
    onRing(w, a, R + 0.02, zCabin + 2.3);
    body.add(w);
  }

  // Landing thruster pods: 6 pods x 3 thrusters, nozzles angled down and out
  const thrusterMounts = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    const pod = box(1.1, 1.9, 2.2, mat.white);
    onRing(pod, a, R + 0.5, zPods);
    body.add(pod);
    const cap = box(1.12, 1.92, 0.25, mat.dark);
    onRing(cap, a, R + 0.5, zPods - 1.1);
    body.add(cap);
    for (let j = -1; j <= 1; j++) {
      const n = bell(0.12, 0.28, 0.55);
      const ca = a + j * 0.075;
      n.position.set(Math.cos(ca) * (R + 0.75), Math.sin(ca) * (R + 0.75), zPods - 1.2);
      body.add(n);
    }
    thrusterMounts.push({ pos: new THREE.Vector3(Math.cos(a) * (R + 0.75), Math.sin(a) * (R + 0.75), zPods - 1.7), angle: a });
  }

  // Solar arrays: five positions at 60 deg, the +X position kept clear.
  // Stowed flat against the hull for flight; they swing out and face the Sun after landing.
  const arrays = [];
  for (let k = 1; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const hinge = new THREE.Group();
    hinge.position.set(Math.cos(a) * (R + 0.12), Math.sin(a) * (R + 0.12), zAirlock + 1);
    hinge.rotation.z = a;
    const panelGroup = new THREE.Group();
    hinge.add(panelGroup);
    const panel = box(0.08, 2.6, 15.5, mat.cell);
    panel.position.set(0, 0, -7.75);
    panelGroup.add(panel);
    // cell grid lines
    for (let s = 1; s < 8; s++) {
      const line = box(0.09, 2.62, 0.04, mat.grey);
      line.position.set(0, 0, -s * 1.94);
      panelGroup.add(line);
    }
    body.add(hinge);
    arrays.push({ hinge, panelGroup, angle: a });
  }

  // Airlock door and elevator on +X
  const door = box(0.14, 2.6, 3.2, mat.dark);
  onRing(door, 0, R + 0.03, zAirlock);
  body.add(door);
  const railL = rod([R + 0.25, -1.0, zBase + 0.5], [R + 0.25, -1.0, zAirlock + 1.6], 0.07, mat.grey);
  const railR = rod([R + 0.25, 1.0, zBase + 0.5], [R + 0.25, 1.0, zAirlock + 1.6], 0.07, mat.grey);
  body.add(railL, railR);
  const elevator = new THREE.Group();
  const floor = box(2.4, 2.2, 0.12, mat.grey);
  floor.position.set(R + 1.4, 0, 0);
  elevator.add(floor);
  for (const [x, y] of [[R + 0.3, -1.05], [R + 0.3, 1.05], [R + 2.5, -1.05], [R + 2.5, 1.05]]) {
    elevator.add(rod([x, y, 0], [x, y, 2.2], 0.05, mat.grey));
  }
  elevator.add(rod([R + 2.5, -1.05, 2.2], [R + 2.5, 1.05, 2.2], 0.05, mat.grey));
  elevator.position.z = zAirlock - 1.5;
  body.add(elevator);

  // Engines: 3 sea-level Raptors in the middle, 3 vacuum Raptors outside
  const bellPos = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const b = bell(0.32, 0.65, 1.6);
    b.position.set(Math.cos(a) * 1.1, Math.sin(a) * 1.1, zBase + 0.6);
    body.add(b);
    bellPos.push(new THREE.Vector3(b.position.x, b.position.y, zBase - 1.0));
  }
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 3;
    const b = bell(0.32, 1.15, 2.4);
    b.position.set(Math.cos(a) * 2.9, Math.sin(a) * 2.9, zBase + 1.2);
    body.add(b);
  }

  // Four landing legs, deployed (folded flush to the hull for launch)
  for (let k = 0; k < v.legCount; k++) {
    const a = (k / v.legCount) * Math.PI * 2 + Math.PI / 4;
    const c = Math.cos(a), s = Math.sin(a);
    const fx = c * v.legRadius, fy = s * v.legRadius;
    // primary strut from high on the hull, secondary strut from the skirt
    body.add(rod([c * (R - 0.15), s * (R - 0.15), zBase + 11], [fx, fy, 0.5], 0.38, mat.steel));
    body.add(rod([c * (R - 0.1), s * (R - 0.1), zBase + 2.0], [fx * 0.97, fy * 0.97, 0.6], 0.26, mat.steel));
    // fairing strip on the hull where the leg stows
    const strip = box(0.25, 1.1, 10, mat.grey);
    onRing(strip, a, R + 0.01, zBase + 6.5);
    body.add(strip);
    const pad = lathe([[1.5, 0], [1.55, 0.18], [1.2, 0.4], [0, 0.42]], mat.steel, 24);
    pad.position.set(fx, fy, 0);
    body.add(pad);
  }

  body.traverse(o => { if (o.isMesh) o.castShadow = true; });

  const main = bellPos.map(p => { const pl = makePlume(1.0, 30, 0x8fb4ff); pl.position.copy(p); body.add(pl); return pl; });
  const landing = thrusterMounts.map(({ pos }) => {
    const pl = makePlume(0.6, 12, 0xffd9a8);
    pl.position.copy(pos);
    const out = new THREE.Vector3(pos.x, pos.y, 0).normalize();
    pl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(out.x * 0.3, out.y * 0.3, -0.95).normalize());
    body.add(pl);
    return pl;
  });

  // Post-landing deployment: arrays swing out to face the Sun, elevator descends
  const elevTop = zAirlock - 1.5, elevBottom = 0.2;
  function setDeploy(t, sunAzLocal) {
    const u = THREE.MathUtils.smoothstep(t, 0, 0.6);
    for (const arr of arrays) {
      arr.panelGroup.position.x = 1.3 * u;              // stand off from the hull
      // rotate each panel about its own vertical axis to face the Sun
      const face = sunAzLocal - arr.angle;
      arr.panelGroup.rotation.z = face * u;
    }
    const e = THREE.MathUtils.smoothstep(t, 0.5, 1);
    elevator.position.z = elevTop + (elevBottom - elevTop) * e;
  }

  return { root, plumes: { main, landing }, cabinZ: zCabin + 2.3, cabinR: R, height: H, setDeploy };
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
