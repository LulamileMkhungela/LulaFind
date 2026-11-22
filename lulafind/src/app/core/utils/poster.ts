import { Post, PostType, provinceName } from '../models/types';
import { dayMonth } from './format';

/** The stamp across the top of the poster, picked from the category. */
export const isPosterType = (type: PostType): boolean =>
  type === 'missing' || type === 'announcement' || type === 'khumbulekhaya';

export const posterKicker = (type: PostType): string =>
  type === 'announcement' ? 'ANNOUNCEMENT'
  : type === 'sighting' ? 'SIGHTING'
  : type === 'khumbulekhaya' ? 'LEFT HOME'
  : type === 'missing' ? 'MISSING'
  : '';

/**
 * "Last seen" place line for the poster. Where and town often overlap
 * ("Orlando taxi rank, Soweto" + town "Orlando West, Soweto"); repeating the
 * same words twice makes the design look sloppy, so a segment that adds nothing
 * new is dropped, and the province is only added when neither place says it.
 */
export function whereLine(post: Pick<Post, 'lastSeenWhere' | 'town' | 'province'>): string {
  const parts = [post.lastSeenWhere?.trim() || '', post.town?.trim() || ''].filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    for (const raw of part.split(',')) {
      const piece = raw.trim();
      if (!piece) continue;
      const key = piece.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(piece);
    }
  }
  const province = provinceName(post.province);
  if (province && !seen.has(province.toLowerCase())) out.push(province);
  return out.join(', ');
}

/** The safety line across the bottom of the poster. */
export const posterClose = (_type: PostType): string =>
  'Details and updates are available on LulaFind.';

/**
 * A public flyer. PawBoost's own poster advice is to keep it short and leave
 * one identifying mark off, so a caller has to know it. The reward amount
 * stays off too — a public amount is how fake tipsters pick a family.
 */
export function publicPoster(post: Post): { lines: string[]; withheld: string | null; shareText: string } {
  if (!isPosterType(post.type)) return { lines: [], withheld: null, shareText: '' };
  const lines: string[] = [];
  if (post.subject?.name) {
    lines.push(post.subject.age != null ? `${post.subject.name}, ${post.subject.age}` : post.subject.name);
  }
  const where = whereLine(post);
  if (where) lines.push(`Last seen: ${where}${post.lastSeenAt ? ` · ${dayMonth(post.lastSeenAt)}` : ''}`);
  if (post.subject?.clothing) lines.push(`Wearing: ${post.subject.clothing}`);
  if (post.type === 'announcement') {
    const brief = post.body.replace(/\s+/g, ' ').trim().slice(0, 180);
    if (brief) lines.push(brief);
  }
  if (post.caseNumber) lines.push(`Station case: ${post.caseNumber}`);
  if (post.contactVisibleTo === 'everyone' && post.contactValue) {
    lines.push(`${post.contactLabel || 'Contact'}: ${post.contactValue}`);
  }
  if (!lines.length) {
    const brief = post.body.replace(/\s+/g, ' ').trim().slice(0, 220);
    if (brief) lines.push(brief);
  }
  const withheld = post.subject?.distinguishing?.trim() || null;
  const close = posterClose(post.type);
  return {
    lines,
    withheld,
    shareText: [post.title, ...lines, close].join('\n')
  };
}

/* ------------------------------------------------------------------ */
/*  Poster templates, drawn on a canvas so the result is a real image  */
/* ------------------------------------------------------------------ */

export const POSTER_W = 1080;
export const POSTER_H = 1350;

export type PosterTemplateId = 'signal' | 'aurora' | 'editorial' | 'beacon' | 'ubuntu' | 'noir' | 'halo' | 'pulse' | 'notice';

export interface PosterTemplate { id: PosterTemplateId; name: string; tagline: string; swatch: [string, string, string]; }

export const POSTER_TEMPLATES: PosterTemplate[] = [
  { id: 'signal', name: 'Signal', tagline: 'Bold and urgent', swatch: ['#0b0b0f', '#ff3d3d', '#ff8a3d'] },
  { id: 'aurora', name: 'Aurora', tagline: 'Soft glass on a glowing gradient', swatch: ['#3b1d8f', '#1fb6c9', '#7b5cff'] },
  { id: 'editorial', name: 'Editorial', tagline: 'Clean, magazine style', swatch: ['#f6f2ea', '#141414', '#d6402a'] },
  { id: 'beacon', name: 'Beacon', tagline: 'High-visibility yellow', swatch: ['#ffd400', '#111111', '#ffffff'] },
  { id: 'ubuntu', name: 'Ubuntu', tagline: 'Proudly South African', swatch: ['#0c2f2a', '#f4b400', '#e0392d'] },
  { id: 'noir', name: 'Noir', tagline: 'Full-bleed photo, cinematic', swatch: ['#000000', '#ffffff', '#c7c7c7'] },
  { id: 'halo', name: 'Halo', tagline: 'AI-gradient glass card', swatch: ['#0a0a1f', '#7c5cff', '#22d3ee'] },
  { id: 'pulse', name: 'Pulse', tagline: 'Neon grid, glowing type', swatch: ['#05060a', '#00e5ff', '#ff2d9b'] },
  /*
   * The one the community organisations actually use: a dark header bar, the
   * photograph beside a panel of labelled facts, a red "any information" band
   * and the police numbers. Families arrive at LulaFind already having seen
   * posters like this on Facebook; giving them that shape means their poster
   * does not look like it came from an app nobody has heard of.
   */
  { id: 'notice', name: 'Notice', tagline: 'Police-appeal style, your photo and facts', swatch: ['#0e1116', '#e0392d', '#f4b400'] }
];

