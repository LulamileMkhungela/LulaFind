/**
 * Inline SVG icon set (Feather-derived paths).
 * No icon-font, no network request - renders identically in the browser,
 * in the Android webview and in the iOS WKWebView.
 */
/**
 * One stroke weight, drawn for the size it is shown at.
 *
 * A flat 1.5px on a 24px glyph is 6% of its width; the same 1.5px on an 11px
 * glyph is 14% - twice as heavy. That is why a screen with mixed sizes read as
 * two different icon sets. The stroke is therefore a *share* of the glyph, the
 * way X and Material draw their sets:
 *
 *   stroke = clamp(size * 0.085, 1.1, 2.4) x the weight's factor
 *
 * The floor and ceiling exist because a 9px tick at a true 0.77px would break up
 * on a 1x phone, and a 96px illustration does not want a 8px line. Measured
 * across every screen, the relative weight now stays inside 1.6x instead of 2.2x.
 */
export type IconWeight = 'thin' | 'regular' | 'bold';

const RATIO = 0.085;
const MIN_STROKE = 1.1;
const MAX_STROKE = 2.4;
const FACTOR: Record<IconWeight, number> = { thin: 0.85, regular: 1, bold: 1.15 };

/** The stroke for one glyph: a number for exact control, a class for the set. */
export function strokeFor(size: number, weight: number | string | IconWeight): number {
  if (typeof weight === 'number') return weight;
  const factor = FACTOR[(weight as IconWeight)] ?? FACTOR.regular;
  const raw = Math.max(MIN_STROKE, Math.min(MAX_STROKE, (size || 20) * RATIO)) * factor;
  return Math.round(Math.max(MIN_STROKE, Math.min(MAX_STROKE, raw)) * 10) / 10;
}

