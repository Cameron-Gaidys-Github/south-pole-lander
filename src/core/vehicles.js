// Lander definitions.
//
// Every number here is either published (P) or an engineering estimate (E).
// Neither SpaceX nor Blue Origin publishes full lander specs, so estimates are
// chosen to be physically consistent and are listed in docs/ASSUMPTIONS.md.
// Change them here; nothing else in the sim hard-codes vehicle numbers.

export const VEHICLES = {
  hls: {
    id: 'hls',
    name: 'Starship HLS',
    maker: 'SpaceX',
    status: 'Artemis IV lander candidate (crewed landing targeted 2028)',
    // Geometry
    height: 52.3,            // m (P)
    diameter: 9.0,           // m (P)
    legRadius: 7.5,          // m, footpad circle radius (E)
    legCount: 4,             // (P: four legs that fold flush with the hull)
    cgHeight: 19.0,          // m above footpads at landing mass (E)
    // Mass
    dryMass: 120000,         // kg (E; public estimates span ~85-120 t)
    payloadMass: 12000,      // kg crew + cargo (E)
    propellant: 300000,      // kg CH4/LOX at powered descent initiation, incl. ascent reserve (E)
    // Engines. Raptors do the braking burn; landing thrusters take over close
    // to the surface because even one Raptor at minimum throttle is far too
    // strong to hover a ~215 t vehicle in lunar gravity.
    engines: {
      main: {
        label: 'Raptor',
        count: 3,               // sea-level Raptors used for descent (P)
        thrustEach: 2_550_000,  // N, vacuum (E; Raptor 2/3 class)
        minThrottle: 0.40,      // (E)
        isp: 355,               // s, vacuum, sea-level bell (E)
        lag: 0.35,              // s, throttle response time constant (E)
        position: 'base',
      },
      landing: {
        label: 'Landing thrusters',
        count: 18,              // (P: 18 thrusters in six pods below the crew cabin)
        thrustEach: 66_700,     // N (E) -> 1.2 MN total, T/W ~2.6 at landing mass
        minThrottle: 0.20,      // (E)
        isp: 300,               // s, gaseous O2/CH4 (E)
        lag: 0.15,
        position: 'mid',        // high on the body, below the cabin (P); keeps the plume off the regolith
      },
    },
    slewRateDeg: 8.0,         // max attitude rate, deg/s (E; Starship flips ~90 deg in seconds)
    accelCap: 6.0,            // m/s^2, crew comfort limit the guidance stays under (E)
    angAccelDeg: 5.0,         // max angular acceleration from RCS, deg/s^2 (E)
    rcsAccel: 0.12,           // translation acceleration from RCS, m/s^2 (E)
    // Touchdown limits (E)
    limits: { vVert: 2.0, vHoriz: 0.8, tiltDeg: 4, slopeDeg: 8, rockHeight: 0.6 },
    // Ascent from the surface to low lunar orbit, for the reserve check
    ascentDv: 1870,           // m/s to ~100 km LLO incl. losses (E)
    ascentEngine: 'main',
    // Guidance gates in the target frame: [downrange(-uprange), altitude] in m,
    // velocity [horizontal along track, vertical] in m/s.
    gates: [
      { name: 'BRAKING', engine: 'main', to: { pos: [-60, 160], vel: [2.5, -9] } },
      { name: 'APPROACH', engine: 'landing', to: { pos: [0, 45], vel: [0, -2.5] } },
      { name: 'TERMINAL', engine: 'landing', to: { pos: [0, 0], vel: [0, -0.8] } },
    ],
    color: 0xd7dadf,
  },

  bluemoon: {
    id: 'bluemoon',
    name: 'Blue Moon MK2',
    maker: 'Blue Origin',
    status: 'Artemis V lander; uncrewed demo planned 2027 (preliminary model)',
    height: 16.0,            // m (P)
    diameter: 6.2,           // m (E; must fit a 7 m fairing)
    legRadius: 5.0,          // m (E)
    legCount: 4,
    cgHeight: 6.5,           // m (E)
    dryMass: 16000,          // kg (P)
    payloadMass: 3000,       // kg (E)
    propellant: 27000,       // kg LH2/LOX at PDI (E; launch mass >45 t is P)
    engines: {
      main: {
        label: 'BE-7',
        count: 3,               // (P)
        thrustEach: 44_000,     // N (P)
        minThrottle: 0.20,      // (P: 20-100%)
        isp: 460,               // s (P)
        lag: 0.25,
        position: 'base',
      },
    },
    slewRateDeg: 10.0,
    accelCap: 5.0,
    angAccelDeg: 6.0,
    rcsAccel: 0.25,
    limits: { vVert: 2.5, vHoriz: 1.0, tiltDeg: 6, slopeDeg: 12, rockHeight: 0.5 },
    ascentDv: 1870,
    ascentEngine: 'main',
    gates: [
      { name: 'BRAKING', engine: 'main', to: { pos: [-400, 500], vel: [14, -10] } },
      { name: 'APPROACH', engine: 'main', to: { pos: [0, 30], vel: [0, -2] } },
      { name: 'TERMINAL', engine: 'main', to: { pos: [0, 0], vel: [0, -0.8] } },
    ],
    color: 0xe9e6dd,
  },
};

export function maxThrust(v, engineKey, enginesOut = 0) {
  const e = v.engines[engineKey];
  return e.thrustEach * Math.max(0, e.count - enginesOut);
}

/** Lowest non-zero thrust: one engine running at its throttle floor. */
export function minThrust(v, engineKey) {
  const e = v.engines[engineKey];
  return e.thrustEach * e.minThrottle;
}