export interface PosterContent {
  kicker: string;          // MISSING / LOST PET / HAVE YOU SEEN
  name: string;
  ageLine: string;
  facts: { label: string; value: string }[];
  contact: string;
  link: string;
  foot: string;
  photo: string | null;
}

export function posterContent(post: Post, link: string, withPhoto: string | null): PosterContent {
  if (!isPosterType(post.type)) {
    return { kicker: '', name: '', ageLine: '', facts: [], contact: '', link: '', foot: '', photo: null };
  }
  const s = post.subject;
  const kicker = post.type === 'announcement' ? 'ANNOUNCEMENT' : post.type === 'khumbulekhaya' ? 'HAVE YOU SEEN' : 'MISSING';
  const name = (s?.name || (post.type === 'announcement' ? 'Announcement' : 'Someone we love')).trim();
  const bits: string[] = [];
  if (s?.age != null) bits.push(`${s.age} years old`);
  if (s?.gender && s.gender !== 'unknown' && post.type !== 'announcement') bits.push(s.gender === 'female' ? 'Female' : s.gender === 'male' ? 'Male' : 'Other');
  const facts: { label: string; value: string }[] = [];
  const where = whereLine(post);
  if (where) facts.push({ label: 'LAST SEEN', value: where });
  if (post.lastSeenAt) facts.push({ label: 'WHEN', value: dayMonth(post.lastSeenAt) });
  if (s?.clothing) facts.push({ label: post.type === 'announcement' ? 'DETAILS' : 'WEARING', value: s.clothing });
  else if (post.type === 'announcement' && s?.distinguishing) facts.push({ label: 'DETAILS', value: s.distinguishing });
  if (post.caseNumber) facts.push({ label: 'SAPS CASE', value: post.caseNumber });
  const contact = post.contactVisibleTo === 'everyone' && post.contactValue
    ? `${post.contactLabel || 'Contact'}: ${post.contactValue}` : 'Message the family on LulaFind';
  return {
    kicker, name, ageLine: bits.join(' · '), facts, contact, link,
    foot: 'Details and updates are available on LulaFind.',
    photo: withPhoto
  };
}

export function loadPosterImage(src: string | null): Promise<HTMLImageElement | null> {
  if (!src || typeof Image === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

type Ctx = CanvasRenderingContext2D;

const SANS = '"Inter","Helvetica Neue",Arial,sans-serif';
const SERIF = '"Playfair Display",Georgia,"Times New Roman",serif';

function rr(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + k, y);
  c.arcTo(x + w, y, x + w, y + h, k);
  c.arcTo(x + w, y + h, x, y + h, k);
  c.arcTo(x, y + h, x, y, k);
  c.arcTo(x, y, x + w, y, k);
  c.closePath();
}

function cover(c: Ctx, img: HTMLImageElement, x: number, y: number, w: number, h: number): void {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  c.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function wrap(c: Ctx, text: string, maxW: number): string[] {
  // Words are measured at the active font. A token wider than the box is one
  // that used to print straight off the canvas (a long surname), so it is
  // broken at hyphens first - 'Mokoena-' / 'Ndlovu' - and only hard-broken
  // mid-word when even a single piece cannot fit.
  const words: string[] = [];
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    if (c.measureText(raw).width <= maxW) { words.push(raw); continue; }
    for (const part of raw.split(/(?<=-)/)) {
      if (!part) continue;
      if (c.measureText(part).width <= maxW) { words.push(part); continue; }
      let rest = part;
      while (c.measureText(rest).width > maxW) {
        let fit = 1, lo = 1, hi = rest.length;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (c.measureText(rest.slice(0, mid)).width <= maxW) { fit = mid; lo = mid + 1; } else hi = mid - 1;
        }
        words.push(rest.slice(0, fit));
        rest = rest.slice(fit);
      }
      if (rest) words.push(rest);
    }
  }
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (c.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

/** Draws wrapped text, returns the y after the last line. Shrinks to fit `maxLines`. */
function para(c: Ctx, text: string, x: number, y: number, maxW: number, size: number, lh: number, maxLines: number, weight = 500, family = SANS): number {
  let s = size;
  let lines: string[] = [];
  for (; s >= 20; s -= 2) {
    c.font = `${weight} ${s}px ${family}`;
    lines = wrap(c, text, maxW);
    if (lines.length <= maxLines) break;
  }
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '…');
  }
  for (const l of lines) { c.fillText(l, x, y); y += s * lh; }
  return y;
}

function fitOneLine(c: Ctx, text: string, maxW: number, size: number, weight: number, family = SANS, min = 40): number {
  let s = size;
  for (; s > min; s -= 4) { c.font = `${weight} ${s}px ${family}`; if (c.measureText(text).width <= maxW) break; }
  c.font = `${weight} ${s}px ${family}`;
  return s;
}

/**
 * The labelled facts (WHEN, WHERE, the case number...).
 *
 * `limitY` is the bottom edge this block may not cross - the contact bar sits
 * just below it on several designs, and a fact drawn under that bar is text a
 * reader cannot read (the date on the Thato poster was half-hidden behind it).
 * Every row is fitted on its own: a value gets a second line only if that line
 * still ends above `limitY`, otherwise it is drawn on one line (shrinking to
 * fit, with an ellipsis at 20px), and a row that does not fit at all is left
 * out. A poster that states two facts clearly beats one that states three with
 * the last one cut in half.
 */
