/**
 * Renders the LulaFind logo mark into every native launcher icon the repo ships.
 *
 * Run it after editing `src/assets/logo-mark.svg`:
 *     node scripts/generate-icons.mjs
 *
 * It only rewrites generated PNGs. Keep the hand-written vector drawables and
 * the Contents.json files untouched.
 */
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const markPath = join(root, 'src/assets/logo-mark.svg');
const mark = readFileSync(markPath, 'utf8');

/** The mark with the tile removed, for the Android adaptive-icon foreground. */
const adaptive = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <g transform="translate(256 256) scale(.62) translate(-206 -200)">
    <circle cx="206" cy="200" r="112" fill="none" stroke="#ffffff" stroke-width="30"/>
    <path d="M288 282 398 392" fill="none" stroke="#ffffff" stroke-width="34" stroke-linecap="round"/>
    <path transform="translate(206 186) scale(8) translate(-12 -9)" fill="#ffffff"
      d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7z"/>
  </g>
</svg>`;

/**
 * The mark clipped to a circle, for Android's round launcher icon. The squircle
 * tile is swapped for a full-bleed circle so no square corner shows through the
 * round mask.
 */
const round = mark
  .replace(
    '<rect width="512" height="512" rx="116" ry="116" fill="url(#lfTile)"/>',
    '<circle cx="256" cy="256" r="256" fill="url(#lfTile)"/>'
  )
  .replace(
    '<rect width="512" height="512" rx="116" ry="116" fill="url(#lfTile)" />',
    '<circle cx="256" cy="256" r="256" fill="url(#lfTile)" />'
  );

/**
 * A real maskable icon. The PWA maskable mask can be a circle, a squircle or a
 * rounded square, and anything outside the middle ~80% may be cropped - so the
 * background has to bleed to every edge and the artwork has to stay inside that
 * safe zone. Shrinking the mark's own tile into the safe zone would leave the
 * tile's rounded corners showing, which is exactly what this avoids.
 */
function maskable(size) {
  // The mark's own tile and its highlight are dropped here: this icon carries
  // the full-bleed background instead, so keeping them would print a second,
  // lighter squircle inside the artwork.
  const inner = mark
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<rect width="512" height="512" rx="116" ry="116" fill="url\(#lfTile\)"\s*\/>/, '')
    .replace(/<path d="M116 0h280c[^"]*" fill="#ffffff" opacity="\.08"\s*\/>/, '');
  const art = Math.round(size * 0.62);
  const at = Math.round((size - art) / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="lfMaskBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#64b5f6"/>
      <stop offset=".55" stop-color="#2196f3"/>
      <stop offset="1" stop-color="#1976d2"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#lfMaskBg)"/>
  <svg x="${at}" y="${at}" width="${art}" height="${art}" viewBox="0 0 512 512">${inner}</svg>
</svg>`;
}

/** The mark centred on the splash background, at an exact pixel size. */
function splash(w, h) {
  const side = Math.round(Math.min(w, h) * 0.22);
  const x = Math.round((w - side) / 2);
  const y = Math.round((h - side) / 2);
  const inner = mark
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#0F0F10"/>
  <svg x="${x}" y="${y}" width="${side}" height="${side}" viewBox="0 0 512 512">${inner}</svg>
</svg>`;
}

function render(svg, size, out) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, png);
  console.log(`${size.toString().padStart(4)}px  ${out.replace(root + '/', '')}`);
}

/** [file, width, height] splashes. Capacitor swaps these per orientation. */
const splashes = [
  ['android/app/src/main/res/drawable/splash.png', 480, 320],
  ['android/app/src/main/res/drawable-land-mdpi/splash.png', 480, 320],
  ['android/app/src/main/res/drawable-land-hdpi/splash.png', 800, 480],
  ['android/app/src/main/res/drawable-land-xhdpi/splash.png', 1280, 720],
  ['android/app/src/main/res/drawable-land-xxhdpi/splash.png', 1600, 960],
  ['android/app/src/main/res/drawable-land-xxxhdpi/splash.png', 1920, 1280],
  ['android/app/src/main/res/drawable-port-mdpi/splash.png', 320, 480],
  ['android/app/src/main/res/drawable-port-hdpi/splash.png', 480, 800],
  ['android/app/src/main/res/drawable-port-xhdpi/splash.png', 720, 1280],
  ['android/app/src/main/res/drawable-port-xxhdpi/splash.png', 960, 1600],
  ['android/app/src/main/res/drawable-port-xxxhdpi/splash.png', 1280, 1920],
];

const targets = [
  // Android launcher icons (mipmap density buckets).
  ['android/app/src/main/res/mipmap-mdpi/ic_launcher.png', 48],
  ['android/app/src/main/res/mipmap-hdpi/ic_launcher.png', 72],
  ['android/app/src/main/res/mipmap-xhdpi/ic_launcher.png', 96],
  ['android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png', 144],
  ['android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png', 192],
  // Android adaptive-icon foreground: 108dp canvas, artwork inside the 66dp safe zone.
  ['android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.png', 108],
  ['android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.png', 162],
  ['android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.png', 216],
  ['android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.png', 324],
  ['android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png', 432],
  // Android round launcher icon (devices whose launcher masks to a circle).
  ['android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png', 48],
  ['android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png', 72],
  ['android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png', 96],
  ['android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png', 144],
  ['android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png', 192],
  // iOS App Store / home-screen icon.
  ['ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', 1024],
  // PWA / browser icons. These are the ones link previews and "Add to home
  // screen" use, so they have to be regenerated with everything else - they sat
  // on the old artwork for a while precisely because they were not in this list.
  ['src/assets/icon-192.png', 192],
  ['src/assets/icon-512.png', 512],
  ['src/assets/icon-maskable-512.png', 512],
];

if (!existsSync(markPath)) {
  console.error(`Missing ${markPath}`);
  process.exit(1);
}

for (const [file, size] of targets) {
  const out = join(root, file);
  if (!existsSync(dirname(out))) continue; // density bucket not present in this checkout
  // Each target needs a different treatment of the same mark:
  //   foreground -> artwork only, Android's adaptive mask crops the rest
  //   _round     -> the tile clipped to a circle
  //   maskable   -> full-bleed background with the mark inside the safe zone
  const art = file.includes('foreground') ? adaptive
    : file.includes('_round') ? round
    : file.includes('maskable') ? maskable(size)
    : mark;
  render(art, size, out);
}

for (const [file, w, h] of splashes) {
  const out = join(root, file);
  if (!existsSync(dirname(out))) continue;
  render(splash(w, h), w, out);
}

console.log('\nLauncher icons rebuilt from src/assets/logo-mark.svg');
