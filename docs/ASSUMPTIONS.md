# Model assumptions and sources

Every vehicle number lives in `src/core/vehicles.js`, tagged **(P)** published or **(E)** estimate.
This file explains the estimates and the physics choices so a reviewer can check them.

## Environment

| Item | Value | Source |
|---|---|---|
| Moon GM | 4.9048695e12 m³/s² | NASA Moon Fact Sheet |
| Reference radius | 1737.4 km | LOLA reference sphere |
| Surface gravity | ~1.62 m/s² (computed from GM, R) | — |
| Sun elevation at the pole | within ±1.54° (axial tilt to ecliptic) | NASA |
| Sun angular diameter | 0.53° | — |
| Atmosphere | none: black sky, no haze, ballistic dust | — |
| Earth | ~1.9° across, a few degrees above the horizon | libration keeps it low at the pole |

Rotation of the Moon is ignored: at 89.5° S the surface moves at under 4 cm/s.

## Starship HLS

| Item | Value | Basis |
|---|---|---|
| Height / diameter | 52.3 m / 9 m | Published |
| Main engines | 3 sea-level Raptors used for descent | Published architecture |
| Raptor thrust | 2.55 MN each (vacuum) | Estimate, Raptor 2/3 class |
| Raptor throttle floor | 40% | Estimate |
| Raptor Isp | 355 s | Estimate for a sea-level bell in vacuum |
| Landing thrusters | 24 × 50 kN, Isp 300 s, mid-body, ~70% of height | SpaceX describes high-thrust mid-body thrusters burning gaseous O₂/CH₄ for the last ~100 m; count, thrust and Isp are estimates |
| Dry mass | 120 t | Public estimates span roughly 85–120 t |
| Crew + cargo | 12 t | Estimate |
| Propellant at PDI | 300 t | Estimate, sized so ascent to low lunar orbit stays positive |
| Footpad radius / legs | 6.5 m / 6 | Estimate |
| Centre of mass height | 19 m | Estimate (heavy engines and residual propellant low) |
| Touchdown limits | 2.0 m/s sink, 0.8 m/s drift, 4° attitude, 8° slope | Estimates |

**Why two engine sets.** At landing mass (~250 t) lunar weight is ~400 kN. One Raptor at its floor still makes
~1 MN, so the vehicle cannot hover on Raptors. The sim reproduces this: guidance coasts when the floor is too
high and hands over to the landing thrusters at about 160 m.

## Blue Moon MK2

| Item | Value | Basis |
|---|---|---|
| Height | 16 m | Published |
| Dry mass | 16 t | Published |
| Engines | 3 × BE-7, LOX/LH₂ | Published |
| BE-7 thrust / Isp / throttle | 44 kN / 460 s / 20–100% | Published |
| Propellant at PDI | 27 t | Estimate (launch mass >45 t published) |
| Diameter, legs, CG | 7 m, 4 legs at 5 m, 6.5 m | Estimates |

Losing one BE-7 early in braking leaves a thrust-to-weight near 1.2, which cannot null 1.7 km/s in time.
The guidance detects that no landing solution exists and aborts to orbit.

## Guidance

- **Law:** energy-optimal zero-effort-miss / zero-effort-velocity (ZEM/ZEV) feedback, re-solved every 20 ms step,
  `a = 6·ZEM/t² − 2·ZEV/t`, with gravity evaluated at the current position.
- **Time-to-go:** chosen per phase as the shortest value whose linear acceleration profile stays under the
  crew acceleration cap and the engines' maximum, and above the throttle floor.
- **Phases:** BRAKING (main engines) → APPROACH → TERMINAL (rate-of-descent profile, drift nulling),
  in the spirit of Apollo's P63 / P64 / P66.
- **Abort:** after an engine failure, if the re-planned trajectory violates the thrust limits by more than 12%,
  the vehicle burns prograde to a safe orbit.

## Dynamics

- Translational point mass in Moon-centred inertial coordinates, central gravity, semi-implicit Euler at 50 Hz.
- Attitude is the thrust axis only, slewed toward the command at a fixed maximum rate (HLS 8°/s, MK2 10°/s).
- Throttle follows the command with a first-order lag; engines run in whole units between floor and 100%.
- Mass flow `ṁ = T / (Isp · g₀)`.

Not modelled yet: rotational inertia and RCS propellant, slosh, engine gimbal limits, navigation sensor error,
terrain-relative navigation, plume-induced cratering, thermal limits.

## Terrain and light

- **Real data path:** NASA LOLA DEMs via `tools/lola_to_heightmap.py`.
- **Analog terrain:** procedural, built from Shackleton's real size (21 km rim, ~4.2 km deep, ~6.6 km floor),
  the connecting ridge toward de Gerlache (~32 km), power-law small craters and boulders. It is a stand-in.
- **Boulders:** LOLA cannot resolve metre-scale rocks, so boulders are always statistical.
- **Lighting:** for every terrain vertex the code marches toward the Sun up to 60 km, tracks the highest
  horizon angle including the Moon's curvature drop (d²/2R), and converts the gap to the Sun's elevation into
  the visible fraction of the 0.53° disk.