function facts(c: Ctx, items: { label: string; value: string }[], x: number, y: number, w: number,
               label: string, value: string, gap = 30, maxItems = 4, limitY = POSTER_H - 96,
               singleLine = false): number {
  const LINE = 34 * 1.25;
  // The case number is never the fact that gets dropped: it is the one line on
  // the poster that tells a reader the police are already involved, and the app
  // asks families for it for exactly that reason.
  const rows = items.length <= maxItems
    ? items.slice(0, maxItems)
    : (() => {
        const keep = items.slice(0, maxItems - 1);
        const caseNo = items.slice(maxItems - 1).find((f) => /case/i.test(f.label));
        return caseNo ? [...keep, caseNo] : items.slice(0, maxItems);
      })();
  for (const f of rows) {
    const remaining = limitY - y;
    if (remaining < 40 + LINE) break; // not even a label plus one line of value fits
    c.fillStyle = label; c.font = `700 22px ${SANS}`;
    if ('letterSpacing' in c) (c as unknown as { letterSpacing: string }).letterSpacing = '3px';
    c.fillText(f.label, x, y);
    if ('letterSpacing' in c) (c as unknown as { letterSpacing: string }).letterSpacing = '0px';
    c.fillStyle = value;
    const maxLines = !singleLine && remaining >= 40 + LINE * 2 ? 2 : 1;
    y = para(c, f.value, x, y + 40, w, 34, 1.25, maxLines, 600) + gap - 8;
  }
  return y;
}

function spaced(c: Ctx, on: boolean): void {
  if ('letterSpacing' in c) (c as unknown as { letterSpacing: string }).letterSpacing = on ? '6px' : '0px';
}

function footer(c: Ctx, p: PosterContent, color: string, y = POSTER_H - 60): void {
  c.fillStyle = color;
  c.textAlign = 'left';
  c.font = `500 18px ${SANS}`;
  c.fillText(p.foot, 64, y, 952);
  c.font = `700 21px ${SANS}`;
  c.fillText(`Read more: ${p.link || 'LulaFind'}`, 64, Math.min(y + 30, POSTER_H - 12), 952);
}

function noPhoto(c: Ctx, x: number, y: number, w: number, h: number, r: number, a: string, b: string, ink: string): void {
  const g = c.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, a); g.addColorStop(1, b);
  c.fillStyle = g; rr(c, x, y, w, h, r); c.fill();
  c.fillStyle = ink; c.globalAlpha = 0.55;
  c.beginPath(); c.arc(x + w / 2, y + h * 0.4, w * 0.16, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.ellipse(x + w / 2, y + h * 0.82, w * 0.3, h * 0.24, 0, Math.PI, 0); c.fill();
  c.globalAlpha = 1;
}

function grain(c: Ctx, alpha = 0.05): void {
  c.save(); c.globalAlpha = alpha; c.fillStyle = '#fff';
  for (let i = 0; i < 900; i++) c.fillRect(Math.random() * POSTER_W, Math.random() * POSTER_H, 2, 2);
  c.restore();
}

/* ---- 1. Signal: near-black, hot gradient headline, framed photo ---- */
function signal(c: Ctx, p: PosterContent, img: HTMLImageElement | null): void {
  c.fillStyle = '#0b0b10'; c.fillRect(0, 0, POSTER_W, POSTER_H);
  const glow = c.createRadialGradient(900, 120, 20, 900, 120, 700);
  glow.addColorStop(0, 'rgba(255,61,61,.55)'); glow.addColorStop(1, 'rgba(255,61,61,0)');
  c.fillStyle = glow; c.fillRect(0, 0, POSTER_W, POSTER_H);
  const glow2 = c.createRadialGradient(100, 1300, 20, 100, 1300, 640);
  glow2.addColorStop(0, 'rgba(255,138,61,.35)'); glow2.addColorStop(1, 'rgba(255,138,61,0)');
  c.fillStyle = glow2; c.fillRect(0, 0, POSTER_W, POSTER_H);
  grain(c);

  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  const g = c.createLinearGradient(64, 0, 1000, 0); g.addColorStop(0, '#ff3d3d'); g.addColorStop(1, '#ff9d3d');
  c.fillStyle = g;
  fitOneLine(c, p.kicker, 950, 210, 900, SANS, 90);
  c.fillText(p.kicker, 60, 235);

  const px = 64, py = 270, pw = 952, ph = 400;
  if (img) {
    c.save(); rr(c, px, py, pw, ph, 36); c.clip(); cover(c, img, px, py, pw, ph);
    const fade = c.createLinearGradient(0, py + ph - 200, 0, py + ph); fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,.8)');
    c.fillStyle = fade; c.fillRect(px, py, pw, ph); c.restore();
  } else noPhoto(c, px, py, pw, ph, 36, '#2a2a36', '#15151d', '#ffffff');
  c.strokeStyle = 'rgba(255,255,255,.18)'; c.lineWidth = 2; rr(c, px, py, pw, ph, 36); c.stroke();

  c.fillStyle = '#fff';
  fitOneLine(c, p.name, 900, 92, 800, SANS, 48);
  c.fillText(p.name, px + 8, py + ph + 95);
  if (p.ageLine) { c.fillStyle = '#ff9d3d'; c.font = `600 34px ${SANS}`; c.fillText(p.ageLine, px + 8, py + ph + 142); }
  facts(c, p.facts, px + 8, py + ph + 205, 930, 'rgba(255,255,255,.5)', '#fff', 14, 3, POSTER_H - 172);

  c.fillStyle = '#ff3d3d'; rr(c, 64, POSTER_H - 150, 952, 64, 32); c.fill();
  c.fillStyle = '#fff'; c.font = `800 28px ${SANS}`; c.textAlign = 'center';
  c.fillText(p.contact, POSTER_W / 2, POSTER_H - 108, 900);
  c.textAlign = 'left';
  footer(c, p, 'rgba(255,255,255,.55)');
}

