// Precomputes the buffered India area (data/india-buffered.geojson).
//
// Buffering the detailed border at start-up takes tens of MB of heap and a lot
// of CPU, which is too much for a 512 MB / 0.1 CPU free host. The result only
// depends on data/india.geojson and the buffer distance, so it is built once
// and shipped as a data file.
//
//   node scripts/build-india-area.mjs [bufferKm]      (default 50, same as INDIA_BUFFER_KM)
import { readFileSync, writeFileSync } from 'node:fs';
import buffer from '@turf/buffer';

const bufferKm = Number(process.argv[2] ?? 50);
if (!Number.isFinite(bufferKm) || bufferKm <= 0) {
  console.error('bufferKm must be a positive number');
  process.exit(1);
}

const source = JSON.parse(readFileSync('data/india.geojson', 'utf8'));
const buffered = buffer(source, bufferKm, { units: 'kilometers' });

// 0.001 degree is about 100 m: far below the accuracy of the border data itself.
const round = (n) => Math.round(n * 1000) / 1000;
const roundRing = (ring) => {
  const out = [];
  for (const [lon, lat] of ring) {
    const point = [round(lon), round(lat)];
    const last = out[out.length - 1];
    if (!last || last[0] !== point[0] || last[1] !== point[1]) out.push(point);
  }
  return out;
};
const geometry = buffered.geometry;
const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
const coordinates = polygons
  .map((polygon) => polygon.map(roundRing).filter((ring) => ring.length >= 4))
  .filter((polygon) => polygon.length > 0);

const output = {
  type: 'Feature',
  properties: { name: 'India (buffered)', bufferKm, source: 'data/india.geojson' },
  geometry: { type: 'MultiPolygon', coordinates },
};
writeFileSync('data/india-buffered.geojson', JSON.stringify(output));
const kb = Math.round(JSON.stringify(output).length / 1024);
console.log(`wrote data/india-buffered.geojson (${bufferKm} km, ${coordinates.length} polygons, ${kb} KB)`);
