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
import { Stick, CrewInput, holdButton, keys } from './input.js';
import { RockIndex, scanHazards, nearestSafe, scoreAt } from '../core/hazard.js';
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
  finish: store.get('finish', 'paint'),
  failures: false,
};
if (!VEHICLES[cfg.vehicle]) cfg.vehicle = 'hls';
if (!SCENARIOS[cfg.scenario]) cfg.scenario = 'pdi';

let terrain = null, world = null, sim = null, model = null, dust = null, minimap = null;
let builtSunAz = null, builtTerrain = null;
let warp = 1, paused = false, running = false, deployT = 0, legT = 1, debugView = false;

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
$('steelHull').checked = cfg.finish === 'steel';
$('steelHull').addEventListener('change', () => { cfg.finish = $('steelHull').checked ? 'steel' : 'paint'; store.set('finish', cfg.finish); model?.setFinish?.(cfg.finish); });
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
  model = buildLander(v, { finish: cfg.finish });
  world.scene.add(model.root);
  legT = sim.altitude < LEG_DEPLOY_ALT ? 1 : 0;
  model.setLegs?.(legT);
  model.setDebug?.(debugView);
  dust.reset();
  setWarp(1); paused = false; $('pauseBtn').textContent = 'PAUSE';
  syncModeUI();
  hazardFor = null;
  $('hudTop').hidden = false; $('hudBottom').hidden = false;
  running = true;
  lastEventCount = 0;
  rig.resetAll();
  deployT = 0;
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
const crew = new CrewInput({
  rhcStick: new Stick($('rhcStick'), $('rhcKnob')),
  thcStick: new Stick($('thcStick'), $('thcKnob')),
  yawL: holdButton($('yawL')), yawR: holdButton($('yawR')),
  thcUp: holdButton($('thcUp')), thcDown: holdButton($('thcDown')),
});
// hazard scan around the current landing point (refreshed when it moves)
let rockIndex = null, hazard = null, hazardFor = null;

function refreshHazard(force) {
  if (!sim) return;
  if (!rockIndex || rockIndex.terrain !== sim.terrain) { rockIndex = new RockIndex(sim.terrain.rocks); rockIndex.terrain = sim.terrain; }
  const key = `${sim.target.x.toFixed(1)},${sim.target.y.toFixed(1)}`;
  if (!force && key === hazardFor) return;
  hazard = scanHazards(sim.terrain, rockIndex, sim.v, sim.target.x, sim.target.y, 160, 6);
  hazardFor = key;
}

function syncModeUI() {
  if (!sim) return;
  for (const k of ['AUTO', 'ROD', 'MANUAL']) $('m' + k).setAttribute('aria-pressed', String(sim.mode === k));
  $('pilot').hidden = sim.mode === 'AUTO' || !!sim.result;
  $('lpdBar').hidden = sim.mode !== 'AUTO' || !!sim.result;
  $('rodBox').hidden = sim.mode !== 'ROD';
  $('throttleBox').hidden = sim.mode !== 'MANUAL';
  $('thcVert').hidden = sim.mode !== 'MANUAL';
  $('engineSwap').hidden = !sim.v.engines.landing;
  if (sim.mode === 'MANUAL') $('throttle').value = Math.round(sim.ctl.throttle * 100);
}

function setMode(m) {
  if (!sim) return;
  sim.setMode(m);
  syncModeUI();
  if (m !== 'AUTO' && warp > 1) setWarp(1);
}
for (const k of ['AUTO', 'ROD', 'MANUAL']) $('m' + k).addEventListener('click', () => setMode(k));

function setWarp(w) {
  warp = w;
  for (const x of [1, 4, 16]) $('w' + x).setAttribute('aria-pressed', String(x === w));
}
const canWarp = () => sim?.mode === 'AUTO' && sim.altitude > 1500;
for (const x of [1, 4, 16]) $('w' + x).addEventListener('click', () => { if (x === 1 || canWarp()) setWarp(x); });

$('camBtn').addEventListener('click', () => { $('camBtn').textContent = VIEW_LABEL[rig.next()]; });
$('pauseBtn').addEventListener('click', () => { paused = !paused; $('pauseBtn').textContent = paused ? 'RESUME' : 'PAUSE'; });

function rod(dir) { if (!sim) return; const was = sim.mode; sim.rodClick(dir); if (was !== sim.mode) { syncModeUI(); setWarp(1); } }
$('rodUp').addEventListener('click', () => rod(+1));
$('rodDown').addEventListener('click', () => rod(-1));
$('takeBtn').addEventListener('click', () => setMode('ROD'));
$('throttle').addEventListener('input', () => { if (sim) sim.ctl.throttle = $('throttle').value / 100; });
$('engineSwap').addEventListener('click', swapEngine);
function swapEngine() {
  if (!sim || !sim.v.engines.landing) return;
  sim.ctl.engine = (sim.ctl.engine || sim.engine) === 'main' ? 'landing' : 'main';
}

function lpdNudge(dx, dy) {
  if (!sim || sim.mode !== 'AUTO') return;
  // dx is along track (downrange), dy across (left)
  sim.redesignate(sim.target.x + dx, sim.target.y + dy);
  refreshHazard();
}
function goSafeSite() {
  if (!sim || sim.mode !== 'AUTO') return;
  refreshHazard(true);
  const best = nearestSafe(hazard, sim.target.x, sim.target.y);
  if (best && best.d > 1) { sim.redesignate(best.x, best.y); refreshHazard(); }
}
$('safeBtn').addEventListener('click', goSafeSite);

