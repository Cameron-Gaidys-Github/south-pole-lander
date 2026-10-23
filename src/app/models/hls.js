// Starship HLS, procedural model.
//
// Configuration: the 2023 lunar Starship depiction (white hull, black engine
// section, rounded nose fairing with docking port, crew windows and airlock on
// the elevator side, 18 landing thrusters in six pods below the cabin, five
// solar array bays with the sixth slot left clear for the elevator, four legs
// that stow flush), with SpaceX's published facts (9 m diameter, 3 sea-level +
// 3 vacuum Raptors, dual airlocks, crew elevator, Dragon-derived docking).
// Every number, its source and confidence: docs/MODELS.md.
//
// Interface (shared with every lander model):
//   root, plumes { main[], landing[] }, cabinZ, cabinR, height,
//   setDeploy(t, sunAz)  post-landing: array bays open, arrays unfurl, elevator lowers
//   setLegs(t)           0 stowed flush, 1 deployed
//   setFinish('paint' | 'steel'), setDebug(bool)
//   parts { legs[], elevator, nozzles { sl[], vac[] }, solarArrays[] }
//   nodes { mainExits[], vacExits[], thrusters[], rcs[], sensors[] }, com, cockpitMount, collision
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { latheZ, rocketEngineProfile, PartBuilder, between, unitCyl, onHull, facing, makePlume, exitNode, comMarker, TAU, DEG } from './common.js';
import { barrelMaps, noseMaps, aftMaps, nozzleMaps, solarMaps, blanketMaps, brushedMaps } from './textures.js';

/** Heights above the footpad plane (m). */
export const HLS_LAYOUT = {
  base: 3.2,            // bottom of the aft skirt
  aftTop: 8.7,          // top of the black engine section
  hinge: 18.0,          // landing leg hinge
  hatch: [28.6, 31.4],  // airlock outer hatch (sill, top)
  bays: [29.0, 32.6],   // solar array bays
  pods: 34.6,           // landing thruster pods (centre)
  windows: 38.1,        // crew window row (centre)
  nose: 40.8,           // start of the nose fairing
  ringPitch: 1.83,      // stainless ring height
};
const SL_AZ = [30, 150, 270].map(d => d * DEG);     // sea-level Raptors on the centre thrust puck
const VAC_AZ = [90, 210, 330].map(d => d * DEG);    // Raptor Vacuum on the aft dome
const POD_AZ = [30, 90, 150, 210, 270, 330].map(d => d * DEG);
const BAY_AZ = [60, 120, 180, 240, 300].map(d => d * DEG);   // the 0° slot is the elevator
const RAPTOR = {
  sl: { rt: 0.115, re: 0.65, bellLen: 1.55, chamberR: 0.24, chamberLen: 0.35, thetaN: 30, thetaE: 8, ring: 1.05 },
  vac: { rt: 0.125, re: 1.2, bellLen: 3.2, chamberR: 0.24, chamberLen: 0.35, thetaN: 33, thetaE: 6, ring: 3.0 },
};

// ---------------- materials ----------------
const shared = {};
function sharedMaterials() {
  if (shared.ready) return shared;
  const brushed = brushedMaps();
  const nSL = nozzleMaps({ vac: false }), nVac = nozzleMaps({ vac: true });
  const sol = solarMaps({ w: 1024, h: 256, cellsU: 64, cellsV: 8 }), blanket = blanketMaps(), gold = blanketMaps({ tint: [196, 150, 70], quilt: 12, seed: 43 });
  const aft = aftMaps();
  Object.assign(shared, {
    aft: new THREE.MeshStandardMaterial({ name: 'aftPaint', ...aft, roughness: 1, metalness: 0.1 }),
    trimDark: new THREE.MeshStandardMaterial({ name: 'trimDark', color: 0x2a2c30, roughness: 0.6, metalness: 0.2 }),
    steel: new THREE.MeshPhysicalMaterial({ name: 'steel', color: 0x8f949b, metalness: 1, roughness: 1.5, roughnessMap: brushed.roughnessMap, anisotropy: 0.6, envMapIntensity: 0.6 }),
    padSteel: new THREE.MeshStandardMaterial({ name: 'padSteel', color: 0x9a9da2, metalness: 0.85, roughness: 0.55, envMapIntensity: 0.7 }),
    chrome: new THREE.MeshPhysicalMaterial({ name: 'chrome', color: 0xdfe2e6, metalness: 1, roughness: 0.12 }),
    alu: new THREE.MeshPhysicalMaterial({ name: 'aluminium', color: 0xb9bdc3, metalness: 1, roughness: 0.38 }),
    nozzleSL: new THREE.MeshPhysicalMaterial({ name: 'nozzleSL', ...nSL, roughness: 1, metalness: 0.9, side: THREE.FrontSide }),
    nozzleVac: new THREE.MeshPhysicalMaterial({ name: 'nozzleVac', ...nVac, roughness: 1, metalness: 0.85 }),
    soot: new THREE.MeshStandardMaterial({ name: 'soot', color: 0x141210, roughness: 0.85, metalness: 0.3 }),
    glass: new THREE.MeshPhysicalMaterial({ name: 'glass', color: 0x06080b, metalness: 0, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, reflectivity: 0.6 }),
    frame: new THREE.MeshStandardMaterial({ name: 'frame', color: 0x3b3e43, roughness: 0.45, metalness: 0.5 }),
    solar: new THREE.MeshStandardMaterial({ name: 'solar', ...sol, roughness: 1, metalness: 0.35 }),
    blanket: new THREE.MeshStandardMaterial({ name: 'blanket', ...blanket, roughness: 1, metalness: 0.05, side: THREE.DoubleSide }),
    gold: new THREE.MeshStandardMaterial({ name: 'goldMLI', ...gold, roughness: 1, metalness: 0.65 }),
    black: new THREE.MeshStandardMaterial({ name: 'black', color: 0x0d0e10, roughness: 0.7, metalness: 0.1 }),
    debug: new THREE.MeshBasicMaterial({ name: 'debug', color: 0x39ff88, wireframe: true, transparent: true, opacity: 0.5 }),
  });
  shared.ready = true;
  return shared;
}

