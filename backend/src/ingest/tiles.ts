import booleanIntersects from '@turf/boolean-intersects';
import { polygon } from '@turf/helpers';
import type { IndiaArea } from '../flights/india-filter.js';

/** One circular query for the adsb.fi lat/lon/dist endpoint. */
export interface Tile {
  lat: number;
  lon: number;
  radiusNm: number;
}

/** India's bounding box (see project brief); the polygon filter trims the rest. */
export const INDIA_BBOX = { minLat: 6, maxLat: 37.5, minLon: 68, maxLon: 98 } as const;

/** adsb.fi's documented maximum radius for the point query. */
const MAX_RADIUS_NM = 250;
/** 5.5 deg cells have a half-diagonal of ~420 km (~226 NM), inside the 250 NM circle. */
const CELL_DEG = 5.5;

/**
 * Covers India with overlapping 250 NM circles. The bounding box is cut into
 * a grid and every cell that touches the India area becomes one query, so
 * cells that are pure ocean or foreign territory cost no requests.
 */
export function buildTiles(area: IndiaArea): Tile[] {
  const tiles: Tile[] = [];
  const { minLat, maxLat, minLon, maxLon } = INDIA_BBOX;
  for (let south = minLat; south < maxLat; south += CELL_DEG) {
    for (let west = minLon; west < maxLon; west += CELL_DEG) {
      const north = south + CELL_DEG;
      const east = west + CELL_DEG;
      const cell = polygon([
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ]);
      if (booleanIntersects(cell, area)) {
        tiles.push({
          lat: round((south + north) / 2),
          lon: round((west + east) / 2),
          radiusNm: MAX_RADIUS_NM,
        });
      }
    }
  }
  return tiles;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
