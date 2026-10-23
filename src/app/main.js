import * as THREE from 'three';
import { VEHICLES } from '../core/vehicles.js';
import { Terrain, makeAnalogTerrain, heightfieldFromBuffers, loadHeightfield, mapToMCI, dirToMap } from '../core/terrain.js';
import { Simulation, SCENARIOS, localFrame, gravityAt } from '../core/sim.js';
import { sunVisibility } from '../core/illumination.js';
import { MOON } from '../core/constants.js';
import { World, mciToWorld } from './world.js';
import { buildLander, updatePlumes } from './landers.js';
import { Dust } from './dust.js';
import { Minimap } from './minimap.js';
import { Stick, keys } from './input.js';
import { CameraRig, VIEW_LABEL } from './camera.js';
import * as V from '../core/vec.js';

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;
const store = {
  get(k, d) { try { const v = localStorage.getItem('spl.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('spl.' + k, JSON.stringify(v)); } catch {} },
};

// ---------------- renderer ----------------
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
$('view').appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 3e6);
camera.up.set(0, 0, 1);
const rig = new CameraRig(camera, renderer.domElement);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------------- state ----------------
const cfg = {
  vehicle: store.get('vehicle', 'hls'),
  scenario: store.get('scenario', 'pdi'),
  sunAz: store.get('sunAz', 285),
  enhanced: store.get('enhanced', false),
  failures: false,
};
if (!VEHICLES[cfg.vehicle]) cfg.vehicle = 'hls';
if (!SCENARIOS[cfg.scenario]) cfg.scenario = 'pdi';

let terrain = null, world = null, sim = null, model = null, dust = null, minimap = null;
let builtSunAz = null, builtTerrain = null;
let warp = 1, paused = false, running = false;

// ---------------- setup sheet ----------------
function vehicleCard(v) {
  const e = v.engines.main;
  const T = (e.thrustEach * e.count / 1000).toFixed(0);
  return `<label class="choice"><input type="radio" name="veh" value="${v.id}">
    <span class="t">${v.name}</span>
    <span class="d">${v.status}</span>
    <span class="specs">${v.height} m tall · ${(v.dryMass / 1000).toFixed(0)} t dry · ${(v.propellant / 1000).toFixed(0)} t propellant<br>
    ${e.count} × ${e.label}, ${T} kN, Isp ${e.isp} s${v.engines.landing ? `<br>+ ${v.engines.landing.count} landing thrusters` : ''}</span></label>`;
}
$('vehicleChoices').innerHTML = Object.values(VEHICLES).map(vehicleCard).join('');
$('scenarioChoices').innerHTML = Object.entries(SCENARIOS).map(([k, s]) =>
  `<label class="choice"><input type="radio" name="scn" value="${k}"><span class="t">${s.label}</span><span class="d">${s.note}</span></label>`).join('');
document.querySelector(`input[name=veh][value=${cfg.vehicle}]`).checked = true;
document.querySelector(`input[name=scn][value=${cfg.scenario}]`).checked = true;
document.querySelectorAll('input[name=veh]').forEach(i => i.addEventListener('change', () => { cfg.vehicle = i.value; store.set('vehicle', i.value); }));
document.querySelectorAll('input[name=scn]').forEach(i => i.addEventListener('change', () => { cfg.scenario = i.value; store.set('scenario', i.value); }));
$('sunAz').value = cfg.sunAz;
$('enhanced').checked = cfg.enhanced;
$('sunAz').addEventListener('input', () => { cfg.sunAz = +$('sunAz').value; store.set('sunAz', cfg.sunAz); updateSunStatus(); });
$('enhanced').addEventListener('change', () => { cfg.enhanced = $('enhanced').checked; store.set('enhanced', cfg.enhanced); world?.setEnhanced(cfg.enhanced); });
$('failures').addEventListener('change', () => { cfg.failures = $('failures').checked; });

function updateSunStatus() {
  $('sunAzVal').textContent = `${cfg.sunAz}°`;
  if (!terrain) return;
  const v = sunVisibility(terrain, 0, 0, 0.5, cfg.sunAz * DEG, 1.0 * DEG);
  const el = $('sunStatus');
  // approach runs along +x, so az 180 is directly behind the crew
  const rel = ((cfg.sunAz - 180 + 540) % 360) - 180;
  const where = Math.abs(rel) < 60 ? 'behind you on approach' : Math.abs(rel) > 120 ? 'in your eyes on approach' : 'off to the side';
  el.textContent = v > 0.95 ? `Target in full sun, ${where}` : v > 0.05 ? `Target in partial sun (${(v * 100).toFixed(0)}% of the disk)` : 'Target in shadow: landing in darkness';
  el.className = 'status ' + (v > 0.5 ? 'go' : 'warn');
}

function describeTerrain() {
  const m = terrain.meta;
  $('terrainNote').innerHTML = m.isAnalog
    ? `<span class="badge">Analog</span> Built-in stand-in modelled on Shackleton's real dimensions (21 km wide, 4.2 km deep) and the ridge toward de Gerlache. Load real NASA LOLA data with <code>tools/lola_to_heightmap.py</code>.`
    : `<span class="badge" style="border-color:var(--go);color:var(--go)">LOLA</span> ${m.label}. Boulders are placed statistically (LOLA cannot resolve rocks this small).`;
}

$('demFiles').addEventListener('change', async (ev) => {
  const files = [...ev.target.files];
  try {
    const metas = await Promise.all(files.filter(f => f.name.endsWith('.json')).map(async f => JSON.parse(await f.text())));
    const byName = Object.fromEntries(files.map(f => [f.name, f]));
    const load = async (m) => heightfieldFromBuffers(m, await byName[m.bin].arrayBuffer());
    const siteM = metas.find(m => m.name === 'site'), regM = metas.find(m => m.name === 'regional');
    if (!siteM || !regM || !byName[siteM.bin] || !byName[regM.bin]) throw new Error('Select all four files: site.json, site.bin, regional.json, regional.bin');
    const site = await load(siteM), regional = await load(regM);
    const analog = makeAnalogTerrain();
    terrain = new Terrain({
      regional, site, rocks: analog.rocks,
      meta: { isAnalog: false, label: `${siteM.source || 'LOLA'} — ${siteM.siteName || 'landing site'}`, siteName: siteM.siteName },
    });
    builtTerrain = null;
    $('demStatus').textContent = `Loaded ${site.n}² site + ${regional.n}² regional`;
    $('demStatus').className = 'status go';
    describeTerrain(); updateSunStatus();
  } catch (e) {
    $('demStatus').textContent = e.message;
    $('demStatus').className = 'status warn';
  }
});

// ---------------- flight ----------------
async function prepareWorld() {
  if (world && builtSunAz === cfg.sunAz && builtTerrain === terrain) return;
  $('loading').hidden = false;
  const msg = (t, p) => { $('loadMsg').textContent = t; $('loadBar').style.width = `${(p * 100).toFixed(0)}%`; };
  if (world) world.scene.clear();
  world = new World(renderer, terrain, { sunAz: cfg.sunAz, sunEl: 1.0 });
  await world.build(msg);
  world.setEnhanced(cfg.enhanced);
  dust = new Dust(world.scene);
  minimap = new Minimap($('minimap'), terrain, world);
  builtSunAz = cfg.sunAz; builtTerrain = terrain;
  $('loading').hidden = true;
}

async function startFlight() {
  $('setup').hidden = true;
  $('result').hidden = true;
  await prepareWorld();
  if (model) world.scene.remove(model.root);
  const v = VEHICLES[cfg.vehicle];
  sim = new Simulation({ vehicle: v, terrain, scenario: cfg.scenario, failures: cfg.failures, seed: (Math.random() * 1e9) | 0 });
  model = buildLander(v);
  world.scene.add(model.root);
  dust.reset();
  setWarp(1); paused = false; $('pauseBtn').textContent = 'PAUSE';
  setMode('AUTO');
  $('hudTop').hidden = false; $('hudBottom').hidden = false;
  running = true;
  lastEventCount = 0;
  rig.resetAll();
}

function showSetup() {
  running = false;
  $('result').hidden = true;
  $('setup').hidden = false;
  $('hudTop').hidden = true; $('hudBottom').hidden = true;
  updateSunStatus();
}

$('startBtn').addEventListener('click', startFlight);
$('againBtn').addEventListener('click', startFlight);
$('setupBtn').addEventListener('click', showSetup);
$('menuBtn').addEventListener('click', showSetup);
$('lookBtn').addEventListener('click', () => { $('result').hidden = true; rig.setMode('chase'); rig.target.chase.zoom = 2.5; $('camBtn').textContent = VIEW_LABEL.chase; });

// ---------------- controls ----------------
const stick = new Stick($('stick'), $('knob'));

function setMode(m) {
  if (!sim) return;
  sim.setMode(m);
  for (const k of ['AUTO', 'ASSIST', 'DIRECT']) $('m' + k).setAttribute('aria-pressed', String(sim.mode === k));
  $('pilot').hidden = sim.mode === 'AUTO';
  $('rateBox').hidden = sim.mode !== 'ASSIST';
  $('throttleBox').hidden = sim.mode !== 'DIRECT';
  $('stickLabel').textContent = sim.mode === 'ASSIST' ? 'Translate' : 'Attitude';
  $('engineSwap').hidden = !sim.v.engines.landing;
  if (sim.mode === 'DIRECT') {
    const fr = localFrame(...sim.map);
    // seed the attitude hold from the current axis
    sim.manual.pitch = -Math.asin(Math.max(-1, Math.min(1, V.dot(sim.axis, fr.fwd)))) / DEG;
    sim.manual.yaw = Math.asin(Math.max(-1, Math.min(1, V.dot(sim.axis, fr.left)))) / DEG;
    $('throttle').value = Math.round(sim.manual.throttle * 100);
  }
  if (m !== 'AUTO' && warp > 1) setWarp(1);
}
for (const k of ['AUTO', 'ASSIST', 'DIRECT']) $('m' + k).addEventListener('click', () => setMode(k));

function setWarp(w) {
  warp = w;
  for (const x of [1, 4, 16]) $('w' + x).setAttribute('aria-pressed', String(x === w));
}
for (const x of [1, 4, 16]) $('w' + x).addEventListener('click', () => { if (x === 1 || (sim?.mode === 'AUTO' && sim.altitude > 1500)) setWarp(x); });

$('camBtn').addEventListener('click', () => { $('camBtn').textContent = VIEW_LABEL[rig.next()]; });
$('pauseBtn').addEventListener('click', () => { paused = !paused; $('pauseBtn').textContent = paused ? 'RESUME' : 'PAUSE'; });

function nudgeRate(d) {
  if (!sim?.manual.vCmd) return;
  const up = sim.up;
  sim.manual.vCmd = V.addScaled(sim.manual.vCmd, up, d);
}
$('rateUp').addEventListener('click', () => nudgeRate(+0.5));
$('rateDown').addEventListener('click', () => nudgeRate(-0.5));
$('throttle').addEventListener('input', () => { if (sim) sim.manual.throttle = $('throttle').value / 100; });
$('engineSwap').addEventListener('click', () => {
  if (!sim) return;
  sim.manual.engine = (sim.manual.engine || sim.engine) === 'main' ? 'landing' : 'main';
});

window.addEventListener('keydown', (e) => {
  if (!running || !sim) return;
  if (e.key === 'c' || e.key === 'C') $('camBtn').click();
  if (e.key === 'v' || e.key === 'V') rig.reset();
  if (e.key === 'p' || e.key === 'P') $('pauseBtn').click();
  if (e.key === '1') $('w1').click();
  if (e.key === '2') $('w4').click();
  if (e.key === '3') $('w16').click();
  if (e.key === 'r' || e.key === 'R') nudgeRate(+0.5);
  if (e.key === 'f' || e.key === 'F') nudgeRate(-0.5);
  if (e.key === 'e' || e.key === 'E') $('engineSwap').click();
  if (e.key === 'x' || e.key === 'X') { sim.manual.throttle = 1; $('throttle').value = 100; }
  if (e.key === 'z' || e.key === 'Z') { sim.manual.throttle = 0; $('throttle').value = 0; }
});

function applyPilotInput(dt) {
  if (!sim || sim.mode === 'AUTO') return;
  let sx = stick.x, sy = stick.y;
  if (sim.mode === 'ASSIST') {
    sx += (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
    sy += (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0);
    const fr = localFrame(...sim.map);
    // full deflection changes the velocity target by 3 m/s each second
    sim.manual.vCmd = V.add(sim.manual.vCmd, V.add(V.scale(fr.fwd, sy * 3 * dt), V.scale(fr.left, -sx * 3 * dt)));
    const vz = V.dot(sim.manual.vCmd, sim.up);
    $('rateReadout').textContent = `${vz <= 0 ? 'Sink' : 'Climb'} ${Math.abs(vz).toFixed(1)} m/s`;
  } else {
    sx += (keys.has('arrowright') ? 1 : 0) - (keys.has('arrowleft') ? 1 : 0);
    sy += (keys.has('arrowdown') ? 1 : 0) - (keys.has('arrowup') ? 1 : 0);
    // rate command, attitude hold: up to 10 deg/s
    sim.manual.pitch = Math.max(-100, Math.min(100, sim.manual.pitch - sy * 10 * dt));
    sim.manual.yaw = Math.max(-60, Math.min(60, sim.manual.yaw - sx * 10 * dt));
    if (keys.has('shift')) sim.manual.throttle = Math.min(1, sim.manual.throttle + 0.5 * dt);
    if (keys.has('control')) sim.manual.throttle = Math.max(0, sim.manual.throttle - 0.5 * dt);
    $('throttle').value = Math.round(sim.manual.throttle * 100);
    $('thrReadout').textContent = `${Math.round(sim.manual.throttle * 100)}%`;
    $('engineSwap').textContent = sim.v.engines[sim.manual.engine || sim.engine].label.replace('Landing thrusters', 'Thrusters');
  }
}

// ---------------- HUD ----------------
const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '—');
function fmtDist(m) { return m >= 10000 ? `${(m / 1000).toFixed(1)} km` : m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`; }
function fmtTime(s) { s = Math.max(0, s); const m = Math.floor(s / 60); return `${String(m).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }
let hudTimer = 0, lastEventCount = 0;

function updateHUD() {
  const s = sim;
  const L = s.v.limits;
  const alt = s.altitude;
  const vv = s.vVert, vh = s.vHoriz;
  const propPct = s.prop / s.v.propellant * 100;
  const margin = s.ascentMargin;
  const e = s.v.engines[s.engine];
  const near = alt < 60;
  const slope = alt < 1500 ? s.terrain.slopeDeg(...s.map, 5) : NaN;
  const rows = [
    ['Alt', `<span class="big">${fmtDist(Math.max(0, alt))}</span>`, ''],
    ['V/S', `<span class="big">${fmt(vv, 1)}</span> m/s`, near ? (-vv > L.vVert ? 'warn' : 'go') : ''],
    ['H spd', `${fmt(vh, vh < 100 ? 1 : 0)} m/s`, near ? (vh > L.vHoriz ? 'warn' : 'go') : ''],
    ['Range', fmtDist(s.rangeToTarget), ''],
    ['Thrust', `${fmt(s.throttle * 100)}% · ${s.activeEngines}×${e.label.replace('Landing thrusters', 'LT')}`, ''],
    ['Accel', `${fmt(s.thrust / s.mass, 2)} m/s²`, ''],
    ['Prop', `${fmt(s.prop / 1000, 1)} t · ${fmt(propPct)}%`, propPct < 8 ? 'warn' : propPct < 15 ? 'caution' : ''],
    ['Ascent', `${margin >= 0 ? '+' : ''}${fmt(margin)} m/s`, margin < 0 ? 'warn' : margin < 100 ? 'caution' : 'go'],
    ['Tilt', `${fmt(s.tiltDeg, 1)}°`, near ? (s.tiltDeg > L.tiltDeg ? 'warn' : 'go') : ''],
    ['Slope', Number.isFinite(slope) ? `${fmt(slope, 1)}°` : '—', Number.isFinite(slope) && alt < 300 ? (slope > L.slopeDeg ? 'warn' : 'go') : ''],
  ];
  $('tele').innerHTML = rows.map(([k, v, c]) => `<span class="k">${k}</span><span class="v ${c}">${v}</span>`).join('');
  const tgo = s.mode === 'AUTO' ? s.tgo : null;
  $('phaseChip').textContent = s.aborting ? 'ABORT' : s.mode === 'AUTO' ? s.phaseName + (tgo != null ? ` ${fmt(tgo)}s` : '') : s.mode;
  $('metChip').textContent = `T+${fmtTime(s.t)}`;
  const alarms = [];
  if (s.enginesOut.main) alarms.push(`ENG OUT ${s.enginesOut.main}`);
  if (propPct < 8) alarms.push('LOW PROP');
  if (s.coasting) alarms.push('COAST');
  if (alt < 30 && Number.isFinite(slope) && slope > L.slopeDeg) alarms.push('SLOPE');
  if (alt < 40 && s.terrain.rockHeightAt(...s.map, s.v.legRadius) > L.rockHeight) alarms.push('BOULDER');
  $('alarms').innerHTML = alarms.map(a => `<span class="chip alarm">${a}</span>`).join('');
  if (s.events.length !== lastEventCount) {
    lastEventCount = s.events.length;
    const ev = s.events[s.events.length - 1];
    $('ticker').textContent = `T+${fmtTime(ev.t)} ${ev.msg}`;
  }
  // warp auto-drops close to the ground
  if (warp > 1 && (alt < 1500 || s.mode !== 'AUTO')) setWarp(1);
  for (const x of [4, 16]) $('w' + x).disabled = !(s.mode === 'AUTO' && alt > 1500);
}

function showResult() {
  const r = sim.result;
  running = false;
  const cls = r.outcome === 'LANDED' ? 'go' : r.outcome === 'HARD LANDING' || r.outcome.startsWith('ABORT') ? 'caution' : 'warn';
  $('resVehicle').textContent = `${sim.v.name} · ${SCENARIOS[sim.scenario].label}`;
  $('resOutcome').textContent = r.outcome;
  $('resOutcome').className = 'outcome ' + cls;
  $('resFaults').innerHTML = r.faults.map(f => `<li>${f}</li>`).join('') || '';
  const stats = r.outcome.startsWith('ABORT') ? [
    ['Flight time', fmtTime(r.time)], ['Propellant left', `${fmt(r.prop / 1000, 1)} t`], ['Orbital speed', `${fmt(r.vH)} m/s`],
  ] : [
    ['Miss distance', `${fmt(r.range, 1)} m`], ['Sink rate', `${fmt(r.vV, 2)} m/s`], ['Drift', `${fmt(r.vH, 2)} m/s`],
    ['Attitude', `${fmt(r.tilt, 1)}°`], ['Ground slope', `${fmt(r.groundTilt, 1)}°`], ['Tip-over limit', `${fmt(r.tipAngle, 1)}°`],
    ['Propellant left', `${fmt(r.prop / 1000, 1)} t`], ['Ascent margin', `${r.ascentMargin >= 0 ? '+' : ''}${fmt(r.ascentMargin)} m/s`], ['Flight time', fmtTime(r.time)],
  ];
  $('resStats').innerHTML = stats.map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  setTimeout(() => { $('result').hidden = false; }, 1600);
}

// ---------------- cameras ----------------
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), q = new THREE.Quaternion();

function placeModel() {
  const p = mciToWorld(sim.r);
  model.root.position.copy(p);
  const axis = new THREE.Vector3(...sim.axis);
  // keep a stable roll: body +X toward the along-track direction
  const fr = localFrame(...sim.map);
  const fwd = new THREE.Vector3(...fr.fwd);
  const x = fwd.clone().sub(axis.clone().multiplyScalar(fwd.dot(axis))).normalize();
  if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
  const y = new THREE.Vector3().crossVectors(axis, x);
  const m = new THREE.Matrix4().makeBasis(x, y, axis);
  model.root.quaternion.setFromRotationMatrix(m);
  return { p, fr };
}

function groundClear(pos, margin) {
  // push a world-space point up so it stays `margin` metres above the terrain
  const cr = [pos.x, pos.y, pos.z + MOON.radius];
  const [cx, cy] = dirToMap(...V.norm(cr));
  const minR = MOON.radius + sim.terrain.height(cx, cy) + margin;
  const r = Math.hypot(...cr);
  if (r < minR) { const k = minR / r; pos.set(cr[0] * k, cr[1] * k, cr[2] * k - MOON.radius); }
  return pos;
}
const groundCamPos = new THREE.Vector3();
let groundCamFor = null;

function updateCamera(dt) {
  const { p, fr } = placeModel();
  if (groundCamFor !== sim.terrain) {
    // tracking camera on a tripod 2 m up, 320 m beside the target
    groundCamPos.copy(mciToWorld(mapToMCI(-120, 320, sim.terrain.height(-120, 320) + 2)));
    groundCamFor = sim.terrain;
  }
  rig.keys(keys, dt);
  rig.update(dt, {
    base: p, up: new THREE.Vector3(...fr.up), fwd: new THREE.Vector3(...fr.fwd), left: new THREE.Vector3(...fr.left),
    quat: model.root.quaternion, height: model.height, cabinR: model.cabinR, cabinZ: model.cabinZ,
    vel: new THREE.Vector3(...sim.vel), altitude: Math.max(0, sim.altitude), groundCam: groundCamPos, groundClear,
  });
  world.follow(p, camera);
  world.updateVehicleShadow(sim, model);
}

// ---------------- loop ----------------
const clock = new THREE.Clock();
let acc = 0;
const DT = 0.02;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);
  if (!sim || !world) { return; }
  if (running && !paused && !sim.result) {
    applyPilotInput(dt);
    acc += dt * warp;
    let n = 0;
    while (acc >= DT && n < 2000 && !sim.result) { sim.step(DT); acc -= DT; n++; }
    if (sim.result) showResult();
  }
  updateCamera(dt);
  updatePlumes(model, sim, performance.now() / 1000);
  dust.update(sim, dt * (paused ? 0 : warp > 1 ? 1 : 1), model);
  if ((hudTimer += dt) > 0.1 && running) { hudTimer = 0; updateHUD(); minimap.draw(sim); }
  renderer.render(world.scene, camera);
}