/* ---- 2. Aurora: mesh gradient with a frosted panel ---- */
function aurora(c: Ctx, p: PosterContent, img: HTMLImageElement | null): void {
  const bg = c.createLinearGradient(0, 0, POSTER_W, POSTER_H);
  bg.addColorStop(0, '#2b1478'); bg.addColorStop(0.55, '#5b3bff'); bg.addColorStop(1, '#12b3c4');
  c.fillStyle = bg; c.fillRect(0, 0, POSTER_W, POSTER_H);
  const blobs: [number, number, number, string][] = [[180, 220, 460, 'rgba(255,90,200,.55)'], [930, 520, 420, 'rgba(60,240,220,.45)'], [300, 1150, 520, 'rgba(120,80,255,.55)'], [980, 1250, 360, 'rgba(255,190,90,.35)']];
  for (const [x, y, r, col] of blobs) {
    const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, POSTER_W, POSTER_H);
  }
  grain(c, 0.06);
  c.textAlign = 'left';
  c.fillStyle = 'rgba(255,255,255,.9)'; spaced(c, true); c.font = `700 30px ${SANS}`; c.fillText(p.kicker, 80, 120); spaced(c, false);

  const cx = POSTER_W / 2, cy = 360, r = 210;
  c.save(); c.beginPath(); c.arc(cx, cy, r + 14, 0, Math.PI * 2); c.fillStyle = 'rgba(255,255,255,.35)'; c.fill();
  c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.clip();
  if (img) cover(c, img, cx - r, cy - r, r * 2, r * 2); else { c.fillStyle = '#ffffff33'; c.fillRect(cx - r, cy - r, r * 2, r * 2); c.fillStyle = 'rgba(255,255,255,.7)'; c.beginPath(); c.arc(cx, cy - 40, 80, 0, Math.PI * 2); c.fill(); c.beginPath(); c.ellipse(cx, cy + 200, 150, 130, 0, Math.PI, 0); c.fill(); }
  c.restore();

  // frosted panel
  const py = 620, ph = 500;
  c.save(); rr(c, 64, py, 952, ph, 44); c.fillStyle = 'rgba(255,255,255,.16)'; c.fill();
  c.strokeStyle = 'rgba(255,255,255,.45)'; c.lineWidth = 2; c.stroke(); c.restore();
  c.fillStyle = '#fff'; c.textAlign = 'center';
  fitOneLine(c, p.name, 860, 88, 800, SANS, 44); c.fillText(p.name, cx, py + 100);
  if (p.ageLine) { c.font = `500 32px ${SANS}`; c.fillStyle = 'rgba(255,255,255,.85)'; c.fillText(p.ageLine, cx, py + 150); }
  c.textAlign = 'left';
  facts(c, p.facts, 120, py + 190, 840, 'rgba(255,255,255,.65)', '#fff', 10, 3, 1114);
  c.fillStyle = '#fff'; rr(c, 64, 1132, 952, 68, 34); c.fill();
  c.fillStyle = '#2b1478'; c.font = `800 28px ${SANS}`; c.textAlign = 'center'; c.fillText(p.contact, cx, 1176, 900);
  c.textAlign = 'left';
  footer(c, p, 'rgba(255,255,255,.75)', POSTER_H - 135);
}

/* ---- 3. Editorial: warm paper, serif headline ---- */
function editorial(c: Ctx, p: PosterContent, img: HTMLImageElement | null): void {
  c.fillStyle = '#f6f2ea'; c.fillRect(0, 0, POSTER_W, POSTER_H);
  c.strokeStyle = '#141414'; c.lineWidth = 3; c.strokeRect(40, 40, POSTER_W - 80, POSTER_H - 80);
  c.textAlign = 'left';
  c.fillStyle = '#d6402a'; spaced(c, true); c.font = `800 30px ${SANS}`; c.fillText(p.kicker, 80, 118); spaced(c, false);
  c.fillStyle = '#141414'; c.fillRect(80, 140, 920, 4);
  fitOneLine(c, p.name, 920, 150, 800, SERIF, 64);
  c.fillText(p.name, 80, 300);
  if (p.ageLine) { c.fillStyle = '#5a5245'; c.font = `italic 500 40px ${SERIF}`; c.fillText(p.ageLine, 80, 360); }

  // The photo used to finish at y=1030 with its red band hanging over the
  // contact rule at 1090 - the band and the "IF YOU HAVE SEEN THEM" line
  // touched on every Editorial poster. It now ends at 1040, with a gap either
  // side of the rule, whatever the photo's size.
  const px = 80, py = 410, pw = 470, ph = 630;
  if (img) { c.save(); c.beginPath(); c.rect(px, py, pw, ph); c.clip(); cover(c, img, px, py, pw, ph); c.restore(); }
  else noPhoto(c, px, py, pw, ph, 0, '#d8d0c0', '#c2b8a4', '#f6f2ea');
  c.strokeStyle = '#141414'; c.lineWidth = 3; c.strokeRect(px, py, pw, ph);
  c.fillStyle = '#d6402a'; c.fillRect(px, py + ph - 22, pw, 22);

  // Ends above the 1090 rule and the contact block.
  facts(c, p.facts, 600, py + 30, 400, '#d6402a', '#141414', 30, 4, 1060);
  c.fillStyle = '#141414'; c.fillRect(80, 1090, 920, 4);
  c.font = `800 26px ${SANS}`; c.fillStyle = '#d6402a'; spaced(c, true); c.fillText('IF YOU HAVE SEEN THEM', 80, 1145); spaced(c, false);
  c.fillStyle = '#141414'; fitOneLine(c, p.contact, 920, 46, 800, SANS, 26); c.fillText(p.contact, 80, 1205);
  footer(c, p, '#5a5245', POSTER_H - 104);
}

