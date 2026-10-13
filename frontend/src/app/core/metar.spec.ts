import { describe, expect, it } from 'vitest';
import { describeClouds, flightCategory, parseMetar } from './metar';

describe('parseMetar', () => {
  it('decodes a typical Delhi report', () => {
    const metar = parseMetar('VIDP 131730Z VRB02KT 3500 HZ FEW035 27/21 Q1016 NOSIG=')!;
    expect(metar.station).toBe('VIDP');
    expect(metar.observed).toBe('13 17:30Z');
    expect(metar.windDir).toBe('VRB');
    expect(metar.windKt).toBe(2);
    expect(metar.visibilityM).toBe(3500);
    expect(metar.weather).toEqual(['HZ']);
    expect(metar.clouds).toEqual([{ cover: 'FEW', baseFt: 3500, type: null }]);
    expect(metar.tempC).toBe(27);
    expect(metar.dewC).toBe(21);
    expect(metar.qnhHpa).toBe(1016);
    // 3.5 km is just over 2 statute miles, with no ceiling: IFR (< 3 SM).
    expect(metar.category).toBe('IFR');
  });

  it('handles gusts, negative temperatures and CAVOK', () => {
    const metar = parseMetar('METAR VABB 131800Z 24015G27KT CAVOK M02/M05 Q1008')!;
    expect(metar.windDir).toBe(240);
    expect(metar.windKt).toBe(15);
    expect(metar.gustKt).toBe(27);
    expect(metar.cavok).toBe(true);
    expect(metar.tempC).toBe(-2);
    expect(metar.dewC).toBe(-5);
    expect(metar.category).toBe('VFR');
  });

  it('reads US style visibility and altimeter', () => {
    const metar = parseMetar('KJFK 131751Z 18010KT 1 1/2SM BR OVC008 12/11 A2992')!;
    expect(metar.visibilityM).toBe(2414);
    expect(metar.qnhHpa).toBe(1013);
    expect(metar.clouds[0]).toEqual({ cover: 'OVC', baseFt: 800, type: null });
    expect(metar.category).toBe('IFR');
  });

  it('rejects text that is not a report', () => {
    expect(parseMetar('')).toBeNull();
    expect(parseMetar('No METAR available')).toBeNull();
  });

  it('stops at remarks', () => {
    const metar = parseMetar('VOBL 131730Z 27005KT 6000 SCT025 22/18 Q1014 RMK BKN005')!;
    expect(metar.clouds).toHaveLength(1);
  });
});

describe('flightCategory', () => {
  const base = { cavok: false, clouds: [], visibilityM: 10_000 };
  it('classifies by ceiling and visibility', () => {
    expect(flightCategory(base)).toBe('VFR');
    expect(flightCategory({ ...base, clouds: [{ cover: 'BKN', baseFt: 2500, type: null }] })).toBe(
      'MVFR',
    );
    expect(flightCategory({ ...base, clouds: [{ cover: 'OVC', baseFt: 800, type: null }] })).toBe(
      'IFR',
    );
    expect(flightCategory({ ...base, clouds: [{ cover: 'OVC', baseFt: 300, type: null }] })).toBe(
      'LIFR',
    );
    expect(flightCategory({ ...base, visibilityM: 900 })).toBe('LIFR');
    expect(flightCategory({ ...base, clouds: [{ cover: 'FEW', baseFt: 300, type: null }] })).toBe(
      'VFR',
    );
  });

  it('describes clouds', () => {
    expect(describeClouds({ cavok: true, clouds: [] })).toContain('CAVOK');
    expect(
      describeClouds({ cavok: false, clouds: [{ cover: 'SCT', baseFt: 3500, type: 'CB' }] }),
    ).toBe('SCT 3,500 ft CB');
  });
});