const hullCache = new Map();
function hullMaterials(v, finish) {
  const key = `${finish}:${v.diameter}`;
  if (hullCache.has(key)) return hullCache.get(key);
  const R = v.diameter / 2, L = HLS_LAYOUT;
  const legs = [0, 1, 2, 3].map(k => ({ az: (k / 4) * TAU + Math.PI / 4, halfW: 0.6 / R, z0: L.aftTop - 0.1, z1: L.hinge + 0.9 }));
  const panels = [
    { az: 90 * DEG, z: 10.4, w: 1.2, h: 0.8 }, { az: 270 * DEG, z: 10.4, w: 1.2, h: 0.8 },
    { az: 180 * DEG, z: 12.6, w: 0.8, h: 0.8 }, { az: 0, z: 25.5, w: 1.6, h: 1.0 },
    ...POD_AZ.map(az => ({ az, z: 27.2, w: 0.7, h: 0.5 })),
  ];
  const stains = POD_AZ.map(az => ({ az, halfW: 0.7, z: L.pods - 1.4 }));
  const spec = { circ: TAU * R, z0: L.aftTop, z1: L.nose, ringPitch: L.ringPitch, sheets: 3, legs, panels, stains };
  const barrel = barrelMaps({ ...spec, finish });
  const nose = noseMaps({ finish });
  const steel = finish === 'steel';
  const common = steel
    ? { metalness: 1, roughness: 1, anisotropy: 0.75, anisotropyRotation: 0, clearcoat: 0 }
    : { metalness: 0, roughness: 1, clearcoat: 0.18, clearcoatRoughness: 0.4 };
  const out = {
    hull: new THREE.MeshPhysicalMaterial({ name: 'hull', ...barrel, ...common, normalScale: new THREE.Vector2(0.8, 0.8) }),
    nose: new THREE.MeshPhysicalMaterial({ name: 'nose', ...nose, ...common }),
    trimWhite: new THREE.MeshPhysicalMaterial(steel
      ? { name: 'trim', color: 0xc4c8ce, metalness: 1, roughness: 0.3, anisotropy: 0.5 }
      : { name: 'trim', color: 0xe9e7e2, metalness: 0, roughness: 0.5, clearcoat: 0.15 }),
  };
  hullCache.set(key, out);
  return out;
}

// ---------------- small geometry helpers ----------------
function roundedRect(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
/** Flat plate (rounded rect, w across, h tall) extruded outward along +X. */
function plate(w, h, r, depth, hole = null) {
  const s = roundedRect(w, h, r);
  if (hole) s.holes.push(roundedRect(hole[0], hole[1], hole[2]));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 6 });
  g.rotateY(Math.PI / 2);   // extrusion +Z -> +X; shape X -> -Z, so rotate the face upright
  g.rotateX(Math.PI / 2);
  return g;
}
const at = (r, az, z) => new THREE.Matrix4().compose(new THREE.Vector3(...onHull(r, az, z)), facing(az), new THREE.Vector3(1, 1, 1));
const atQ = (pos, q) => new THREE.Matrix4().compose(new THREE.Vector3(...pos), q, new THREE.Vector3(1, 1, 1));

/** Nose fairing radius at height z (superellipse blend from the barrel to the docking flat). */
function noseRadius(R, z0, z1, rTip, z) {
  const t = Math.min(1, Math.max(0, (z - z0) / (z1 - z0)));
  return rTip + (R - rTip) * Math.pow(1 - Math.pow(t, 1.9), 0.62);
}

function engineGeometry(spec, segments, { inner: withInner = true } = {}) {
  const { profile, exitZ, throatZ } = rocketEngineProfile({ ...spec, top: 0 });
  const outer = latheZ(profile, segments);
  const wall = Math.max(0.004, spec.re * 0.02);
  const inner = withInner ? latheZ(profile.map(([r, z]) => [Math.max(0.001, r - wall), z]), segments, { flip: true }) : null;
  return { outer, inner, exitZ, throatZ };
}

