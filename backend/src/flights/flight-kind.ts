/**
 * How a flight relates to India, derived only from its (known) route:
 *
 * - `arrival`    lands in India, departed from abroad
 * - `departure`  departed from India, lands abroad
 * - `domestic`   both ends in India
 * - `overflight` neither end in India (just crossing Indian airspace)
 * - `unknown`    route not known, so nothing is guessed
 */
export type FlightKind = 'arrival' | 'departure' | 'domestic' | 'overflight' | 'unknown';

/** `true`/`false` when the airport is known to be in/out of India, `null` when unknown. */
export type InIndia = boolean | null;

export function classifyFlight(originInIndia: InIndia, destinationInIndia: InIndia): FlightKind {
  if (originInIndia === null || destinationInIndia === null) return 'unknown';
  if (originInIndia && destinationInIndia) return 'domestic';
  if (destinationInIndia) return 'arrival';
  if (originInIndia) return 'departure';
  return 'overflight';
}
