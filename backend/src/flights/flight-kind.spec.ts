import { describe, expect, it } from 'vitest';
import { classifyFlight } from './flight-kind.js';

describe('classifyFlight', () => {
  it.each([
    ['both ends in India', true, true, 'domestic'],
    ['destination in India, origin abroad', false, true, 'arrival'],
    ['origin in India, destination abroad', true, false, 'departure'],
    ['neither end in India', false, false, 'overflight'],
  ] as const)('%s -> %s', (_label, origin, destination, expected) => {
    expect(classifyFlight(origin, destination)).toBe(expected);
  });

  it('never guesses when an end of the route is unknown', () => {
    expect(classifyFlight(null, null)).toBe('unknown');
    expect(classifyFlight(null, true)).toBe('unknown');
    expect(classifyFlight(true, null)).toBe('unknown');
    expect(classifyFlight(false, null)).toBe('unknown');
  });
});
