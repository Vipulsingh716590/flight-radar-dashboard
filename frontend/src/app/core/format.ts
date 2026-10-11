import type { FeedState } from './flight-stream';
import type { Flight, FlightKind } from './flight.models';

/** User-facing text for each feed state (header chip). */
export const FEED_LABEL: Record<FeedState, string> = {
  connecting: 'Connecting…',
  waiting: 'Fetching first data…',
  live: 'Live',
  partial: 'Live · partial coverage',
  stale: 'Data is getting old',
  down: 'Sources down · last known data',
  offline: 'Server unreachable · last known data',
};

export const KIND_LABEL: Record<FlightKind, string> = {
  arrival: 'Arrival',
  departure: 'Departure',
  domestic: 'Domestic',
  overflight: 'Overflight',
  unknown: 'Route unknown',
};

/** One colour per kind, used by map icons, list badges and the legend. */
export const KIND_COLOR: Record<FlightKind, string> = {
  arrival: '#4cc9f0',
  departure: '#3ddc84',
  domestic: '#ffb703',
  overflight: '#b388ff',
  unknown: '#8b98a5',
};

export const KINDS = Object.keys(KIND_LABEL) as FlightKind[];

export const feet = (metres: number | null): number | null =>
  metres === null ? null : Math.round(metres * 3.28084);

export const knots = (metresPerSecond: number | null): number | null =>
  metresPerSecond === null ? null : Math.round(metresPerSecond * 1.943844);

/** "DEL → BOM", or an em dash when the route is not known. */
export function routeLabel(flight: Flight): string {
  if (!flight.origin && !flight.destination) return '—';
  return `${flight.origin?.code ?? '?'} → ${flight.destination?.code ?? '?'}`;
}

/** Everything a user might type into the search box, lower-cased. */
export function searchText(flight: Flight): string {
  return [
    flight.callsign,
    flight.airline,
    flight.reg,
    flight.type,
    flight.id,
    flight.origin?.code,
    flight.origin?.city,
    flight.destination?.code,
    flight.destination?.city,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** How the plane icons are coloured on the map. */
export type ColorBy = 'route' | 'altitude';

/** Altitude bands in feet (upper bound exclusive) with their colours, low to high. */
export const ALTITUDE_BANDS = [
  { max: 1_000, color: '#ff7a00', label: '< 1,000' },
  { max: 5_000, color: '#f2c200', label: '1,000 – 5,000' },
  { max: 10_000, color: '#9be000', label: '5,000 – 10,000' },
  { max: 20_000, color: '#19c37d', label: '10,000 – 20,000' },
  { max: 30_000, color: '#18a0d8', label: '20,000 – 30,000' },
  { max: 40_000, color: '#5b6cf0', label: '30,000 – 40,000' },
  { max: Infinity, color: '#b04de8', label: '40,000 +' },
] as const;

/** Index into {@link ALTITUDE_BANDS}; unknown altitude falls into the lowest band. */
export function altitudeBand(metres: number | null): number {
  const feetValue = (metres ?? 0) * 3.28084;
  const index = ALTITUDE_BANDS.findIndex((band) => feetValue < band.max);
  return index === -1 ? ALTITUDE_BANDS.length - 1 : index;
}
