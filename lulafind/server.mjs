// Tiny static server for the built app (used for the live preview and for
// `npx cap sync` sanity checks). Binds 0.0.0.0 so it is reachable from outside.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Angular's application builder writes the browser bundle to `www/browser`,
 * while Capacitor's webDir used to point at plain `www`. Rather than assume
 * either layout, take whichever one actually holds an index.html.
 */
async function findRoot() {
  for (const candidate of ['./www/browser', './www']) {
    const dir = fileURLToPath(new URL(candidate + '/', import.meta.url));
    try {
      if ((await stat(join(dir, 'index.html'))).isFile()) return dir;
    } catch {
      /* try the next layout */
    }
  }
  throw new Error('No build found. Run: npm run build:snapshot');
}

const ROOT = await findRoot();
const PORT = Number(process.env.PORT ?? 4200);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8'
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith('/')) path += 'index.html';

  let file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = join(file, 'index.html');
  } catch {
    // SPA fallback: unknown deep links (e.g. /post/p_thato) render the shell
    file = join(ROOT, 'index.html');
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`LulaFind preview listening on http://0.0.0.0:${PORT}`);
  console.log(`serving ${ROOT}`);
});
