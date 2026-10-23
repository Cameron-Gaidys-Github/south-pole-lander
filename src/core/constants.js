// Physical constants for the Moon and propulsion.
// Sources: NASA Moon Fact Sheet (nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html)

export const MOON = {
  mu: 4.9048695e12,      // gravitational parameter, m^3/s^2
  radius: 1737400,       // mean radius, m (LOLA reference sphere)
  rotationPeriod: 27.321661 * 86400, // sidereal, s (negligible at the pole; ignored)
};

export const G0 = 9.80665; // standard gravity, m/s^2 (for Isp -> exhaust velocity)

// Surface gravity at the reference radius: ~1.62 m/s^2
export const G_MOON = MOON.mu / (MOON.radius * MOON.radius);

// Sun geometry at the lunar south pole. The Moon's spin axis is tilted only
// ~1.54 deg to the ecliptic, so at the pole the Sun skims the horizon:
// elevation stays within about +/-1.5 deg all year.
export const SOUTH_POLE_SUN = {
  maxElevationDeg: 1.54,
};
