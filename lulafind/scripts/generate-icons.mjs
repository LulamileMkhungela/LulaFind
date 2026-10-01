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

function render(svg, size, out) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, png);
  console.log(`${size.toString().padStart(4)}px  ${out.replace(root + '/', '')}`);
}

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
  // foreground = artwork only (Android masks it); maskable = full-bleed tile.
  render(file.includes('foreground') ? adaptive : mark, size, out);
}

console.log('\nLauncher icons rebuilt from src/assets/logo-mark.svg');