// tap the map to redesignate
$('minimap').addEventListener('pointerdown', (e) => {
  if (!sim || sim.mode !== 'AUTO' || !minimap.lpdView) return;
  const r = e.currentTarget.getBoundingClientRect();
  const [mx, my] = minimap.toMap((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  sim.redesignate(mx, my);
  refreshHazard();
});

function applyPilotInput(dt) {
  if (!sim) return;
  const inp = crew.poll(sim.mode);
  for (const ev of inp.events) {
    if (ev.type === 'rod') rod(ev.dir);
    else if (ev.type === 'lpd') lpdNudge(ev.dx, ev.dy);
    else if (ev.type === 'mode') setMode(ev.mode);
    else if (ev.type === 'engine') swapEngine();
    else if (ev.type === 'safeSite') goSafeSite();
    else if (ev.type === 'camera') $('camBtn').click();
    else if (ev.type === 'cameraReset') rig.reset();
    else if (ev.type === 'pause') $('pauseBtn').click();
    else if (ev.type === 'debug') { debugView = !debugView; model.setDebug?.(debugView); }
    else if (ev.type === 'throttleSet') { sim.ctl.throttle = ev.value; }
    else if (ev.type === 'warp') { const w = [1, 4, 16]; const i = Math.max(0, Math.min(2, w.indexOf(warp) + ev.dir)); if (w[i] === 1 || canWarp()) setWarp(w[i]); }
  }
  sim.ctl.rhc = sim.mode === 'AUTO' ? [0, 0, 0] : inp.rhc;
  sim.ctl.thc = sim.mode === 'AUTO' ? [0, 0, 0] : inp.thc;
  if (sim.mode === 'MANUAL') {
    if (inp.throttleAbs != null) sim.ctl.throttle = inp.throttleAbs;
    sim.ctl.throttle = Math.max(0, Math.min(1, sim.ctl.throttle + inp.throttleRate * 0.5 * dt));
    $('throttle').value = Math.round(sim.ctl.throttle * 100);
    $('thrReadout').textContent = `${Math.round(sim.ctl.throttle * 100)}%`;
    $('engineSwap').textContent = sim.v.engines[sim.ctl.engine || sim.engine].label.replace('Landing thrusters', 'Thrusters');
  }
  if (sim.mode === 'ROD') $('rodReadout').textContent = `${sim.rodCmd >= 0 ? '+' : '−'}${Math.abs(sim.rodCmd).toFixed(1)}`;
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
  if (s.rcsFiring) alarms.push('RCS');
  // Landing point designation, available in AUTO below 4 km
  const lpd = s.mode === 'AUTO' && !s.result && !s.aborting && (s.heightAboveTarget - s.targetHeight) < 4000;
  $('lpdBar').hidden = !lpd && !(s.mode === 'AUTO' && !s.result);
  $('safeBtn').hidden = !lpd;
  if (lpd) {
    refreshHazard();
    const sc = scoreAt(hazard, s.target.x, s.target.y);
    const moved = Math.hypot(s.target.x, s.target.y);
    $('lpdText').innerHTML = (sc != null && sc < 0.75 ? '<b style="color:var(--go)">Landing point safe</b>' : '<b style="color:var(--warn)">Landing point unsafe</b>')
      + (moved > 1 ? ` · moved ${fmt(moved)} m` : '') + ' · tap map to move';
  } else if (s.mode === 'AUTO' && !s.result) {
    $('lpdText').textContent = 'Landing point designation opens below 4 km';
  }
  minimap.draw(s, hazard, lpd);
  world.setReticle(s.target.x, s.target.y, s.v.legRadius, lpd ? (scoreAt(hazard, s.target.x, s.target.y) ?? 1) < 0.75 : true, lpd || s.altitude < 3000);
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

const LEG_DEPLOY_ALT = 2500;   // m above ground: legs swing out and extend below this

function placeModel() {
  const p = mciToWorld(sim.r);
  model.root.position.copy(p);
  // sim.q maps body axes to the Moon-centred frame; the world frame is the same
  // frame shifted to the landing site, so it applies directly (body +Z = thrust,
  // body +X = windows/elevator side). Roll and yaw now show on the model.
  model.root.quaternion.set(sim.q[1], sim.q[2], sim.q[3], sim.q[0]);
  const fr = localFrame(...sim.map);
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
  if (running && !sim.result) applyPilotInput(dt);
  if (running && !paused && !sim.result) {
    acc += dt * warp;
    let n = 0;
    while (acc >= DT && n < 2000 && !sim.result) { sim.step(DT); acc -= DT; n++; }
    if (sim.result) showResult();
  }
  updateCamera(dt);
  updatePlumes(model, sim, performance.now() / 1000);
  // landing legs: deploy over ~6 s when descending through LEG_DEPLOY_ALT
  if (model.setLegs) {
    const want = sim.result || sim.altitude < LEG_DEPLOY_ALT ? 1 : 0;
    if (legT !== want) { legT = want > legT ? Math.min(1, legT + dt / 6) : Math.max(0, legT - dt / 6); model.setLegs(legT); }
  }
  if (sim.result && sim.result.outcome === 'LANDED') {
    deployT = Math.min(1, deployT + dt / 25);
    model.setDeploy(deployT, world.sunAz * DEG);
  }
  dust.update(sim, dt * (paused ? 0 : warp > 1 ? 1 : 1), model);
  if ((hudTimer += dt) > 0.1 && running) { hudTimer = 0; updateHUD(); }
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
  model = buildLander(v, { finish: cfg.finish });
  world.scene.add(model.root);
  $('loading').hidden = true;
  $('setup').hidden = false;
  frame();
})();

// expose for debugging in the console
window.splSim = () => sim;
