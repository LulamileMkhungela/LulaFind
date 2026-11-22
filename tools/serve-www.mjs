/**
 * Serve the production build the way a host does: gzip for text, an SPA
 * fallback so deep links work, and correct long-cache headers for hashed
 * files. Used to measure what a real phone actually downloads.
 *
 *   npx ng build && node tools/serve-www.mjs [port] [dir]
 *
 * `dir` defaults to lulafind/www/browser - where `ng build` now writes the
 * entry point (angular.json's outputPath browser is 'browser', which is also
 * what capacitor.config.ts's webDir points at). Serving lulafind/www itself
 * finds no index.html and answers nothing but 404s.
 */
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.argv[3]
  ? fileURLToPath(new URL(`file://${process.argv[3]}/`))
  : fileURLToPath(new URL('../lulafind/www/browser/', import.meta.url));
const PORT = Number(process.argv[2] ?? 4300);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt']);

const cache = new Map();

/* Compress every text asset once, at start-up, the way a real host does at build
   time. Without this the first request for each file pays the brotli cost, which
   shows up as a fake slow first load in the measurements. */
function warm() {
  const started = Date.now();
  let files = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!COMPRESSIBLE.has(extname(p))) continue;
      const body = readFileSync(p);
      const stat = statSync(p);
      cache.set(`${p}|${stat.mtimeMs}|${stat.size}|gz`, gzipSync(body));
      cache.set(`${p}|${stat.mtimeMs}|${stat.size}|br`, brotliCompressSync(body));
      files++;
    }
  };
  walk(ROOT);
  console.log(`pre-compressed ${files} files in ${Date.now() - started} ms`);
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let path = join(ROOT, normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ''));
  if (!existsSync(path) || statSync(path).isDirectory()) path = join(ROOT, 'index.html');
  try {
    const stat = statSync(path);
    let body = readFileSync(path);
    const ext = extname(path);
    const headers = {
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      /* Hashed filenames can be cached forever; index.html never. */
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable'
    };
    const accept = String(req.headers['accept-encoding'] ?? '');
    if (COMPRESSIBLE.has(ext)) {
      const br = accept.includes('br');
      /* Compress once and keep it: a real host does this at build time, so the
         measurement should be about the app, not about my server's CPU. */
      /* Keyed by the file's own timestamp and size: a rebuild replaces the
         bundle and this must never serve yesterday's copy. */
      const key = `${path}|${stat.mtimeMs}|${stat.size}|${br ? 'br' : 'gz'}`;
      let cached = cache.get(key);
      if (!cached) {
        cached = br ? brotliCompressSync(body) : gzipSync(body);
        cache.set(key, cached);
      }
      body = cached;
      headers['Content-Encoding'] = br ? 'br' : 'gzip';
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, '0.0.0.0', () => {
  warm();
  console.log(`serving ${ROOT} on http://0.0.0.0:${PORT} (gzip/br, SPA fallback)`);
});
