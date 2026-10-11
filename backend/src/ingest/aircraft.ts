/**
 * Provider-neutral aircraft state. All units are SI (metres, metres/second,
 * degrees) so the rest of the app never has to care which feed a plane came
 * from. A field is `null` when the feed did not report it - never guessed.
 */
export interface Aircraft {
  /** 24-bit ICAO transponder address, lower-case hex. */
  icao24: string;
  callsign: string | null;
  lat: number;
  lon: number;
  altitudeM: number | null;
  speedMs: number | null;
  /** Track over ground, degrees clockwise from north. */
  headingDeg: number | null;
  verticalRateMs: number | null;
  onGround: boolean;
  registration: string | null;
  aircraftType: string | null;
  squawk: string | null;
  /** Epoch ms of the position fix. */
  positionAt: number;
}

export interface ProviderResult {
  aircraft: Aircraft[];
  /** True when some of the requested area could not be fetched. */
  partial: boolean;
}

export interface FlightProvider {
  readonly name: string;
  fetchAircraft(): Promise<ProviderResult>;
}

/** Thrown by providers; `retryAfterMs` asks the scheduler to skip the provider for a while. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export const FLIGHT_PROVIDERS = Symbol('FLIGHT_PROVIDERS');

export const FEET_TO_M = 0.3048;
export const KNOTS_TO_MS = 0.514444;
export const FPM_TO_MS = 0.00508;
