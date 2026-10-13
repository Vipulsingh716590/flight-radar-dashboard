// Draws the app icons (public/icons/*.png) with no dependencies: a plane
// silhouette on a dark rounded square, supersampled for smooth edges.
// Run: node scripts/make-icons.mjs   (the PNGs are committed; re-run to change them)
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

// North-pointing plane outline on a 64 x 64 grid (same shape as the map icon).
const PLANE = [
  [32, 3], [36, 18], [60, 36], [60, 42], [36, 34], [34, 50], [44, 56],
  [44, 61], [32, 58], [20, 61], [20, 56], [30, 50], [28, 34], [4, 42],
  [4, 36], [28, 18],
];
const BACKGROUND = [15, 20, 25];
const ACCENT = [255, 183, 3];
const GLOW = [31, 41, 51];

function inside(polygon, x, y) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * size: pixels. planeScale: plane height as a share of the icon.
 * rounded: corner radius share (0 = full bleed, for maskable icons).
 */
function render(size, planeScale, rounded) {
  const SS = 3; // samples per axis
  const rgba = Buffer.alloc(size * size * 4);
  const planeSize = size * planeScale;
  const offset = (size - planeSize) / 2;
  const scale = planeSize / 64;
  // Rotate the plane 45 degrees (pointing up-right) around the icon centre.
  const angle = Math.PI / 4;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const centre = size / 2;
  const polygon = PLANE.map(([px, py]) => {
    const x = offset + px * scale - centre;
    const y = offset + py * scale - centre;
    return [x * cos - y * sin + centre, x * sin + y * cos + centre];
  });
  const radius = rounded * size;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let plane = 0;
      let shape = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const fx = x + (sx + 0.5) / SS;
          const fy = y + (sy + 0.5) / SS;
          if (inside(polygon, fx, fy)) plane += 1;
          if (roundedInside(fx, fy, size, radius)) shape += 1;
        }
      }
      const n = SS * SS;
      const shapeA = shape / n;
      const planeA = plane / n;
      // Soft radial glow behind the plane keeps the background from looking flat.
      const d = Math.hypot(x - centre, y - centre) / (size * 0.7);
      const glow = Math.max(0, 1 - d) ** 2;
      const base = BACKGROUND.map((c, i) => c + (GLOW[i] - c) * glow);
      const colour = base.map((c, i) => c + (ACCENT[i] - c) * planeA);
      const o = (y * size + x) * 4;
      rgba[o] = Math.round(colour[0]);
      rgba[o + 1] = Math.round(colour[1]);
      rgba[o + 2] = Math.round(colour[2]);
      rgba[o + 3] = Math.round(shapeA * 255);
    }
  }
  return encodePng(size, size, rgba);
}

function roundedInside(x, y, size, r) {
  if (r === 0) return true;
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const icons = [
  ['icon-192.png', 192, 0.62, 0.22],
  ['icon-512.png', 512, 0.62, 0.22],
  // Maskable: full bleed, plane inside the central 80% "safe zone".
  ['maskable-512.png', 512, 0.5, 0],
  ['apple-touch-icon.png', 180, 0.62, 0],
];
for (const [name, size, planeScale, rounded] of icons) {
  writeFileSync(join(out, name), render(size, planeScale, rounded));
  console.log('wrote', name);
}
