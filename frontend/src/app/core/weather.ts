import { Injectable } from '@angular/core';

/**
 * Weather from two free public APIs that need no key and allow browser calls:
 *  - Open-Meteo (https://open-meteo.com): current conditions and the wind at
 *    the 250 hPa level (about 34,000 ft, jet-stream height) for a point.
 *  - RainViewer (https://www.rainviewer.com/api.html): a list of recent radar
 *    frames; the map draws their raster tiles as an overlay.
 * They are called straight from the browser (not through our API), so they do
 * not load the Render backend.
 */
const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
const RAINVIEWER = 'https://api.rainviewer.com/public/weather-maps.json';
const TIMEOUT_MS = 8000;

export interface Conditions {
  tempC: number;
  windKt: number;
  windDir: number;
  cloudPct: number;
  visibilityKm: number | null;
  pressureHpa: number;
  precipMm: number;
  code: number;
  /** Wind at ~34,000 ft; null when the model has no value. */
  jetKt: number | null;
  jetDir: number | null;
  /** ISO time of the observation (UTC). */
  time: string;
}

export interface RadarFrames {
  host: string;
  /** Oldest first. */
  frames: { path: string; time: number }[];
}

@Injectable({ providedIn: 'root' })
export class Weather {
  async conditions(lat: number, lon: number): Promise<Conditions> {
    const params = new URLSearchParams({
      latitude: lat.toFixed(3),
      longitude: lon.toFixed(3),
      current:
        'temperature_2m,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation,weather_code,visibility,pressure_msl',
      hourly: 'wind_speed_250hPa,wind_direction_250hPa',
      forecast_hours: '1',
      wind_speed_unit: 'kn',
    });
    const response = await fetch(`${OPEN_METEO}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Open-Meteo answered ${response.status}`);
    const body = (await response.json()) as {
      current: Record<string, number | string | null>;
      hourly?: Record<string, (number | null)[]>;
    };
    const c = body.current;
    const visibility = c['visibility'];
    return {
      tempC: Number(c['temperature_2m']),
      windKt: Number(c['wind_speed_10m']),
      windDir: Number(c['wind_direction_10m']),
      cloudPct: Number(c['cloud_cover']),
      visibilityKm: typeof visibility === 'number' ? visibility / 1000 : null,
      pressureHpa: Number(c['pressure_msl']),
      precipMm: Number(c['precipitation']),
      code: Number(c['weather_code']),
      jetKt: body.hourly?.['wind_speed_250hPa']?.[0] ?? null,
      jetDir: body.hourly?.['wind_direction_250hPa']?.[0] ?? null,
      time: String(c['time']),
    };
  }

  async radarFrames(): Promise<RadarFrames> {
    const response = await fetch(RAINVIEWER, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`RainViewer answered ${response.status}`);
    const body = (await response.json()) as {
      host: string;
      radar?: { past?: { path: string; time: number }[] };
    };
    return { host: body.host, frames: body.radar?.past ?? [] };
  }
}

/** WMO weather-interpretation code -> short text. */
export function weatherText(code: number): string {
  if (code === 0) return 'Clear sky';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Rain showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code === 95) return 'Thunderstorm';
  if (code === 96 || code === 99) return 'Thunderstorm with hail';
  return 'Unknown';
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** 0-360 degrees -> "NNE". */
export function compass(degrees: number): string {
  return COMPASS[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16]!;
}
