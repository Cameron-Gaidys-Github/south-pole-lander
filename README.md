# South Pole Lander

A browser-based simulator of crewed landings at the lunar south pole, flying **Starship HLS** and
**Blue Moon MK2** to the ridge beside Shackleton crater. It runs on phones and desktops with no install.

The goal is physical honesty: real lunar gravity and curvature, real engine limits, guidance that
re-solves the landing every 20 ms, sunlight traced across the terrain at the pole's 1° Sun angle, and
touchdown judged the way a lander engineer would judge it.

## What it models

- **Powered descent from a 15 × 100 km orbit** in Moon-centred coordinates, with central gravity and curvature.
- **Engines as they are:** whole engines between a throttle floor and 100%, throttle lag, propellant burned by
  `ṁ = T / (Isp·g₀)`, a rate-limited thrust axis.
- **Starship HLS's two-stage braking:** Raptors do the main burn, then mid-body landing thrusters take over
  near the surface, because one Raptor at its 40% floor still pushes a ~250 t vehicle upward. When the
  guidance would need less thrust than the floor, it coasts with the engines off.
- **Guidance:** an energy-optimal ZEM/ZEV law flown through BRAKING → APPROACH → TERMINAL gates, close in
  spirit to Apollo's P63 / P64 / P66.
- **Failures:** an optional random engine-out during braking. The guidance re-plans; if no landing solution
  exists with the remaining thrust (Blue Moon losing a BE-7 early), it aborts to orbit.
- **Four camera views** (chase, cabin, ground tracker, top-down): drag to orbit or look around, pinch or scroll
  to zoom, double-tap to reset.
- **Real crew interaction:** AUTO with landing point redesignation on a live hazard map; ROD, Apollo's P66, where
  you fly attitude with a rotational hand controller and set the descent rate 0.3 m/s per click; MANUAL with
  RHC, throttle lever and a translational hand controller on RCS. Full attitude dynamics, rate-command
  attitude-hold.
- **Any input:** on-screen hand controllers for touch, keyboard, game controllers and flight sticks.
- **Published lander configurations:** HLS with its cabin windows, thruster pods, elevator, deployable solar
  arrays and four legs; Blue Moon MK2 with its top-mounted cabin and three BE-7s.
- **Light at the pole:** every terrain vertex marches toward the Sun up to 60 km, including the Moon's curvature
  drop and the 0.53° solar disk. Surfaces use a per-pixel Lommel–Seeliger regolith shader with sub-metre relief that fades with distance. The vehicle's own shadow (kilometres
  long at a 1° Sun) is traced along the ground.
- **No atmosphere:** black sky, no haze, plume-blown dust flying on ballistic arcs.
- **Touchdown assessment:** sink rate, drift, attitude, slope across the footpads, boulders under pads, tip-over
  margin from the centre-of-mass height, and propellant left for ascent to orbit.

Published numbers and estimates are separated in [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md).

## Terrain

The sim ships with an **analog** terrain: a procedural stand-in built to Shackleton's real dimensions
(21 km across, 4.2 km deep) with the connecting ridge toward de Gerlache. It is labelled as analog in the app.

To fly over **real NASA LOLA topography**:

1. Download GeoTIFFs from NASA's Planetary Geodesy Data Archive:
   - Regional mosaic (~20 m/px): <https://pgda.gsfc.nasa.gov/products/81> or <https://pgda.gsfc.nasa.gov/products/90>
   - Landing-site tiles (5 m/px): <https://pgda.gsfc.nasa.gov/products/78>
2. Pick your target in [LROC QuickMap](https://quickmap.lroc.asu.edu) and note its latitude/longitude.
3. Convert:
   ```bash
   pip install rasterio pyproj numpy scipy
   python tools/lola_to_heightmap.py --regional mosaic.tif --site site_5m.tif \
       --lat <lat> --lon <lon> --name "My site"
   ```
4. Either load the four files from the app's setup screen ("Load LOLA heightmap files"), or commit them to
   `data/` next to `index.html`; the app picks them up automatically when served over HTTP.

## Run it

```bash
npm install
npm run build        # writes dist/index.html, one self-contained file
npm test             # headless: the autopilot must land every vehicle from every start point
```

Open `dist/index.html` directly in a browser, or serve the folder for the `data/` auto-load.
For GitHub Pages, publish `dist/` (and `data/` if you have real terrain).

## Layout

```
src/core/       physics, guidance, terrain, lighting — no three.js, runs in Node
  constants.js  Moon and Sun constants
  vehicles.js   every vehicle number, tagged published or estimate
  sim.js        dynamics, ZEM/ZEV guidance, phases, abort, touchdown
  terrain.js    heightfields, projection, analog terrain, real-data loader
  illumination.js  horizon-traced sunlight
src/app/        three.js scene, models, HUD, input
tools/          build script, LOLA converter
test/           headless autoland tests
docs/           assumptions and sources
```

## Roadmap

- Rotational dynamics with RCS propellant use, and slosh
- Navigation error and terrain-relative navigation (hazard detection and avoidance divert)
- Real ephemeris for the Sun and Earth by date
- Ascent and rendezvous back to orbit
- Monte Carlo dispersion runs from the headless core

## Credits

Topography: NASA Goddard / LOLA (when loaded). Vehicle figures from public SpaceX, Blue Origin and NASA sources;
see `docs/ASSUMPTIONS.md`. Not affiliated with NASA, SpaceX or Blue Origin.