// ---------------- boot ----------------
(async function boot() {
  $('loadMsg').textContent = 'Generating terrain';
  $('loadBar').style.width = '5%';
  await new Promise(r => setTimeout(r, 30));
  terrain = makeAnalogTerrain();
  // If converted LOLA files sit in data/ beside the page (e.g. on GitHub Pages), use them.
  if (location.protocol.startsWith('http')) try {
    const [site, regional] = await Promise.all([loadHeightfield('data/site.json'), loadHeightfield('data/regional.json')]);
    terrain = new Terrain({
      regional: regional.hf, site: site.hf, rocks: terrain.rocks,
      meta: { isAnalog: false, label: `${site.meta.source || 'LOLA'} — ${site.meta.siteName || 'landing site'}` },
    });
  } catch { /* no real data shipped with this copy: keep the analog terrain */ }
  describeTerrain();
  updateSunStatus();
  // Show the site behind the setup sheet
  await prepareWorld();
  const v = VEHICLES[cfg.vehicle];
  sim = new Simulation({ vehicle: v, terrain, scenario: 'terminal' });
  model = buildLander(v);
  world.scene.add(model.root);
  $('loading').hidden = true;
  $('setup').hidden = false;
  frame();
})();

// expose for debugging in the console
window.splSim = () => sim;
