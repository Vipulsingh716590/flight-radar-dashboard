import type { Flight } from './flight.models';

/** Never extrapolate further than this; after that the position is too uncertain. */
export const MAX_EXTRAPOLATION_S = 180;
const METRES_PER_DEG_LAT = 111_320;

/**
 * Dead-reckons a plane forward from its last reported fix using speed and
 * heading, so markers glide between data refreshes. Flat-earth maths is
 * accurate enough for the few kilometres involved.
 */
export function project(flight: Flight, nowMs: number): [lon: number, lat: number] {
  if (flight.speed === null || flight.heading === null) return [flight.lon, flight.lat];
  const seconds = Math.min(Math.max((nowMs - flight.t) / 1000, 0), MAX_EXTRAPOLATION_S);
  const distance = flight.speed * seconds;
  const heading = (flight.heading * Math.PI) / 180;
  const dLat = (distance * Math.cos(heading)) / METRES_PER_DEG_LAT;
  const cosLat = Math.max(Math.cos((flight.lat * Math.PI) / 180), 0.01);
  const dLon = (distance * Math.sin(heading)) / (METRES_PER_DEG_LAT * cosLat);
  return [flight.lon + dLon, flight.lat + dLat];
}
