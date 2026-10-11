// Smoke-test server for the production build, for machines without Docker.
// It does what the nginx image does: serves dist/ with the SAME security
// headers (read from nginx/security-headers.conf), falls back to index.html for
// deep links, and either proxies /api (same-origin mode) or tells the app to
// call the API directly (cross-origin mode).
//
//   node scripts/serve-prod-like.mjs --port 4300 --proxy http://localhost:3100
//   node scripts/serve-prod-like.mjs --port 4300 --api-base http://localhost:3100
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, index, all) => {
    if (arg.startsWith('--')) pairs.push([arg.slice(2), all[index + 1]?.startsWith('--') ? 'true' : (all[index + 1] ?? 'true')]);
    return pairs;
  }, []),
);
const port = Number(args.port ?? 4300);
const proxyTarget = args.proxy && args.proxy !== 'true' ? new URL(args.proxy) : null;
const apiBase = args['api-base'] && args['api-base'] !== 'true' ? args['api-base'] : '';
const root = fileURLToPath(new URL('../dist/frontend/browser', import.meta.url));
const headersFile = fileURLToPath(new URL('../nginx/security-headers.conf', import.meta.url));

// "add_header Name "value" always;" lines -> { Name: value }
const securityHeaders = {};
for (const line of readFileSync(headersFile, 'utf8').split('\n')) {
  const match = /^add_header\s+(\S+)\s+"(.*)"\s+always;/.exec(line.trim());
  if (match) securityHeaders[match[1]] = match[2];
}

// Cross-origin mode needs the API origin in connect-src, exactly like the
// Content-Security-Policy in netlify.toml.
if (apiBase && securityHeaders['Content-Security-Policy']) {
  securityHeaders['Content-Security-Policy'] = securityHeaders['Content-Security-Policy'].replace(
    "connect-src 'self'",
    `connect-src 'self' ${apiBase}`,
  );
}

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (proxyTarget && url.pathname.startsWith('/api/')) {
    const upstream = http.request(
      { host: proxyTarget.hostname, port: proxyTarget.port, path: req.url, method: req.method,
        headers: { ...req.headers, host: req.headers.host, 'x-forwarded-proto': 'http' } },
      (up) => { res.writeHead(up.statusCode ?? 502, up.headers); up.pipe(res); },
    );
    upstream.on('error', () => { res.writeHead(502); res.end('bad gateway'); });
    req.pipe(upstream);
    res.on('close', () => upstream.destroy());
    return;
  }

  res.setHeader('Cache-Control', 'no-cache');
  for (const [name, value] of Object.entries(securityHeaders)) res.setHeader(name, value);

  if (url.pathname === '/config.json') {
    res.setHeader('Content-Type', types['.json']);
    res.end(JSON.stringify({ apiBaseUrl: apiBase }));
    return;
  }

  let file = normalize(join(root, decodeURIComponent(url.pathname)));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
  createReadStream(file).pipe(res);
});

server.listen(port, () => {
  console.log(`prod-like server on http://localhost:${port}`);
  console.log(proxyTarget ? `  /api -> ${proxyTarget.origin} (same-origin)` : `  apiBaseUrl = "${apiBase}" (cross-origin)`);
  console.log(`  headers: ${Object.keys(securityHeaders).join(', ')}`);
});
