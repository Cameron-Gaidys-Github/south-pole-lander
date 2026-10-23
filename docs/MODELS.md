# Lander models

Procedural three.js models, built in code from the same `vehicles.js` numbers the physics uses.
1 unit = 1 metre, true scale.

## Conventions (every model)

| | |
|---|---|
| Origin | Centre of the footpad circle, on the ground plane, legs deployed |
| +Z | Body axis; main-engine thrust pushes the vehicle along +Z |
| +X | Crew windows / hatch / elevator side |
| Orientation in the sim | `root.quaternion` = `sim.q` (body → Moon-centred frame), so roll and yaw show on the model |
| Thrust exit nodes | `Object3D` at the nozzle exit plane; local +Z = thrust on the vehicle, exhaust leaves along local −Z |
| Camera mount | `cockpitMount` looks along local −Z with +Y up |
| Legs | Azimuths `k·360°/n + 180°/n` and footpad radius `legRadius`, identical to the touchdown physics |

## Interface

```
buildLander(vehicle, { finish }) -> {
  root, height, cabinZ, cabinR,
  plumes: { main[], landing[] },          // driven by updatePlumes()
  setDeploy(t, sunAz)                      // post-landing: bays open, arrays unfurl, elevator lowers
  setLegs(t)                               // 0 stowed flush, 1 deployed (sim deploys below 2.5 km)
  setFinish('paint' | 'steel'), setDebug(on)
  parts:  { legs[], elevator, nozzles { sl[], vac[] }, solarArrays[] }
  nodes:  { mainExits[], vacExits[], thrusters[], rcs[], sensors[] }
  com, cockpitMount, collision, lod
}
```

Each Raptor is a group pivoting at its gimbal point (top of the engine), so gimballing is a rotation of
`parts.nozzles.sl[i]`. Named objects include `leg_0..3` (`outerTube`, `innerTube`, `strutCylinder`,
`strutPiston`, `footpad`), `raptorSL_0..2`, `raptorVac_0..2`, `landingThruster_0..17`, `rcs_fwd_*`/`rcs_aft_*`,
`landingSensor_0..2`, `elevator`/`elevatorPlatform`, `solarArray_0..4` (`bayDoor`, `arrayPanel`),
`centerOfMass`, `cockpitCameraMount`, `collisionProxy`. Press **G** in the sim to see the centre of mass,
collision proxy and every thrust axis.

The collision proxy is a named, hidden mesh for future use. Touchdown physics lives in the three.js-free
core and still uses the footpad positions from `vehicles.js`.

## Starship HLS

Configuration: the 2023 lunar Starship depiction (the most detailed public one), cross-checked against
SpaceX/NASA statements through late 2025. Where sources conflict, the choice is noted.

| Item | Value | Source | Confidence |
|---|---|---|---|
| Height | 52.3 m | [Wikipedia: Starship HLS](https://en.wikipedia.org/wiki/Starship_HLS); Block 2 ship 52.1 m ([Wikipedia](https://en.wikipedia.org/wiki/SpaceX_Starship_(spacecraft))); 2023 renders suggest ~55 m | Medium |
| Diameter | 9.0 m | SpaceX, Wikipedia | High |
| Hull | 304L stainless, painted white; black engine section | [Tech overview 2026](https://newspaceeconomy.ca/2026/02/05/artemis-human-landing-system-technical-overview/), [AmericaSpace](https://www.americaspace.com/2023/12/01/spacexs-new-design-for-lunar-starship-unveiled/) | Medium |
| Ring pitch / seams | 1.83 m rings, 3 sheets per ring, staggered vertical welds | Observed on built ships; not published | Medium |
| Nose | Rounded fairing, flat top with docking adapter | AmericaSpace (renders, unconfirmed) | Low |
| Docking | Dragon-derived androgynous system, on the nose | [NSF Nov 2025](https://www.nasaspaceflight.com/2025/11/starship-block-3-path-moon/) | High (system), Low (location) |
| Engines | 3 sea-level Raptors (centre puck) + 3 RVac (aft dome) | Wikipedia | High |
| Raptor bells | SL exit 1.30 m, engine 3.1 m long; RVac exit 2.4 m | [Wikipedia: Raptor](https://en.wikipedia.org/wiki/SpaceX_Raptor) (projections) | Medium |
| Bell shape | Rao parabola, throat radii 0.115 / 0.125 m (ε ≈ 32 / 92) | Estimate from exit size and typical expansion ratios | Low |
| Engine ring radii | SL 1.05 m, RVac 3.0 m | Estimate from bell sizes and hull | Low |
| Landing thrusters | 18 in 6 pods just below the cabin, canted 20° outward, exit at ~33 m | AmericaSpace (renders), SpaceX "mid-body high-thrust engines" | Medium (location), Low (count, cant) |
| RCS | 4 clusters at the nose, 4 aft, 3 nozzles each | Estimate (Starship carries nose and aft RCS) | Low |
| Legs | 4, stow flush in hull channels, telescoping, footpad radius 7.5 m, pads 3 m across | AmericaSpace (count, stowage); leg drop test (NSF) | Medium (count), Low (geometry) |
| Crew cabin / windows | 5 windows plus 2 small upper windows, ~38 m up on the elevator side | Futurism (interior renders Nov 2025), tech overview | Low (placement) |
| Airlocks | Two, 13 m³ each; outer hatch at 28.6–31.4 m on the elevator side (one exterior hatch modelled) | NSF (volume) | High (volume), Low (location) |
| Elevator | Platform on two hull rails, davit and four cables, ~28.5 m travel | Tech overview (~30 m drop), NASA test Dec 2023 | Medium |
| Solar arrays | 5 bays at 60° spacing (0° slot left for the elevator), arrays ~15 m hang along the hull after landing | AmericaSpace (renders; article says ~18 m) | Low–Medium |
| Antennas | 6, between the array bays | AmericaSpace | Low |
| Landing sensors | 3 pods on the engine section, looking down | Estimate (precision landing sensors tested per SpaceX) | Low |
| Centre of mass | 19 m above the pads (landing mass) | Estimate (`vehicles.js`) | Low |

Conflicts:
- **Solar power:** Wikipedia and older NASA-era renders describe a fixed band of panels around the body;
  the 2023 depiction shows deployable arrays. The model uses the 2023 arrays. Hanging vertically along
  the hull suits the pole, where the Sun is always within 1.5° of the horizon.
- **Finish:** published HLS images are white paint over steel. The setup screen offers a bare brushed
  stainless option (anisotropic) to show the test-ship look.

## Level of detail

| Level | Distance | Content |
|---|---|---|
| LOD0 | < 120 m | Full hull (192 segments) with procedural weld/seam/stain maps, windows, hatch, rails, davit, pods, bays, antennas, brackets, sensors, engine-bay shield |
| LOD1 | 120–600 m | 64-segment hull with maps, simplified pods, bays, windows |
| LOD2 | > 600 m | 20-segment silhouette |
| Engines | < / > 150 m | Full bell + inner wall + powerhead / light bell |

Static detail is merged per material, so the hull costs about a dozen draw calls. Maps are generated once
at load (no downloads) and cached.

## Blue Moon MK2

Still the earlier simplified model; being rebuilt next.
