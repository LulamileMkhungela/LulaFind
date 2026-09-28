/**
 * Builds the PWA icons the manifest and index.html reference, from the single
 * brand mark in `src/assets/logo-mark.svg`.
 *
 *   npm run icons:pwa
 *
 * `scripts/generate-icons.mjs` does the native launcher/AppIcon sizes. This one
 * only writes the web icons, so the browser tab, the install prompt and Android
 * all show the same mark. Splash screens are deliberately NOT generated: the
 * Capacitor defaults are correct and a stretched replacement looked wrong.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'src', 'assets');
const mark = readFileSync(join(assets, 'logo-mark.svg'), 'utf8');
// The brand mark is already a complete 512x512 tile, so reuse its contents
// rather than nesting one <svg> inside another (that would ignore the scale).
const inner = mark.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

/** [file, px, scale of the mark inside the canvas, background] */
const TARGETS = [
  ['icon-192.png', 192, 1, null],
  ['icon-512.png', 512, 1, null],
  // Android crops a maskable icon to a circle and to the device's own shape, so
  // the mark is inset and sits on a flat brand colour that survives the crop.
  ['icon-maskable-512.png', 512, 0.68, '#1877F2'],
];

mkdirSync(assets, { recursive: true });

for (const [file, px, scale, bg] of TARGETS) {
  const side = px * scale;
  const pad = (px - side) / 2;
  const body = bg
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">` +
      `<rect width="${px}" height="${px}" fill="${bg}"/>` +
      `<g transform="translate(${pad} ${pad}) scale(${side / 512})">${inner}</g></svg>`
    : mark;
  const png = new Resvg(body, { fitTo: { mode: 'width', value: px } })
    .render()
    .asPng();
  writeFileSync(join(assets, file), png);
  console.log(`wrote src/assets/${file}  ${px}x${px}  mark ${Math.round(scale * 100)}%${bg ? ` on ${bg}` : ''}`);
}
