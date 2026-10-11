import type { Flight } from './flight.models';

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in kilometres. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface RouteProgress {
  flownKm: number;
  remainingKm: number;
  /** 0..1 share of the (straight-line) trip already flown. */
  fraction: number;
  /**
   * False when the aircraft is far off the origin -> destination line, which
   * means the callsign-derived route is probably not this flight's route.
   */
  plausible: boolean;
}

/** A detour of up to this share of the direct distance (or 150 km) is normal routing. */
const MAX_DETOUR_SHARE = 0.25;
const MIN_DETOUR_ALLOWANCE_KM = 150;

/**
 * How far along its route a flight is, from the straight-line distances
 * origin -> plane and plane -> destination. Only available when both airports
 * have known coordinates; it is an estimate, not the flown distance.
 */
export function routeProgress(flight: Flight): RouteProgress | null {
  const { origin, destination } = flight;
  if (
    origin?.lat == null || origin.lon == null ||
    destination?.lat == null || destination.lon == null
  ) {
    return null;
  }
  const flownKm = haversineKm(origin.lat, origin.lon, flight.lat, flight.lon);
  const remainingKm = haversineKm(flight.lat, flight.lon, destination.lat, destination.lon);
  const total = flownKm + remainingKm;
  if (total < 1) return null;
  const direct = haversineKm(origin.lat, origin.lon, destination.lat, destination.lon);
  const allowance = Math.max(MIN_DETOUR_ALLOWANCE_KM, direct * MAX_DETOUR_SHARE);
  return {
    flownKm,
    remainingKm,
    fraction: Math.min(1, Math.max(0, flownKm / total)),
    plausible: total - direct <= allowance,
  };
}