/* ---- 9. Notice: the community-appeal shape - bar, photo, fact panel, red band ---- */
function notice(c: Ctx, p: PosterContent, img: HTMLImageElement | null): void {
  const INK = '#0e1116', RED = '#e0392d', PAPER = '#f4f1ea', GOLD = '#f4b400';
  c.fillStyle = PAPER; c.fillRect(0, 0, POSTER_W, POSTER_H);

  // Header bar: the first thing read on a phone at arm's length.
  c.fillStyle = INK; c.fillRect(0, 0, POSTER_W, 160);
  c.textAlign = 'left'; c.fillStyle = '#fff';
  fitOneLine(c, p.kicker.toUpperCase(), 900, 112, 960, SANS, 56);
  c.fillText(p.kicker.toUpperCase(), 56, 126);
  c.fillStyle = RED; c.fillRect(0, 160, POSTER_W, 12);

  // Photo on the left, the facts panel on the right - two columns, like the
  // posters families already share. Both run down to the band at 900, so the
  // sheet has no dead quarter at the bottom.
  const px = 56, py = 206, pw = 440, ph = 660;
  if (img) { c.save(); rr(c, px, py, pw, ph, 12); c.clip(); cover(c, img, px, py, pw, ph); c.restore(); }
  else noPhoto(c, px, py, pw, ph, 12, '#d9d5cc', '#c7c2b7', PAPER);
  c.strokeStyle = INK; c.lineWidth = 4; rr(c, px, py, pw, ph, 12); c.stroke();

  let y = py + 44;
  c.fillStyle = RED; c.font = `800 46px ${SANS}`;
  y = para(c, p.name, 540, y, 484, 46, 1.1, 2, 800, SANS);
  if (p.ageLine) { c.fillStyle = '#5b564d'; c.font = `600 27px ${SANS}`; c.fillText(p.ageLine, 540, y + 34); y += 48; }
  c.fillStyle = INK; c.fillRect(540, y + 20, 484, 3); y += 56;

  const rows = p.facts.slice(0, 4);
  for (const f of rows) {
    if (y > py + ph - 30) break;
    c.fillStyle = RED; c.beginPath(); c.arc(556, y + 10, 14, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff'; c.font = `800 17px ${SANS}`; c.fillText('!', 551, y + 17);
    c.fillStyle = '#7a756c'; c.font = `700 19px ${SANS}`;
    if ('letterSpacing' in c) (c as unknown as { letterSpacing: string }).letterSpacing = '2px';
    c.fillText(f.label, 582, y + 8);
    if ('letterSpacing' in c) (c as unknown as { letterSpacing: string }).letterSpacing = '0px';
    c.fillStyle = INK; c.font = `700 29px ${SANS}`;
    y = para(c, f.value, 582, y + 44, 442, 29, 1.22, 2, 700, SANS);
    y += 22;
  }

  // The band: who to call. Red because that is the colour the eye finds first.
  c.fillStyle = RED; c.fillRect(0, 900, POSTER_W, 210);
  c.fillStyle = '#fff'; c.font = `800 34px ${SANS}`;
  c.fillText('IF YOU HAVE ANY INFORMATION PLEASE CONTACT:', 56, 968, 968);
  fitOneLine(c, p.contact, 968, 52, 800, SANS, 26);
  c.fillText(p.contact, 56, 1052);

  // The footer carries the source, not a slogan: a poster nobody can check is
  // a poster people stop trusting.
  c.fillStyle = INK; c.fillRect(0, 1110, POSTER_W, 240);
  c.fillStyle = GOLD; c.font = `800 30px ${SANS}`;
  c.fillText('Every share counts.', 56, 1178);
  c.fillStyle = '#fff'; c.font = `600 26px ${SANS}`;
  c.fillText(p.foot, 56, 1232, 968);
  c.font = `700 26px ${SANS}`;
  c.fillText(`Read more: ${p.link || 'LulaFind'}`, 56, 1284, 968);
}

/* ---- 4. Beacon: hazard yellow, chunky black type ---- */
function beacon(c: Ctx, p: PosterContent, img: HTMLImageElement | null): void {
  c.fillStyle = '#ffd400'; c.fillRect(0, 0, POSTER_W, POSTER_H);
  c.save(); c.fillStyle = '#111';
  for (let i = -2; i < 22; i++) { c.beginPath(); c.moveTo(i * 70, 0); c.lineTo(i * 70 + 36, 0); c.lineTo(i * 70 + 36 - 96, 96); c.lineTo(i * 70 - 96, 96); c.fill(); }
  for (let i = -2; i < 22; i++) { c.beginPath(); c.moveTo(i * 70, POSTER_H - 96); c.lineTo(i * 70 + 36, POSTER_H - 96); c.lineTo(i * 70 + 36 - 96, POSTER_H); c.lineTo(i * 70 - 96, POSTER_H); c.fill(); }
  c.restore();
  c.textAlign = 'left'; c.fillStyle = '#111';
  fitOneLine(c, p.kicker, 940, 220, 900, SANS, 90); c.fillText(p.kicker, 56, 320);
  const px = 64, py = 360, pw = 480, ph = 560;
  c.fillStyle = '#111'; rr(c, px + 14, py + 14, pw, ph, 20); c.fill();
  if (img) { c.save(); rr(c, px, py, pw, ph, 20); c.clip(); cover(c, img, px, py, pw, ph); c.restore(); } else noPhoto(c, px, py, pw, ph, 20, '#fff', '#eee', '#111');
  c.strokeStyle = '#111'; c.lineWidth = 6; rr(c, px, py, pw, ph, 20); c.stroke();
  // Name auto-fits up to two lines and ellipses the second if even 26px cannot
  // fit it - a long surname used to lose its tail with no warning.
  let y = para(c, p.name, 590, py + 60, 420, 66, 1.12, 2, 800, SANS) - 10;
  if (p.ageLine) { c.font = `700 32px ${SANS}`; c.fillText(p.ageLine, 590, y); y += 46; }
  // The contact bar starts at y=990: facts must stay above it.
  facts(c, p.facts, 590, y + 8, 410, '#7a6500', '#111', 24, 3, 975);
  c.fillStyle = '#111'; rr(c, 64, 990, 952, 150, 24); c.fill();
  c.fillStyle = '#ffd400'; c.font = `800 26px ${SANS}`; spaced(c, true); c.fillText('CALL OR MESSAGE', 100, 1046); spaced(c, false);
  c.fillStyle = '#fff'; fitOneLine(c, p.contact, 880, 48, 800, SANS, 26); c.fillText(p.contact, 100, 1104);
  c.fillStyle = '#111'; c.font = `600 22px ${SANS}`; c.fillText(p.foot, 64, 1188, 952);
  c.font = `800 24px ${SANS}`; c.fillText(`Read more: ${p.link || 'LulaFind'}`, 64, 1242, 952);
}

/* ---- 5. Ubuntu: deep green, gold and red geometry ---- */
function ubuntu(c: Ctx, p: PosterContent, img: HTMLImageElement | null): void {
  c.fillStyle = '#0c2f2a'; c.fillRect(0, 0, POSTER_W, POSTER_H);
  c.save(); c.globalAlpha = 0.22;
  for (let r = 0; r < 12; r++) for (let k = 0; k < 10; k++) { c.fillStyle = (r + k) % 2 ? '#f4b400' : '#e0392d'; c.beginPath(); c.arc(k * 120 + (r % 2) * 60, r * 120, 34, 0, Math.PI * 2); c.fill(); }
  c.restore();
  const v = c.createLinearGradient(0, 300, 0, POSTER_H); v.addColorStop(0, 'rgba(12,47,42,0)'); v.addColorStop(0.5, 'rgba(12,47,42,.96)'); c.fillStyle = v; c.fillRect(0, 300, POSTER_W, POSTER_H - 300);
  c.fillStyle = '#f4b400'; c.beginPath(); c.moveTo(0, 0); c.lineTo(420, 0); c.lineTo(0, 210); c.fill();
  c.fillStyle = '#e0392d'; c.beginPath(); c.moveTo(1080, 0); c.lineTo(740, 0); c.lineTo(1080, 160); c.fill();

  c.textAlign = 'left'; c.fillStyle = '#fff';
  fitOneLine(c, p.kicker, 900, 150, 900, SANS, 80); c.fillText(p.kicker, 64, 330);
  const cx = 540, cy = 588, r = 214;
  c.beginPath(); c.arc(cx, cy, r + 22, 0, Math.PI * 2); c.fillStyle = '#f4b400'; c.fill();
  c.beginPath(); c.arc(cx, cy, r + 8, 0, Math.PI * 2); c.fillStyle = '#0c2f2a'; c.fill();
  c.save(); c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.clip();
  if (img) cover(c, img, cx - r, cy - r, r * 2, r * 2); else { c.fillStyle = '#17574d'; c.fillRect(cx - r, cy - r, r * 2, r * 2); c.fillStyle = 'rgba(255,255,255,.6)'; c.beginPath(); c.arc(cx, cy - 40, 80, 0, Math.PI * 2); c.fill(); c.beginPath(); c.ellipse(cx, cy + 200, 150, 130, 0, Math.PI, 0); c.fill(); }
  c.restore();
  c.textAlign = 'center'; c.fillStyle = '#fff';
  fitOneLine(c, p.name, 900, 84, 800, SANS, 40); c.fillText(p.name, cx, 895);
  if (p.ageLine) { c.fillStyle = '#f4b400'; c.font = `700 32px ${SANS}`; c.fillText(p.ageLine, cx, 936); }
  c.textAlign = 'left';
  // Two facts by design; single-line values keep the SAPS case on the poster.
  facts(c, p.facts, 110, 966, 860, '#f4b400', '#fff', 6, 2, 1170, true);
  c.fillStyle = '#f4b400'; rr(c, 64, 1184, 952, 58, 29); c.fill();
  c.fillStyle = '#0c2f2a'; c.font = `800 25px ${SANS}`; c.textAlign = 'center'; c.fillText(p.contact, cx, 1221, 900); c.textAlign = 'left';
  footer(c, p, 'rgba(255,255,255,.6)', POSTER_H - 92);
}

/* ---- 6. Noir: full-bleed photo, cinematic type ---- */
function noir(c: Ctx, p: PosterContent, img: HTMLImageElement | null): void {
  c.fillStyle = '#000'; c.fillRect(0, 0, POSTER_W, POSTER_H);
  if (img) cover(c, img, 0, 0, POSTER_W, POSTER_H);
  else { const g = c.createLinearGradient(0, 0, POSTER_W, POSTER_H); g.addColorStop(0, '#2b2b2b'); g.addColorStop(1, '#0b0b0b'); c.fillStyle = g; c.fillRect(0, 0, POSTER_W, POSTER_H); c.fillStyle = 'rgba(255,255,255,.08)'; c.beginPath(); c.arc(540, 400, 140, 0, Math.PI * 2); c.fill(); c.beginPath(); c.ellipse(540, 680, 280, 210, 0, Math.PI, 0); c.fill(); }
  const top = c.createLinearGradient(0, 0, 0, 380); top.addColorStop(0, 'rgba(0,0,0,.85)'); top.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = top; c.fillRect(0, 0, POSTER_W, 380);
  const bot = c.createLinearGradient(0, 520, 0, POSTER_H); bot.addColorStop(0, 'rgba(0,0,0,0)'); bot.addColorStop(0.55, 'rgba(0,0,0,.88)'); bot.addColorStop(1, 'rgba(0,0,0,.98)'); c.fillStyle = bot; c.fillRect(0, 520, POSTER_W, POSTER_H - 520);
  c.textAlign = 'left'; c.fillStyle = '#fff'; spaced(c, true); c.font = `700 34px ${SANS}`; c.fillText(p.kicker, 72, 110); spaced(c, false);
  c.fillRect(72, 138, 120, 5);
  fitOneLine(c, p.name, 930, 130, 800, SERIF, 60); c.fillText(p.name, 72, 790);
  if (p.ageLine) { c.fillStyle = 'rgba(255,255,255,.75)'; c.font = `italic 500 38px ${SERIF}`; c.fillText(p.ageLine, 72, 846); }
  c.fillStyle = 'rgba(255,255,255,.4)'; c.fillRect(72, 878, 936, 2);
  facts(c, p.facts, 72, 916, 900, 'rgba(255,255,255,.5)', '#fff', 8, 3, POSTER_H - 130);
  c.fillStyle = '#fff'; c.font = `800 30px ${SANS}`; c.fillText(p.contact, 72, POSTER_H - 96, 936);
  footer(c, p, 'rgba(255,255,255,.55)', POSTER_H - 46);
}

/* ---- 7. Halo: mesh-gradient background, frosted glass card, gradient type ---- */
function halo(c: Ctx, p: PosterContent, img: HTMLImageElement | null): void {
  const bg = c.createLinearGradient(0, 0, POSTER_W, POSTER_H);
  bg.addColorStop(0, '#0a0a1f'); bg.addColorStop(0.48, '#171049'); bg.addColorStop(1, '#04121f');
  c.fillStyle = bg; c.fillRect(0, 0, POSTER_W, POSTER_H);

  const glows: [number, number, number, string][] = [
    [120, 140, 640, 'rgba(124,92,255,.55)'],
    [960, 300, 560, 'rgba(34,211,238,.40)'],
    [520, 1200, 720, 'rgba(255,84,180,.30)']
  ];
  for (const [x, y, r, col] of glows) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, POSTER_W, POSTER_H);
  }
  grain(c, 0.045);

  // the frosted card everything sits in
  const cx = 60, cy = 80, cw = 960, ch = 1090;
  c.save();
  rr(c, cx, cy, cw, ch, 60);
  c.fillStyle = 'rgba(255,255,255,.075)'; c.fill();
  c.strokeStyle = 'rgba(255,255,255,.30)'; c.lineWidth = 2; c.stroke();
  c.restore();

  // kicker chip
  c.textAlign = 'left';
  c.font = `800 30px ${SANS}`; spaced(c, true);
  const kw = c.measureText(p.kicker).width + 64;
  rr(c, cx + 40, cy + 40, kw, 62, 31);
  c.fillStyle = 'rgba(255,255,255,.14)'; c.fill();
  c.fillStyle = '#ffffff'; c.fillText(p.kicker, cx + 72, cy + 83);
  spaced(c, false);

  // photo in a squircle with a soft outer ring
  const px = cx + 40, py = cy + 130, pw = cw - 80, ph = 500;
  c.save();
  rr(c, px - 8, py - 8, pw + 16, ph + 16, 46);
  c.strokeStyle = 'rgba(255,255,255,.22)'; c.lineWidth = 3; c.stroke();
  rr(c, px, py, pw, ph, 40); c.clip();
  if (img) cover(c, img, px, py, pw, ph);
  else noPhoto(c, px, py, pw, ph, 40, 'rgba(124,92,255,.55)', 'rgba(34,211,238,.35)', '#ffffff');
  c.restore();

  // name in a gradient, then the numbers
  const nameGrad = c.createLinearGradient(px, 0, px + pw, 0);
  nameGrad.addColorStop(0, '#ffffff'); nameGrad.addColorStop(1, '#a5b4fc');
  c.fillStyle = nameGrad;
  fitOneLine(c, p.name, pw, 96, 800, SANS, 48);
  c.fillText(p.name, px, py + ph + 90);
  if (p.ageLine) { c.fillStyle = '#8ee7f7'; c.font = `600 34px ${SANS}`; c.fillText(p.ageLine, px, py + ph + 136); }
  // Two facts only, so the text can never run under the contact pill.
  facts(c, p.facts, px, py + ph + 190, pw, 'rgba(255,255,255,.55)', '#ffffff', 14, 2, POSTER_H - 160);

  // contact in a glass pill
  const by = POSTER_H - 165;
  rr(c, px, by, pw, 76, 38);
  const pill = c.createLinearGradient(px, 0, px + pw, 0);
  pill.addColorStop(0, 'rgba(124,92,255,.95)'); pill.addColorStop(1, 'rgba(34,211,238,.92)');
  c.fillStyle = pill; c.fill();
  c.fillStyle = '#0a0a1f'; c.font = `800 28px ${SANS}`; c.textAlign = 'center';
  c.fillText(p.contact, POSTER_W / 2, by + 49, pw - 60);
  c.textAlign = 'left';
  footer(c, p, 'rgba(255,255,255,.62)', POSTER_H - 54);
}

