import { existsSync, readFileSync } from 'node:fs';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import buffer from '@turf/buffer';
import { point } from '@turf/helpers';
import type { Feature, MultiPolygon, Polygon } from 'geojson';

export type IndiaArea = Feature<Polygon | MultiPolygon>;

type Bounds = [minLon: number, minLat: number, maxLon: number, maxLat: number];

/**
 * Decides whether a position counts as "over India".
 *
 * - Inside the India polygon: always India.
 * - Inside the (wider) buffered polygon: India only if the point is not over
 *   another country's land. The buffer exists so planes on final approach
 *   over the sea still count, without pulling in Lahore or Dhaka just
 *   because they are within a few dozen km of the border.
 *
 * A bounding-box pre-check rejects most foreign traffic before the (much
 * slower) polygon tests run.
 */
export class IndiaFilter {
  /** Widest area considered India (used to plan provider queries). */
  readonly area: IndiaArea;
  private readonly strict: IndiaArea;
  private readonly strictBounds: Bounds;
  private readonly areaBounds: Bounds;
  private readonly neighbours: IndiaArea | null;
  private readonly neighbourBounds: Bounds | null;

  constructor(strict: IndiaArea, buffered: IndiaArea = strict, neighbours: IndiaArea | null = null) {
    this.strict = strict;
    this.area = buffered;
    this.strictBounds = boundsOf(strict);
    this.areaBounds = boundsOf(buffered);
    this.neighbours = neighbours;
    this.neighbourBounds = neighbours ? boundsOf(neighbours) : null;
  }

  contains(lat: number, lon: number): boolean {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    if (!inBounds(lat, lon, this.areaBounds)) return false;

    const position = point([lon, lat]);
    if (inBounds(lat, lon, this.strictBounds) && booleanPointInPolygon(position, this.strict)) {
      return true;
    }
    if (this.area === this.strict || !booleanPointInPolygon(position, this.area)) return false;
    return !this.overNeighbourLand(position, lat, lon);
  }

  private overNeighbourLand(position: ReturnType<typeof point>, lat: number, lon: number): boolean {
    if (!this.neighbours || !this.neighbourBounds) return false;
    return (
      inBounds(lat, lon, this.neighbourBounds) &&
      booleanPointInPolygon(position, this.neighbours)
    );
  }
}

/**
 * Reads the India polygon (and optionally a neighbours land mask) from
 * GeoJSON Features and applies the buffer.
 */
export function loadIndiaFilter(
  path: string,
  bufferKm: number,
  neighboursPath?: string,
  precomputedPath?: string,
): IndiaFilter {
  const strict = readArea(path);
  let buffered = strict;
  if (bufferKm > 0) {
    // Buffering the full border needs a lot of heap and CPU (too much for a small
    // free host), so a pre-built file (scripts/build-india-area.mjs) is preferred.
    const precomputed = precomputedPath && existsSync(precomputedPath) ? readArea(precomputedPath) : null;
    const precomputedKm = (precomputed?.properties as { bufferKm?: number } | null)?.bufferKm;
    buffered =
      precomputed && precomputedKm === bufferKm
        ? precomputed
        : (buffer(strict, bufferKm, { units: 'kilometers' }) as IndiaArea);
  }
  const neighbours = neighboursPath && bufferKm > 0 ? readArea(neighboursPath) : null;
  return new IndiaFilter(strict, buffered, neighbours);
}

function readArea(path: string): IndiaArea {
  const feature = JSON.parse(readFileSync(path, 'utf8')) as IndiaArea;
  if (feature.type !== 'Feature' || !/^(Multi)?Polygon$/.test(feature.geometry.type)) {
    throw new Error(`${path} must contain a Polygon or MultiPolygon Feature`);
  }
  return feature;
}

function inBounds(lat: number, lon: number, [minLon, minLat, maxLon, maxLat]: Bounds): boolean {
  return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
}

function boundsOf(area: IndiaArea): Bounds {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  const polygons =
    area.geometry.type === 'Polygon' ? [area.geometry.coordinates] : area.geometry.coordinates;
  for (const polygon of polygons) {
    for (const [lon, lat] of polygon[0]) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return [minLon, minLat, maxLon, maxLat];
}
