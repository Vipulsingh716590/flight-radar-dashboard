import type { Flight } from './flight.models';

/** Transponder codes a pilot sets to declare an emergency. */
export const EMERGENCY_SQUAWKS: Record<string, string> = {
  '7500': 'Hijack',
  '7600': 'Radio failure',
  '7700': 'General emergency',
};

/** The emergency meaning of a flight's squawk code, or null. */
export function emergencyOf(flight: Pick<Flight, 'squawk'>): string | null {
  return flight.squawk ? (EMERGENCY_SQUAWKS[flight.squawk] ?? null) : null;
}