/* ---- 8. Pulse: neon grid, glowing ribbon, ringed portrait ---- */
function pulse(c: Ctx, p: PosterContent, img: HTMLImageElement | null): void {
  c.fillStyle = '#05060a'; c.fillRect(0, 0, POSTER_W, POSTER_H);

  // faint tech grid
  c.save(); c.globalAlpha = 0.16; c.strokeStyle = '#00e5ff'; c.lineWidth = 1;
  for (let x = 0; x <= POSTER_W; x += 60) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, POSTER_H); c.stroke(); }
  for (let y = 0; y <= POSTER_H; y += 60) { c.beginPath(); c.moveTo(0, y); c.lineTo(POSTER_W, y); c.stroke(); }
  c.restore();

  // neon ribbon behind the portrait
  const ribbon = c.createLinearGradient(0, 220, POSTER_W, 760);
  ribbon.addColorStop(0, 'rgba(0,229,255,.85)'); ribbon.addColorStop(0.5, 'rgba(124,92,255,.8)'); ribbon.addColorStop(1, 'rgba(255,45,155,.85)');
  c.save(); c.globalAlpha = 0.9;
  c.beginPath(); c.moveTo(0, 420); c.lineTo(POSTER_W, 190); c.lineTo(POSTER_W, 300); c.lineTo(0, 540); c.closePath();
  c.fillStyle = ribbon; c.fill();
  c.restore();

  // portrait in a glowing ring
  const cx = POSTER_W / 2, cy = 400, r = 205;
  const ring = c.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  ring.addColorStop(0, '#00e5ff'); ring.addColorStop(1, '#ff2d9b');
  c.beginPath(); c.arc(cx, cy, r + 20, 0, Math.PI * 2); c.fillStyle = ring; c.fill();
  c.beginPath(); c.arc(cx, cy, r + 6, 0, Math.PI * 2); c.fillStyle = '#05060a'; c.fill();
  c.save(); c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.clip();
  if (img) cover(c, img, cx - r, cy - r, r * 2, r * 2);
  else {
    c.fillStyle = '#0d1a2b'; c.fillRect(cx - r, cy - r, r * 2, r * 2);
    c.fillStyle = 'rgba(0,229,255,.35)'; c.beginPath(); c.arc(cx, cy - 40, 84, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(cx, cy + 210, 150, 130, 0, Math.PI, 0); c.fill();
  }
  c.restore();

  // scanlines for that screen-printed look
  c.save(); c.globalAlpha = 0.06; c.fillStyle = '#fff';
  for (let y = 0; y < POSTER_H; y += 4) c.fillRect(0, y, POSTER_W, 1);
  c.restore();

  c.textAlign = 'center';
  c.fillStyle = '#00e5ff'; spaced(c, true); c.font = `700 32px ${SANS}`;
  c.fillText(p.kicker, cx, 140); spaced(c, false);
  c.fillStyle = '#ffffff';
  fitOneLine(c, p.name, 900, 96, 800, SANS, 48);
  c.fillText(p.name, cx, cy + r + 120);
  if (p.ageLine) { c.fillStyle = '#ff8ad4'; c.font = `600 34px ${SANS}`; c.fillText(p.ageLine, cx, cy + r + 166); }
  c.textAlign = 'left';
  facts(c, p.facts, 110, cy + r + 220, 860, 'rgba(0,229,255,.75)', '#ffffff', 10, 3, POSTER_H - 200);

  c.fillStyle = '#00e5ff'; rr(c, 64, POSTER_H - 150, 952, 4, 2); c.fill();
  c.fillStyle = '#ffffff'; c.font = `800 28px ${SANS}`;
  c.fillText(p.contact, 64, POSTER_H - 96, 952);
  footer(c, p, 'rgba(255,255,255,.55)', POSTER_H - 46);
}

const DRAW: Record<PosterTemplateId, (c: Ctx, p: PosterContent, i: HTMLImageElement | null) => void> = {
  signal, aurora, editorial, beacon, ubuntu, noir, halo, pulse, notice
};

export function drawPoster(canvas: HTMLCanvasElement, id: PosterTemplateId, content: PosterContent, img: HTMLImageElement | null): void {
  canvas.width = POSTER_W; canvas.height = POSTER_H;
  const c = canvas.getContext('2d');
  if (!c) return;
  c.clearRect(0, 0, POSTER_W, POSTER_H);
  c.textBaseline = 'alphabetic';
  DRAW[id](c, content, img);
}
