/**
 * A small METAR decoder: enough for the airport card (wind, visibility, sky,
 * temperature, pressure and the VFR/IFR category). Unknown groups are ignored,
 * the raw text is always shown next to the decoded values.
 */

export type FlightCategory = 'VFR' | 'MVFR' | 'IFR' | 'LIFR';

export interface CloudLayer {
  cover: 'FEW' | 'SCT' | 'BKN' | 'OVC' | 'VV';
  baseFt: number;
  type: string | null;
}

export interface Metar {
  raw: string;
  station: string;
  /** Day of month and UTC time as written in the report, e.g. "13 17:30Z". */
  observed: string | null;
  windDir: number | 'VRB' | null;
  windKt: number | null;
  gustKt: number | null;
  /** Visibility in metres (a 10 km or better report is 10000). */
  visibilityM: number | null;
  cavok: boolean;
  weather: string[];
  clouds: CloudLayer[];
  tempC: number | null;
  dewC: number | null;
  qnhHpa: number | null;
  category: FlightCategory | null;
}

const METRES_PER_STATUTE_MILE = 1609.34;
const PHENOMENON =
  /^[-+]?(VC)?(MI|BC|PR|DR|BL|SH|TS|FZ)?(DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+$/;

export function parseMetar(text: string): Metar | null {
  const raw = text.replace(/\s+/g, ' ').trim().replace(/=$/, '');
  if (!raw) return null;
  const tokens = raw.split(' ');
  // "METAR VIDP ..." or "VIDP ..." (SPECI is the same format).
  let index = tokens[0] === 'METAR' || tokens[0] === 'SPECI' ? 1 : 0;
  if (tokens[index] === 'COR') index += 1;
  const station = tokens[index];
  if (!station || !/^[A-Z0-9]{4}$/.test(station)) return null;
  index += 1;

  const metar: Metar = {
    raw,
    station,
    observed: null,
    windDir: null,
    windKt: null,
    gustKt: null,
    visibilityM: null,
    cavok: false,
    weather: [],
    clouds: [],
    tempC: null,
    dewC: null,
    qnhHpa: null,
    category: null,
  };

  // A whole number before a fraction: "1 1/2SM".
  let wholeMiles = 0;
  for (const token of tokens.slice(index)) {
    if (token === 'RMK' || token === 'TEMPO' || token === 'BECMG' || token === 'NOSIG') {
      if (token === 'RMK' || token === 'TEMPO' || token === 'BECMG') break;
      continue;
    }
    let match: RegExpExecArray | null;
    if ((match = /^(\d{2})(\d{2})(\d{2})Z$/.exec(token))) {
      metar.observed = `${match[1]} ${match[2]}:${match[3]}Z`;
    } else if ((match = /^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$/.exec(token))) {
      const factor = match[4] === 'MPS' ? 1.943844 : 1;
      metar.windDir = match[1] === 'VRB' ? 'VRB' : Number(match[1]);
      metar.windKt = Math.round(Number(match[2]) * factor);
      metar.gustKt = match[3] ? Math.round(Number(match[3]) * factor) : null;
    } else if (token === 'CAVOK') {
      metar.cavok = true;
      metar.visibilityM = 10_000;
    } else if ((match = /^(\d{4})$/.exec(token))) {
      metar.visibilityM = Number(match[1]);
    } else if (/^\d{1,2}$/.test(token)) {
      wholeMiles = Number(token);
    } else if ((match = /^(\d+)(?:\/(\d+))?SM$/.exec(token))) {
      const part = match[2] ? Number(match[1]) / Number(match[2]) : Number(match[1]);
      metar.visibilityM = Math.round((wholeMiles + part) * METRES_PER_STATUTE_MILE);
    } else if ((match = /^(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU)?$/.exec(token))) {
      metar.clouds.push({
        cover: match[1] as CloudLayer['cover'],
        baseFt: Number(match[2]) * 100,
        type: match[3] ?? null,
      });
    } else if ((match = /^VV(\d{3})$/.exec(token))) {
      metar.clouds.push({ cover: 'VV', baseFt: Number(match[1]) * 100, type: null });
    } else if ((match = /^(M?\d{2})\/(M?\d{2})?$/.exec(token))) {
      metar.tempC = signed(match[1]!);
      metar.dewC = match[2] ? signed(match[2]) : null;
    } else if ((match = /^Q(\d{4})$/.exec(token))) {
      metar.qnhHpa = Number(match[1]);
    } else if ((match = /^A(\d{4})$/.exec(token))) {
      metar.qnhHpa = Math.round((Number(match[1]) / 100) * 33.8639);
    } else if (PHENOMENON.test(token)) {
      metar.weather.push(token);
    }
  }

  metar.category = flightCategory(metar);
  return metar;
}

function signed(value: string): number {
  return value.startsWith('M') ? -Number(value.slice(1)) : Number(value);
}

/** FAA/ICAO-style category from visibility and the lowest broken/overcast layer. */
export function flightCategory(
  metar: Pick<Metar, 'visibilityM' | 'clouds' | 'cavok'>,
): FlightCategory | null {
  if (metar.cavok) return 'VFR';
  const ceiling = metar.clouds
    .filter((layer) => layer.cover === 'BKN' || layer.cover === 'OVC' || layer.cover === 'VV')
    .reduce<number | null>(
      (lowest, layer) => (lowest === null ? layer.baseFt : Math.min(lowest, layer.baseFt)),
      null,
    );
  const visibility = metar.visibilityM;
  if (visibility === null && ceiling === null) return null;

  const miles = visibility === null ? Infinity : visibility / METRES_PER_STATUTE_MILE;
  const ceil = ceiling ?? Infinity;
  if (ceil < 500 || miles < 1) return 'LIFR';
  if (ceil < 1000 || miles < 3) return 'IFR';
  if (ceil <= 3000 || miles <= 5) return 'MVFR';
  return 'VFR';
}

/** "SCT 3,500 ft, BKN 12,000 ft" or "No significant cloud". */
export function describeClouds(metar: Pick<Metar, 'clouds' | 'cavok'>): string {
  if (metar.clouds.length === 0)
    return metar.cavok ? 'CAVOK (no cloud below 5,000 ft)' : 'No significant cloud';
  return metar.clouds
    .map(
      (layer) =>
        `${layer.cover} ${layer.baseFt.toLocaleString('en-US')} ft${layer.type ? ' ' + layer.type : ''}`,
    )
    .join(', ');
}
