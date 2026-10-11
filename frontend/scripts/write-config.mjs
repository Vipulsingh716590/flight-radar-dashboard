// Writes public/config.json from the API_BASE_URL environment variable, so a
// hosted build (Netlify) can be pointed at its API without editing files.
// Without the variable the existing file is left alone (same-origin default).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const target = fileURLToPath(new URL('../public/config.json', import.meta.url));
const raw = process.env.API_BASE_URL?.trim();

if (raw === undefined || raw === '') {
  console.log('write-config: API_BASE_URL not set, keeping public/config.json');
  process.exit(0);
}

let origin;
try {
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('not http(s)');
  origin = url.origin;
} catch {
  console.error(`write-config: API_BASE_URL is not a valid http(s) URL: ${raw}`);
  process.exit(1);
}

const next = JSON.stringify({ apiBaseUrl: origin }, null, 2) + '\n';
const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
if (current !== next) writeFileSync(target, next);
console.log(`write-config: apiBaseUrl=${origin}`);
