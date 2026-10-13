import { describe, expect, it } from 'vitest';
import type { ReplayFrame } from './api';
import { sampleFrames } from './replay';

const frame = (t: number, ...aircraft: [string, number, number][]): ReplayFrame => ({
  t,
  f: aircraft.map(([id, lat, lon]) => [
    id,
    lat,
    lon,
    90,
    10_000,
    'domestic',
    id.toUpperCase(),
    null,
    null,
  ]),
});

describe('sampleFrames', () => {
  const frames = [frame(0, ['aaa', 10, 70], ['bbb', 20, 80]), frame(60_000, ['aaa', 12, 72])];

  it('interpolates aircraft present in both surrounding frames', () => {
    const [a] = sampleFrames(frames, 30_000);
    expect(a!.id).toBe('aaa');
    expect(a!.lat).toBeCloseTo(11);
    expect(a!.lon).toBeCloseTo(71);
  });

  it('keeps aircraft that are only in the earlier frame where they were', () => {
    const items = sampleFrames(frames, 30_000);
    expect(items.find((item) => item.id === 'bbb')).toMatchObject({ lat: 20, lon: 80 });
  });

  it('returns the first and last frame at the ends', () => {
    expect(sampleFrames(frames, 0)).toHaveLength(2);
    const last = sampleFrames(frames, 60_000);
    expect(last).toHaveLength(1);
    expect(last[0]!.lat).toBe(12);
  });

  it('does not bridge a long recording gap', () => {
    const gap = [frame(0, ['aaa', 10, 70]), frame(20 * 60_000, ['aaa', 30, 90])];
    expect(sampleFrames(gap, 10 * 60_000)).toEqual([]);
    expect(sampleFrames(gap, 2 * 60_000)).toHaveLength(1);
  });

  it('is empty without frames', () => {
    expect(sampleFrames([], 5)).toEqual([]);
  });
});
