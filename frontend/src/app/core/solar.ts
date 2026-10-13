/**
 * Where the sun is, and the shape of the night on a flat map.
 * Low-precision solar position (NOAA / Astronomical Almanac approximation,
 * good to a fraction of a degree), which is plenty for a shaded overlay.
 */

const RAD = Math.PI / 180;

export interface SubsolarPoint {
  /** Degrees, -90..90: the latitude where the sun is straight overhead. */
  lat: number;
  /** Degrees, -180..180. */
  lon: number;
}

export function subsolarPoint(date: Date): SubsolarPoint {
  const days = date.getTime() / 86_400_000 + 2440587.5 - 2451545.0;
  const meanLongitude = mod(280.46 + 0.9856474 * days, 360);
  const anomaly = mod(357.528 + 0.9856003 * days, 360) * RAD;
  const eclipticLongitude =
    (meanLongitude + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * RAD;
  const obliquity = (23.439 - 0.0000004 * days) * RAD;

  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
  const rightAscension = Math.atan2(
    Math.cos(obliquity) * Math.sin(eclipticLongitude),
    Math.cos(eclipticLongitude),
  );
  const greenwichSiderealDeg = mod(280.46061837 + 360.98564736629 * days, 360);

  return {
    lat: declination / RAD,
    lon: mod(rightAscension / RAD - greenwichSiderealDeg + 180, 360) - 180,
  };
}

/** Sun altitude in degrees at a place (negative = below the horizon). */
export function sunAltitude(lat: number, lon: number, date: Date): number {
  const sun = subsolarPoint(date);
  const phi = lat * RAD;
  const delta = sun.lat * RAD;
  const hourAngle = (lon - sun.lon) * RAD;
  const sinAlt =
    Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(hourAngle);
  return Math.asin(clamp(sinAlt, -1, 1)) / RAD;
}

/**
 * Ring of [lon, lat] points enclosing every place where the sun is lower than
 * `altitudeDeg` (0 = night, -6 = civil twilight is over, ...). The ring runs
 * along the terminator and closes over the pole that is in darkness.
 */
export function nightRing(date: Date, altitudeDeg = 0, stepDeg = 3): [number, number][] {
  const sun = subsolarPoint(date);
  const delta = sun.lat * RAD;
  const sinH = Math.sin(altitudeDeg * RAD);
  // The pole in darkness is the one opposite to the sun's hemisphere.
  const nightPole = delta >= 0 ? -90 : 90;
  const ring: [number, number][] = [];

  for (let lon = -180; lon <= 180; lon += stepDeg) {
    const hourAngle = (lon - sun.lon) * RAD;
    // sin(alt) = a*sin(phi) + b*cos(phi) = r*sin(phi + shift)
    const a = Math.sin(delta);
    const b = Math.cos(delta) * Math.cos(hourAngle);
    const r = Math.hypot(a, b);
    const shift = Math.atan2(b, a);
    const ratio = r === 0 ? 2 : sinH / r;

    let lat: number;
    if (Math.abs(ratio) > 1) {
      // No crossing on this meridian: it is entirely above or entirely below the threshold.
      lat = sinH > 0 ? -nightPole : nightPole;
    } else {
      const candidates = [Math.asin(ratio) - shift, Math.PI - Math.asin(ratio) - shift].map(wrap);
      const inRange = candidates.filter((phi) => Math.abs(phi) <= Math.PI / 2 + 1e-9);
      // Prefer the crossing where the sun gets lower towards the night pole.
      lat = (pickCrossing(inRange, a, b, nightPole) ?? 0) / RAD;
    }
    ring.push([lon, clamp(lat, -89.9, 89.9)]);
  }
  ring.push([180, nightPole === 90 ? 89.9 : -89.9], [-180, nightPole === 90 ? 89.9 : -89.9]);
  ring.push(ring[0]!);
  return ring;
}

/** Of the candidate latitudes (radians), the one where altitude falls towards the night pole. */
function pickCrossing(
  candidates: number[],
  a: number,
  b: number,
  nightPole: number,
): number | null {
  if (candidates.length === 0) return null;
  const slope = (phi: number) => a * Math.cos(phi) - b * Math.sin(phi); // d(sin alt)/d(phi)
  const wantFalling = nightPole === 90; // moving north the altitude must fall
  const match = candidates.find((phi) => slope(phi) < 0 === wantFalling);
  return match ?? candidates[0]!;
}

function wrap(angle: number): number {
  let value = angle;
  while (value > Math.PI) value -= 2 * Math.PI;
  while (value <= -Math.PI) value += 2 * Math.PI;
  return value;
}

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