// ---------------- the model ----------------
export function buildHLS(v, { finish = 'paint' } = {}) {
  const S = sharedMaterials();
  let M = { ...S, ...hullMaterials(v, finish) };
  const R = v.diameter / 2, H = v.height, L = HLS_LAYOUT;
  const root = new THREE.Group(); root.name = 'StarshipHLS';
  const body = new THREE.Group(); body.name = 'body'; root.add(body);
  const rTip = 1.12, zFlat = H - 0.36;

  // ======== LOD 0: full detail ========
  const b0 = new PartBuilder();
  b0.add(latheZ([[R, L.aftTop], [R, L.nose]], 192), M.hull);
  b0.add(latheZ([[R * 0.986, L.base], [R, L.base + 0.22], [R, L.aftTop]], 160), M.aft);
  b0.add(latheZ([[R - 0.03, L.base + 0.05], [R - 0.03, L.aftTop - 0.2]], 96, { flip: true }), M.aft);   // inside of the skirt
  b0.add(latheZ([[R + 0.012, L.aftTop - 0.04], [R + 0.012, L.aftTop + 0.04]], 160), M.trimDark);       // paint break
  const noseProf = [];
  for (let i = 0; i <= 56; i++) { const z = L.nose + (zFlat - L.nose) * (i / 56); noseProf.push([noseRadius(R, L.nose, zFlat, rTip, z), z]); }
  noseProf.push([rTip, zFlat]); noseProf.push([0.001, zFlat]);
  b0.add(latheZ(noseProf, 192, { vRange: [L.nose, zFlat] }), M.nose);
  // Docking adapter (Dragon-derived androgynous system) on the nose
  b0.add(latheZ([[1.04, zFlat], [1.04, H - 0.17], [0.94, H - 0.1], [0.94, H - 0.03], [0.64, H - 0.03], [0.64, H - 0.14], [0.001, H - 0.14]], 96), M.alu);
  for (let k = 0; k < 3; k++) {
    const az = (k / 3) * TAU + Math.PI / 6;
    const m = at(0.8, az, H + 0.12).multiply(new THREE.Matrix4().makeRotationY(-14 * DEG));
    b0.add(new THREE.BoxGeometry(0.07, 0.36, 0.42), M.steel, m);
  }
  for (let k = 0; k < 12; k++) b0.add(new THREE.BoxGeometry(0.08, 0.1, 0.08), M.frame, at(0.97, (k / 12) * TAU, H - 0.02));

  // Crew windows: a row of five on the elevator side
  const winAz = [-2, -1, 0, 1, 2].map(k => k * 14.6 * DEG);
  for (const az of winAz) {
    b0.add(plate(1.08, 1.3, 0.2, 0.06, [0.9, 1.12, 0.14]), M.frame, at(R - 0.02, az, L.windows));
    b0.add(plate(0.9, 1.12, 0.14, 0.03), M.glass, at(R - 0.005, az, L.windows));
  }
  // two small upper windows (looking up for docking)
  for (const az of [-7.3 * DEG, 7.3 * DEG]) {
    const zc = L.windows + 1.25;
    b0.add(plate(0.5, 0.42, 0.12, 0.05, [0.38, 0.3, 0.08]), M.frame, at(R - 0.02, az, zc));
    b0.add(plate(0.38, 0.3, 0.08, 0.025), M.glass, at(R - 0.005, az, zc));
  }

  // Airlock outer hatch
  const hz = (L.hatch[0] + L.hatch[1]) / 2, hh = L.hatch[1] - L.hatch[0];
  b0.add(plate(1.78, hh + 0.26, 0.3, 0.08, [1.52, hh, 0.24]), M.frame, at(R - 0.03, 0, hz));
  b0.add(plate(1.5, hh - 0.04, 0.24, 0.05), M.trimWhite, at(R - 0.01, 0, hz));
  b0.add(new THREE.CylinderGeometry(0.15, 0.15, 0.04, 24).rotateZ(Math.PI / 2), M.glass, at(R + 0.04, 0, hz + 0.75));
  for (const dz of [-0.35, 0.35]) b0.add(unitCyl(8), M.steel, between(onHull(R + 0.12, 0.13, hz + dz - 0.25), onHull(R + 0.12, 0.13, hz + dz + 0.25), 0.025));
  // Elevator rails, standoffs and davit
  const railT = 1.15 / R;
  for (const s of [-1, 1]) {
    b0.add(new THREE.BoxGeometry(0.11, 0.11, L.hatch[1] + 0.5 - (L.base + 0.4)), M.steel, at(R + 0.2, s * railT, (L.hatch[1] + 0.5 + L.base + 0.4) / 2));
    for (let z = L.base + 0.8; z < L.hatch[1]; z += 2.4) b0.add(new THREE.BoxGeometry(0.2, 0.08, 0.16), M.frame, at(R + 0.08, s * railT, z));
  }
  const davitZ = L.hatch[1] + 0.75;
  b0.add(new RoundedBoxGeometry(0.6, 2.7, 0.55, 2, 0.08), M.trimWhite, at(R + 0.18, 0, davitZ));
  b0.add(new THREE.BoxGeometry(2.0, 0.24, 0.24), M.steel, at(R + 1.2, 0, davitZ + 0.05));
  for (const s of [-1, 1]) b0.add(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 16), M.steel, atQ([R + 2.1, s * 1.0, davitZ - 0.05], new THREE.Quaternion()));
  b0.add(new THREE.BoxGeometry(0.24, 2.2, 0.2), M.steel, at(R + 2.1, 0, davitZ));

  // Landing thruster pods (6 x 3 thrusters), just below the cabin
  const wedge = (() => {   // sloped fairing on top of each pod, blending it into the hull
    const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0.78, 0); sh.lineTo(0, 0.9); sh.lineTo(0, 0);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 1.9, bevelEnabled: false });
    g.translate(0, 0, -0.95); g.rotateX(Math.PI / 2);
    return g;
  })();
  for (const az of POD_AZ) {
    b0.add(new RoundedBoxGeometry(0.95, 2.05, 2.7, 3, 0.16), M.trimWhite, at(R + 0.36, az, L.pods));
    b0.add(wedge, M.trimWhite, at(R - 0.05, az, L.pods + 1.3));
    b0.add(new THREE.BoxGeometry(0.98, 2.08, 0.14), M.trimDark, at(R + 0.37, az, L.pods - 1.3));
    b0.add(new THREE.BoxGeometry(0.06, 1.7, 0.06), M.frame, at(R + 0.84, az, L.pods + 0.9));   // seam strip
  }
  // Solar array bay frames (doors are functional parts below)
  for (const az of BAY_AZ) b0.add(plate(2.5, 3.8, 0.18, 0.06, [2.24, 3.52, 0.14]), M.frame, at(R - 0.02, az, (L.bays[0] + L.bays[1]) / 2));
  // Antennas between the bays
  for (const az of POD_AZ) {
    const zc = (L.bays[0] + L.bays[1]) / 2;
    b0.add(new THREE.CylinderGeometry(0.2, 0.22, 0.08, 20).rotateZ(Math.PI / 2), M.frame, at(R + 0.03, az, zc));
    b0.add(new THREE.SphereGeometry(0.17, 20, 10, 0, TAU, 0, Math.PI / 2).rotateZ(-Math.PI / 2), M.trimWhite, at(R + 0.07, az, zc));
    b0.add(unitCyl(6), M.steel, between(onHull(R + 0.05, az + 0.03, zc + 0.2), onHull(R + 0.45, az + 0.03, zc + 1.1), 0.012));
  }
  // Leg hinge brackets and lower strut fittings
  for (let k = 0; k < 4; k++) {
    const az = (k / 4) * TAU + Math.PI / 4;
    b0.add(new RoundedBoxGeometry(0.5, 1.1, 1.0, 2, 0.06), M.steel, at(R + 0.12, az, L.hinge + 0.3));
    b0.add(new RoundedBoxGeometry(0.4, 0.9, 0.6, 2, 0.05), M.steel, at(R + 0.08, az, L.base + 1.4));
  }
  // Sensor pods (landing lidar / cameras) on the engine section
  for (const az of [100, 220, 340].map(d => d * DEG)) {
    b0.add(new RoundedBoxGeometry(0.5, 0.6, 0.55, 2, 0.06), M.gold, at(R + 0.2, az, L.base + 4.2));
    b0.add(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 20).rotateX(Math.PI / 2), M.glass, at(R + 0.25, az, L.base + 3.9));
  }
  // Engine bay: insulated shield plate with an opening per engine
  {
    const shape = new THREE.Shape(); shape.absarc(0, 0, R - 0.04, 0, TAU, false);
    for (const az of SL_AZ) { const h = new THREE.Path(); h.absarc(Math.cos(az) * RAPTOR.sl.ring, Math.sin(az) * RAPTOR.sl.ring, 0.34, 0, TAU, true); shape.holes.push(h); }
    for (const az of VAC_AZ) { const h = new THREE.Path(); h.absarc(Math.cos(az) * RAPTOR.vac.ring, Math.sin(az) * RAPTOR.vac.ring, 0.72, 0, TAU, true); shape.holes.push(h); }
    const g = new THREE.ShapeGeometry(shape, 48);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 9 + 0.5, p.getY(i) / 9 + 0.5);
    g.translate(0, 0, L.base + 2.1);
    b0.add(g, M.blanket);
    for (const az of SL_AZ) b0.add(new THREE.TorusGeometry(0.34, 0.05, 8, 32), M.frame, atQ([Math.cos(az) * RAPTOR.sl.ring, Math.sin(az) * RAPTOR.sl.ring, L.base + 2.08], new THREE.Quaternion()));
    for (const az of VAC_AZ) b0.add(new THREE.TorusGeometry(0.72, 0.06, 8, 40), M.frame, atQ([Math.cos(az) * RAPTOR.vac.ring, Math.sin(az) * RAPTOR.vac.ring, L.base + 2.08], new THREE.Quaternion()));
  }
  const lod0 = b0.build('lod0');

  // ======== LOD 1: medium (beyond ~120 m) ========
  const b1 = new PartBuilder();
  b1.add(latheZ([[R, L.aftTop], [R, L.nose]], 64), M.hull);
  b1.add(latheZ([[R * 0.986, L.base], [R, L.base + 0.22], [R, L.aftTop]], 48), M.aft);
  const noseProf1 = noseProf.filter((_, i) => i % 4 === 0 || i >= noseProf.length - 2);
  b1.add(latheZ(noseProf1, 64, { vRange: [L.nose, zFlat] }), M.nose);
  b1.add(latheZ([[1.04, zFlat], [1.04, H - 0.05], [0.001, H]], 24), M.alu);
  for (const az of winAz) b1.add(new THREE.BoxGeometry(0.1, 0.95, 1.15), M.glass, at(R - 0.03, az, L.windows));
  b1.add(new THREE.BoxGeometry(0.1, 1.5, hh), M.trimWhite, at(R, 0, hz));
  for (const az of POD_AZ) b1.add(new THREE.BoxGeometry(0.95, 2.05, 2.7), M.trimWhite, at(R + 0.36, az, L.pods));
  for (const az of BAY_AZ) b1.add(new THREE.BoxGeometry(0.06, 2.4, 3.7), M.frame, at(R, az, (L.bays[0] + L.bays[1]) / 2));
  {
    const g = new THREE.CircleGeometry(R - 0.04, 32); g.translate(0, 0, L.base + 2.1); b1.add(g, M.blanket);
  }
  const lod1 = b1.build('lod1');

  // ======== LOD 2: silhouette (beyond ~600 m) ========
  const b2 = new PartBuilder();
  b2.add(latheZ([[R, L.aftTop], [R, L.nose]], 20), M.hull);
  b2.add(latheZ([[R, L.base], [R, L.aftTop]], 20), M.aft);
  b2.add(latheZ(noseProf.filter((_, i) => i % 8 === 0).concat([[0.001, H]]), 20, { vRange: [L.nose, zFlat] }), M.nose);
  const lod2 = b2.build('lod2');

  const lod = new THREE.LOD(); lod.name = 'hullLOD';
  lod.addLevel(lod0, 0); lod.addLevel(lod1, 120); lod.addLevel(lod2, 600);
  body.add(lod);

  // ======== engines (gimbal-ready: each nozzle group pivots at its top) ========
  const engines = new THREE.Group(); engines.name = 'engines'; body.add(engines);
  const nozzles = { sl: [], vac: [] }, mainExits = [], vacExits = [], mainPlumes = [];
  const lowSL = engineGeometry({ ...RAPTOR.sl, bellSamples: 6, arcSamples: 1 }, 14, { inner: false }), lowVac = engineGeometry({ ...RAPTOR.vac, bellSamples: 6, arcSamples: 1 }, 16, { inner: false });
  const geoSL = engineGeometry({ ...RAPTOR.sl, bellSamples: 18, arcSamples: 4 }, 56), geoVac = engineGeometry({ ...RAPTOR.vac, bellSamples: 20, arcSamples: 4 }, 64);
  const powerhead = (() => {
    const b = new PartBuilder();
    b.add(latheZ([[0.3, 0], [0.42, 0.12], [0.42, 0.62], [0.3, 0.85], [0.001, 0.86]], 32), S.frame);
    b.add(new THREE.CylinderGeometry(0.2, 0.2, 0.7, 20).rotateX(Math.PI / 2), S.steel, atQ([0.42, 0, 0.45], new THREE.Quaternion()));
    b.add(new THREE.CylinderGeometry(0.17, 0.17, 0.6, 20).rotateX(Math.PI / 2), S.steel, atQ([-0.4, 0.1, 0.4], new THREE.Quaternion()));
    b.add(new THREE.TorusGeometry(0.3, 0.05, 8, 24), S.steel, atQ([0, 0, 0.05], new THREE.Quaternion()));
    return b;
  })();
  function addEngine(kind, az, i) {
    const spec = RAPTOR[kind], geo = kind === 'sl' ? geoSL : geoVac;
    const exitAt = kind === 'sl' ? L.base + 0.25 : L.base + 0.06;
    const g = new THREE.Group(); g.name = `raptor${kind === 'sl' ? 'SL' : 'Vac'}_${i}`;
    g.position.set(Math.cos(az) * spec.ring, Math.sin(az) * spec.ring, exitAt - geo.exitZ);
    // per-engine LOD: full bell + powerhead up close, a light bell beyond 150 m
    const near = new THREE.Group();
    near.add(new THREE.Mesh(geo.outer, kind === 'sl' ? S.nozzleSL : S.nozzleVac), new THREE.Mesh(geo.inner, S.soot), powerhead.build('powerhead'));
    const far = new THREE.Mesh((kind === 'sl' ? lowSL : lowVac).outer, kind === 'sl' ? S.nozzleSL : S.nozzleVac);
    const elod = new THREE.LOD(); elod.name = 'nozzleLOD'; elod.addLevel(near, 0); elod.addLevel(far, 150);
    g.add(elod);
    g.userData = { gimbalPoint: 'origin', exitZ: geo.exitZ, throatZ: geo.throatZ, exitDiameter: 2 * spec.re };
    const node = exitNode(`${g.name}_exit`, [0, 0, geo.exitZ], [0, 0, 1]);
    g.add(node);
    if (kind === 'sl') { const pl = makePlume(1.0, 30, 0x8fb4ff); node.add(pl); mainPlumes.push(pl); mainExits.push(node); }
    else vacExits.push(node);
    g.traverse(o => { if (o.isMesh && o.name !== 'plume') o.castShadow = true; });
    engines.add(g); nozzles[kind].push(g);
  }
  SL_AZ.forEach((az, i) => addEngine('sl', az, i));
  VAC_AZ.forEach((az, i) => addEngine('vac', az, i));

  // ======== landing thrusters: 6 pods x 3, canted 20° outward ========
  const thrusterGroup = new THREE.Group(); thrusterGroup.name = 'landingThrusters'; body.add(thrusterGroup);
  const thrusterNodes = [], landingPlumes = [];
  const tGeo = engineGeometry({ rt: 0.05, re: 0.18, bellLen: 0.42, chamberR: 0.1, chamberLen: 0.12, thetaN: 30, thetaE: 9, bellSamples: 7, arcSamples: 2 }, 16);
  const cant = 20 * DEG;
  POD_AZ.forEach((az, p) => {
    const e = new THREE.Vector3(Math.cos(az), Math.sin(az), 0), t = new THREE.Vector3(-Math.sin(az), Math.cos(az), 0);
    const thrust = e.clone().multiplyScalar(-Math.sin(cant)).add(new THREE.Vector3(0, 0, Math.cos(cant)));
    for (let j = -1; j <= 1; j++) {
      const g = new THREE.Group(); g.name = `landingThruster_${p * 3 + j + 1}`;
      g.position.copy(e.clone().multiplyScalar(R + 0.42)).addScaledVector(t, j * 0.62).add(new THREE.Vector3(0, 0, L.pods - 1.3));
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), thrust);
      g.add(new THREE.Mesh(tGeo.outer, S.nozzleSL), new THREE.Mesh(tGeo.inner, S.soot));
      const node = exitNode(`${g.name}_exit`, [0, 0, tGeo.exitZ], [0, 0, 1]);
      g.add(node);
      const pl = makePlume(0.32, 9, 0xffd9a8); node.add(pl); landingPlumes.push(pl);
      thrusterNodes.push(node);
      thrusterGroup.add(g);
    }
  });

  // ======== RCS: four clusters forward, four aft ========
  const rcsGroup = new THREE.Group(); rcsGroup.name = 'rcs'; body.add(rcsGroup);
  const rcsNodes = [];
  const rGeo = engineGeometry({ rt: 0.014, re: 0.05, bellLen: 0.1, chamberR: 0.03, chamberLen: 0.04, bellSamples: 3, arcSamples: 1 }, 10, { inner: false });
  const rcsSites = [
    ...[45, 135, 225, 315].map(d => ({ az: d * DEG, z: L.nose + 1.6, tag: 'fwd' })),
    ...[22.5, 112.5, 202.5, 292.5].map(d => ({ az: d * DEG, z: L.aftTop - 0.9, tag: 'aft' })),
  ];
  rcsSites.forEach((s, k) => {
    const r = s.tag === 'fwd' ? noseRadius(R, L.nose, zFlat, rTip, s.z) : R;
    const pod = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.7, 0.55, 2, 0.07), s.tag === 'fwd' ? M.trimWhite : S.trimDark);
    pod.position.set(...onHull(r + 0.12, s.az, s.z)); pod.quaternion.copy(facing(s.az)); pod.name = `rcsPod_${s.tag}_${k % 4}`;
    rcsGroup.add(pod);
    const e = new THREE.Vector3(Math.cos(s.az), Math.sin(s.az), 0), t = new THREE.Vector3(-Math.sin(s.az), Math.cos(s.az), 0);
    for (const [label, exhaust, off] of [['out', e, [0.33, 0]], ['cw', t.clone().negate(), [0.15, -0.36]], ['ccw', t, [0.15, 0.36]]]) {
      const g = new THREE.Group();
      g.position.copy(e.clone().multiplyScalar(r + off[0])).addScaledVector(t, off[1]).add(new THREE.Vector3(0, 0, s.z));
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), exhaust.clone().negate());
      g.add(new THREE.Mesh(rGeo.outer, S.frame));
      const node = exitNode(`rcs_${s.tag}_${k % 4}_${label}`, [0, 0, rGeo.exitZ], [0, 0, 1]);
      g.add(node); rcsNodes.push(node); rcsGroup.add(g);
    }
  });
  const sensorNodes = [100, 220, 340].map((d, i) => {
    const n = exitNode(`landingSensor_${i}`, onHull(R + 0.25, d * DEG, L.base + 3.85), [0, 0, 1]);
    body.add(n); return n;   // looks along -Z (down)
  });

  // ======== landing legs (deployable, telescoping) ========
  const legsGroup = new THREE.Group(); legsGroup.name = 'legs'; body.add(legsGroup);
  const padGeo = latheZ([[0.001, 0], [1.46, 0], [1.52, 0.08], [1.5, 0.22], [1.36, 0.3], [0.55, 0.46], [0.34, 0.58]], 48);
  const legs = [];
  for (let k = 0; k < v.legCount; k++) {
    const az = (k / v.legCount) * TAU + Math.PI / v.legCount;   // same azimuths as the touchdown physics
    const leg = new THREE.Group(); leg.name = `leg_${k}`; leg.userData.az = az;
    const outer = new THREE.Mesh(unitCyl(16), S.steel); outer.name = 'outerTube';
    const inner = new THREE.Mesh(unitCyl(16), S.chrome); inner.name = 'innerTube';
    const strutO = new THREE.Mesh(unitCyl(12), S.steel); strutO.name = 'strutCylinder';
    const strutI = new THREE.Mesh(unitCyl(12), S.chrome); strutI.name = 'strutPiston';
    const pad = new THREE.Group(); pad.name = 'footpad';
    pad.add(new THREE.Mesh(padGeo, S.padSteel), new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 12), S.frame));
    pad.children[1].position.z = 0.6;
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.5, 16), S.frame); collar.name = 'collar';
    leg.add(outer, inner, strutO, strutI, pad, collar);
    leg.traverse(o => { if (o.isMesh) o.castShadow = true; });
    legsGroup.add(leg);
    legs.push({ leg, az, outer, inner, strutO, strutI, pad, collar });
  }
  const legRadius = v.legRadius;
  function setLegs(t) {
    const s = THREE.MathUtils.smootherstep(Math.min(1, Math.max(0, t)), 0, 1);
    for (const L4 of legs) {
      const e = new THREE.Vector3(Math.cos(L4.az), Math.sin(L4.az), 0);
      const hinge = e.clone().multiplyScalar(R + 0.28).setZ(L.hinge);
      const jointDeployed = e.clone().multiplyScalar(legRadius).setZ(0.6);
      const lenStowed = L.hinge - (L.base + 0.5), lenDeployed = hinge.distanceTo(jointDeployed);
      const angDeployed = Math.atan2(legRadius - (R + 0.28), L.hinge - 0.6);
      const ang = angDeployed * THREE.MathUtils.smoothstep(s, 0, 0.6);
      const len = lenStowed + (lenDeployed - lenStowed) * THREE.MathUtils.smoothstep(s, 0.3, 1);
      const dir = e.clone().multiplyScalar(Math.sin(ang)).add(new THREE.Vector3(0, 0, -Math.cos(ang)));
      const joint = hinge.clone().addScaledVector(dir, len);
      const outerLen = lenStowed * 0.94;
      place(L4.outer, hinge, hinge.clone().addScaledVector(dir, outerLen), 0.3);
      place(L4.inner, hinge.clone().addScaledVector(dir, outerLen - 0.6), joint, 0.22);
      L4.collar.position.copy(hinge.clone().addScaledVector(dir, outerLen - 0.2));
      L4.collar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      const A = e.clone().multiplyScalar(R + 0.08).setZ(L.base + 1.4);
      const B = hinge.clone().addScaledVector(dir, outerLen * 0.8);
      const ab = B.clone().sub(A), abl = ab.length(); ab.normalize();
      place(L4.strutO, A, A.clone().addScaledVector(ab, Math.min(2.0, abl)), 0.15);
      place(L4.strutI, A.clone().addScaledVector(ab, Math.min(1.6, abl * 0.8)), B, 0.1);
      // footpad: flat on the ground when deployed, folded flat against the hull when stowed
      L4.pad.position.copy(joint).add(new THREE.Vector3(0, 0, -0.6));
      const fold = (1 - THREE.MathUtils.smoothstep(s, 0.5, 1)) * Math.PI / 2;
      const tangent = new THREE.Vector3(-Math.sin(L4.az), Math.cos(L4.az), 0);
      L4.pad.quaternion.setFromAxisAngle(tangent, -fold);
      if (fold > 0) {   // pivot about the ball joint
        const off = new THREE.Vector3(0, 0, 0.6).applyQuaternion(L4.pad.quaternion);
        L4.pad.position.copy(joint).sub(off);
      }
    }
  }
  function place(mesh, a, b, r) {
    const d = b.clone().sub(a), l = Math.max(0.001, d.length());
    mesh.position.copy(a).addScaledVector(d, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    mesh.scale.set(r, l, r);
  }

  // ======== crew elevator ========
  const elevator = new THREE.Group(); elevator.name = 'elevator'; body.add(elevator);
  const platform = new THREE.Group(); platform.name = 'elevatorPlatform'; elevator.add(platform);
  {
    const b = new PartBuilder();
    b.add(new THREE.BoxGeometry(1.9, 2.2, 0.08), S.alu, atQ([R + 1.3, 0, 0.04], new THREE.Quaternion()));
    for (let x = 0; x < 9; x++) b.add(new THREE.BoxGeometry(0.03, 2.2, 0.03), S.frame, atQ([R + 0.45 + x * 0.21, 0, 0.09], new THREE.Quaternion()));
    const posts = [[R + 0.4, -1.08], [R + 1.3, -1.08], [R + 2.22, -1.08], [R + 2.22, 0], [R + 2.22, 1.08], [R + 1.3, 1.08], [R + 0.4, 1.08]];
    for (const [x, y] of posts) b.add(unitCyl(8), S.alu, between([x, y, 0.08], [x, y, 1.12], 0.03));
    for (const zz of [0.6, 1.12]) for (let i = 0; i < posts.length - 1; i++) b.add(unitCyl(8), S.alu, between([...posts[i], zz], [...posts[i + 1], zz], 0.025));
    platform.add(b.build('platform'));
  }
  const cables = [[R + 0.5, -1.0], [R + 0.5, 1.0], [R + 2.1, -1.0], [R + 2.1, 1.0]].map(([x, y], i) => {
    const c = new THREE.Mesh(unitCyl(6), S.frame); c.name = `elevatorCable_${i}`; c.userData.xy = [x, y]; elevator.add(c); return c;
  });
  const elevTop = L.hatch[0] - 0.04;
  function setElevator(t) {
    const z = elevTop + (0.02 - elevTop) * THREE.MathUtils.smootherstep(t, 0, 1);
    platform.position.z = z;
    for (const c of cables) {
      const [x, y] = c.userData.xy;
      const xTop = x > R + 1 ? R + 2.1 : R + 0.5;
      place(c, new THREE.Vector3(x, y, z + 1.12), new THREE.Vector3(xTop, y, davitZ - 0.1), 0.012);
    }
  }

  // ======== solar arrays (5 bays): door opens, array unfurls down the hull ========
  const solarGroup = new THREE.Group(); solarGroup.name = 'solarArrays'; body.add(solarGroup);
  const arrays = BAY_AZ.map((az, k) => {
    const g = new THREE.Group(); g.name = `solarArray_${k}`; g.quaternion.copy(facing(az));
    const zc = (L.bays[0] + L.bays[1]) / 2, bh = L.bays[1] - L.bays[0];
    const doorPivot = new THREE.Group(); doorPivot.name = 'bayDoor'; doorPivot.position.set(R, 0, L.bays[1]);
    const door = new THREE.Mesh(plate(2.22, bh - 0.1, 0.13, 0.05), M.trimWhite);
    door.position.set(-0.005, 0, -(bh - 0.1) / 2 - 0.05);
    doorPivot.add(door);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.0, 1), [S.solar, S.frame, S.frame, S.frame, S.frame, S.frame]);
    panel.name = 'arrayPanel';
    const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.1, 0.12), S.frame); yoke.name = 'arrayYoke';
    g.add(doorPivot, panel, yoke);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    solarGroup.add(g);
    return { g, doorPivot, panel, yoke, zc, bh };
  });
  const ARRAY_LEN = 15.0;
  function setArrays(t) {
    const open = THREE.MathUtils.smoothstep(t, 0, 0.25), unfurl = THREE.MathUtils.smoothstep(t, 0.15, 0.65);
    for (const a of arrays) {
      a.doorPivot.rotation.y = -open * 100 * DEG;   // swing up and out
      const len = Math.max(0.05, ARRAY_LEN * unfurl), stand = 0.2 + 0.35 * open;
      a.panel.visible = unfurl > 0.01; a.yoke.visible = open > 0.05;
      a.panel.scale.z = len;
      a.panel.position.set(R + stand, 0, L.bays[0] - len / 2);
      a.yoke.position.set(R + stand / 2, 0, L.bays[0]);
      a.yoke.scale.x = Math.max(0.1, stand / 0.5);
    }
  }

  // ======== mounts, markers, collision proxy ========
  const com = new THREE.Object3D(); com.name = 'centerOfMass'; com.position.set(0, 0, v.cgHeight);
  const comViz = comMarker(0.7); comViz.visible = false; com.add(comViz);
  const cockpitMount = new THREE.Object3D(); cockpitMount.name = 'cockpitCameraMount';
  cockpitMount.position.set(...onHull(R - 0.4, 0, L.windows));
  // camera convention: looks along local -Z, local +Y up. Face out through the windows, 30° down.
  cockpitMount.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(30 * DEG), 0, -Math.sin(30 * DEG)), new THREE.Vector3(0, 0, 1)));
  const collision = new THREE.Group(); collision.name = 'collisionProxy'; collision.userData.collision = true;
  {
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H - L.base, 16, 1).rotateX(Math.PI / 2), S.debug);
    hull.position.z = (H + L.base) / 2; collision.add(hull);
    for (const L4 of legs) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.3, 12).rotateX(Math.PI / 2), S.debug);
      p.position.set(Math.cos(L4.az) * legRadius, Math.sin(L4.az) * legRadius, 0.15); collision.add(p);
    }
  }
  collision.visible = false;
  body.add(com, cockpitMount, collision);
  const axes = [...mainExits, ...vacExits, ...thrusterNodes, ...rcsNodes, ...sensorNodes, cockpitMount].map(n => { const a = new THREE.AxesHelper(n.name.startsWith('rcs') ? 0.4 : 1.2); a.visible = false; n.add(a); return a; });

  body.traverse(o => { if (o.isMesh && o.material !== S.debug && o.name !== 'plume' && o !== comViz) { o.castShadow = true; o.receiveShadow = true; } });

  setLegs(1); setElevator(0); setArrays(0);

  function setFinish(f) {
    const next = hullMaterials(v, f);
    for (const key of ['hull', 'nose', 'trimWhite']) {
      const old = M[key];
      body.traverse(o => { if (o.isMesh) {
        if (o.material === old) o.material = next[key];
        else if (Array.isArray(o.material)) o.material = o.material.map(m => (m === old ? next[key] : m));
      } });
    }
    M = { ...M, ...next };
  }

  return {
    root, height: H, cabinZ: L.windows, cabinR: R,
    plumes: { main: mainPlumes, landing: landingPlumes },
    setDeploy(t) { setArrays(t); setElevator(THREE.MathUtils.smoothstep(t, 0.45, 1)); },
    setLegs, setFinish,
    setDebug(on) { comViz.visible = on; collision.visible = on; for (const a of axes) a.visible = on; },
    parts: { legs: legs.map(l => l.leg), elevator, nozzles, solarArrays: arrays.map(a => a.g) },
    nodes: { mainExits, vacExits, thrusters: thrusterNodes, rcs: rcsNodes, sensors: sensorNodes },
    com, cockpitMount, collision, lod,
  };
}