const PATHS: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  plus: 'M12 5v14M5 12h14',
  chat: 'M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-4-.9L3 21l1.9-4.4A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  /** Solid bell (Material-style) - used when the person has unread alerts and the glyph is filled. */
  /** A bell with a slash: this community's alerts are silenced, membership is not. */
  bellOff: 'M18 8a6 6 0 0 0-9.3-5M6 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h13M13.7 21a2 2 0 0 1-3.4 0M2.5 2.5l19 19',
  bellFilled: 'M12 22a2.2 2.2 0 0 0 2.15-1.75H9.85A2.2 2.2 0 0 0 12 22zm7-5.4v.4H5v-.4l1.9-1.9v-4.35c0-3.2 1.7-5.9 4.6-6.6v-.8a1.5 1.5 0 0 1 3 0v.8c2.9.7 4.6 3.4 4.6 6.6v4.35l1.9 1.9z',
  heart: 'M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 1 0-7.1 7.1L12 21l8.8-8.3a5 5 0 0 0 0-7.1z',
  share: 'M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v14',
  comment: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  thumbup: 'M7 22V11l5-9a2.5 2.5 0 0 1 2.4 3.2L13.5 9H20a2 2 0 0 1 2 2.3l-1.2 7A2.5 2.5 0 0 1 18.3 20H7zM3 11h4v11H3z',
  /** Idea: a light bulb with rays - the "I have an idea" action. */
  car: 'M5 17h14M6.5 17v2M17.5 17v2M3 13l1.6-4.8A2 2 0 0 1 6.5 7h11a2 2 0 0 1 1.9 1.2L21 13v4H3zM6.5 15h.01M17.5 15h.01M3 13h18',
  paw: 'M7 14.5c0-2 1.6-3.5 3-3.5s3 1.5 3 3.5S11.4 18 10 18s-3-1.5-3-3.5zM14 14.5c0-2 1.3-3.5 2.6-3.5S19 12.5 19 14.5 17.9 18 16.6 18 14 16.5 14 14.5zM5.5 9.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zM11 8a1.8 1.8 0 1 0 0-3.6A1.8 1.8 0 0 0 11 8zM16 9.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z',
  bulb: 'M9 18h6M10 21h4M12 2a6.5 6.5 0 0 0-3.9 11.7c.6.5.9 1.2.9 1.9V17h6v-1.4c0-.7.3-1.4.9-1.9A6.5 6.5 0 0 0 12 2zM2 9h2M20 9h2M4.9 4.9l1.5 1.5M17.6 6.4l1.5-1.5',
  pin: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  /** Hand raised: "I'm here" - the person saying they are safe themselves. */
  hand: 'M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.3l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  /** Compass: Discover - the people and statuses around you. */
  compass: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM16.2 7.8l-2.1 6.3-6.3 2.1 2.1-6.3zM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
  camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  image: 'M3 5h18v14H3zM8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 19',
  video: 'M23 7l-7 5 7 5zM1 5h15v14H1z',
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  chevronRight: 'M9 18l6-6-6-6',
  chevronLeft: 'M15 18l-6-6 6-6',
  chevronDown: 'M6 9l6 6 6-6',
  arrowLeft: 'M19 12H5M12 19l-7-7 7-7',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  alert: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  /** No connection: the wifi arc with a slash through it. */
  wifiOff: 'M1 1l22 22M16.7 12.5A6 6 0 0 0 8 8.5M5 12.5a10.9 10.9 0 0 1 4-2.3M2 8.8a15.9 15.9 0 0 1 4.2-2.6M8.5 16.4a6 6 0 0 1 5.3-1.1M12 20h.01',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  unlock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.5-2',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M17.9 17.9A10.4 10.4 0 0 1 12 20C5 20 1 12 1 12a19 19 0 0 1 5.1-5.9M9.9 4.2A10.7 10.7 0 0 1 12 4c7 0 11 8 11 8a19 19 0 0 1-2.2 3.2M1 1l22 22M9.9 9.9a3 3 0 0 0 4.2 4.2',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  filter: 'M22 3H2l8 9.5V19l4 2v-8.5z',
  bookmark: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.4-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 .3 1.9v.1a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z',
  phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z',
  copy: 'M9 9h10v10H9zM5 15H4V4h11v1',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  edit: 'M11 4H4v16h16v-7M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z',
  flag: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  calendar: 'M3 5h18v16H3zM16 3v4M8 3v4M3 10h18',
  award: 'M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM8.2 13.9 7 23l5-3 5 3-1.2-9.1',
  play: 'M8 5v14l11-7z',
  pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
  mic: 'M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM18 11v1a6 6 0 0 1-12 0v-1M12 18v3M8 21h8',
  stop: 'M6 6h12v12H6z',
  sparkle: 'M12 2l2.2 6.2L20 10l-5.8 1.8L12 18l-2.2-6.2L4 10l5.8-1.8zM19 16l.9 2.6L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.4z',
  map: 'M1 6l7-3 8 3 7-3v15l-7 3-8-3-7 3zM8 3v15M16 6v15',
  target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15',
  megaphone: 'M3 11v2l14 5V6L3 11zM3 11h14M17 8a4 4 0 0 1 0 8M7 12v6a2 2 0 0 0 4 0v-4',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  more: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  menu: 'M3 6h18M3 12h18M3 18h18',
  /** A face, drawn as a stroke like the rest of the set - not a solid blob. */
  smile: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01',
  /** Messenger-style bubble with the zig-zag. */
  messenger: 'M12 2.5C6.5 2.5 2.5 6.4 2.5 11.3c0 2.6 1.1 4.8 3 6.4V21l3.1-1.7c1.1.3 2.2.5 3.4.5 5.5 0 9.5-3.9 9.5-8.8S17.5 2.5 12 2.5zM6.8 13.6l3-4.6 2.6 2.2 3.8-2.2-3 4.6-2.6-2.2z',
  back: 'M19 12H5M12 19l-7-7 7-7',
  repost: 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
  sad: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8.5 16a4.5 4.5 0 0 1 7 0M9 9.5h.01M15 9.5h.01',
  palette: 'M12 22a10 10 0 1 1 10-10c0 3-2 4-4 4h-2a2 2 0 0 0-1.4 3.4A2 2 0 0 1 12 22zM7.5 12.5h.01M9.5 7.5h.01M14.5 7.5h.01M17.5 11.5h.01',
  layout: 'M3 3h18v18H3zM3 9h18M9 21V9',
  wand: 'M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5',
  /* Trophy: a level, earned - not a competition against a family. */
  trophy: 'M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0zM7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3',
  /* Flame: a streak that matters (days helping), never a streak of grief. */
  flame: 'M12 22c4 0 6-2.4 6-6 0-4-3-5-3-9 0 0-3 2-3 5-1-1-2-2-2-4-2 1.6-4 4-4 8 0 3.6 2 6 6 6z',
  /* Handshake: a partner handoff (SAPS, NGO) - two-way, not one-way. */
  handshake: 'M8 12 4 8l4-4 4 4M16 12l4-4-4-4-4 4M3 14l5 5 4-4 4 4 5-5',
  /* Steps: the guided plan - one step at a time. */
  steps: 'M4 20h5v-4h5v-4h5V8h2M4 20v-4',
  chevronUp: 'M18 15l-6-6-6 6',
  /* Map pin with a route: tracking a search, not a person. */
  route: 'M6 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM9 16h4a4 4 0 0 0 4-4V9'
};

export const registerCoreIcons = (): void => {
  /* Icons are static - this hook exists so a future sprite loader can extend the set. */
};

export const iconPath = (name: string): string | undefined => PATHS[name];
export const iconNames = (): string[] => Object.keys(PATHS);
