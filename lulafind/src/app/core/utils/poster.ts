import { Post, provinceName } from '../models/types';
import { dayMonth } from './format';

/**
 * A public flyer. PawBoost's own poster advice is to keep it short and leave
 * one identifying mark off, so a caller has to know it. The reward amount
 * stays off too — a public amount is how fake tipsters pick a family.
 */
export function publicPoster(post: Post): { lines: string[]; withheld: string | null; shareText: string } {
  const lines: string[] = [];
  if (post.subject?.name) {
    lines.push(post.subject.age != null ? `${post.subject.name}, ${post.subject.age}` : post.subject.name);
  }
  const where = [post.lastSeenWhere, post.town, provinceName(post.province)].filter(Boolean).join(', ');
  if (where) lines.push(`Last seen: ${where}${post.lastSeenAt ? ` · ${dayMonth(post.lastSeenAt)}` : ''}`);
  if (post.subject?.clothing) lines.push(`Wearing: ${post.subject.clothing}`);
  if (post.type === 'pet') {
    const brief = post.body.replace(/\s+/g, ' ').trim().slice(0, 180);
    if (brief) lines.push(brief);
  }
  if (post.caseNumber) lines.push(`Station case: ${post.caseNumber}`);
  if (post.contactVisibleTo === 'everyone' && post.contactValue) {
    lines.push(`${post.contactLabel || 'Contact'}: ${post.contactValue}`);
  }
  const withheld = post.subject?.distinguishing?.trim() || null;
  const close = 'If they are in danger, call 10111. This is not a police poster.';
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

export type PosterTemplateId = 'signal' | 'aurora' | 'editorial' | 'beacon' | 'ubuntu' | 'noir';

export interface PosterTemplate { id: PosterTemplateId; name: string; tagline: string; swatch: [string, string, string]; }

export const POSTER_TEMPLATES: PosterTemplate[] = [
  { id: 'signal', name: 'Signal', tagline: 'Bold and urgent', swatch: ['#0b0b0f', '#ff3d3d', '#ff8a3d'] },
  { id: 'aurora', name: 'Aurora', tagline: 'Soft glass on a glowing gradient', swatch: ['#3b1d8f', '#1fb6c9', '#7b5cff'] },
  { id: 'editorial', name: 'Editorial', tagline: 'Clean, magazine style', swatch: ['#f6f2ea', '#141414', '#d6402a'] },
  { id: 'beacon', name: 'Beacon', tagline: 'High-visibility yellow', swatch: ['#ffd400', '#111111', '#ffffff'] },
  { id: 'ubuntu', name: 'Ubuntu', tagline: 'Proudly South African', swatch: ['#0c2f2a', '#f4b400', '#e0392d'] },
  { id: 'noir', name: 'Noir', tagline: 'Full-bleed photo, cinematic', swatch: ['#000000', '#ffffff', '#c7c7c7'] }
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
  const s = post.subject;
  const kicker = post.type === 'pet' ? 'LOST PET' : post.type === 'khumbulekhaya' ? 'HAVE YOU SEEN' : 'MISSING';
  const name = (s?.name || (post.type === 'pet' ? 'Pet' : 'Someone we love')).trim();
  const bits: string[] = [];
  if (s?.age != null) bits.push(`${s.age} years old`);
  if (s?.gender && s.gender !== 'unknown' && post.type !== 'pet') bits.push(s.gender === 'female' ? 'Female' : s.gender === 'male' ? 'Male' : 'Other');
  const facts: { label: string; value: string }[] = [];
  const where = [post.lastSeenWhere, post.town, provinceName(post.province)].filter(Boolean).join(', ');
  if (where) facts.push({ label: 'LAST SEEN', value: where });
  if (post.lastSeenAt) facts.push({ label: 'WHEN', value: dayMonth(post.lastSeenAt) });
  if (s?.clothing) facts.push({ label: post.type === 'pet' ? 'MARKS' : 'WEARING', value: s.clothing });
  else if (post.type === 'pet' && s?.distinguishing) facts.push({ label: 'MARKS', value: s.distinguishing });
  if (post.caseNumber) facts.push({ label: 'SAPS CASE', value: post.caseNumber });
  const contact = post.contactVisibleTo === 'everyone' && post.contactValue
    ? `${post.contactLabel || 'Contact'}: ${post.contactValue}` : 'Message the family on LulaFind';
  return {
    kicker, name, ageLine: bits.join(' · '), facts, contact, link,
    foot: 'If they are in danger, call 10111. This is not a police poster.',
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
  const words = text.split(/\s+/).filter(Boolean);
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

function facts(c: Ctx, items: { label: string; value: string }[], x: number, y: number, w: number, label: string, value: string, gap = 30, maxItems = 4): number {
  for (const f of items.slice(0, maxItems)) {
    c.fillStyle = label; c.font = `700 22px ${SANS}`;
    if ('letterSpacing' in c) (c as unknown as { letterSpacing: string }).letterSpacing = '3px';
    c.fillText(f.label, x, y);
    if ('letterSpacing' in c) (c as unknown as { letterSpacing: string }).letterSpacing = '0px';
    c.fillStyle = value;
    y = para(c, f.value, x, y + 40, w, 34, 1.25, 2, 600) + gap - 8;
  }
  return y;
}

function spaced(c: Ctx, on: boolean): void {
  if ('letterSpacing' in c) (c as unknown as { letterSpacing: string }).letterSpacing = on ? '6px' : '0px';
}

function footer(c: Ctx, p: PosterContent, color: string, y = POSTER_H - 58): void {
  c.fillStyle = color;
  c.font = `500 22px ${SANS}`;
  c.textAlign = 'left';
  c.fillText(p.foot, 64, y);
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
  facts(c, p.facts, px + 8, py + ph + 205, 930, 'rgba(255,255,255,.5)', '#fff', 14, 3);

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
  const py = 620, ph = 570;
  c.save(); rr(c, 64, py, 952, ph, 44); c.fillStyle = 'rgba(255,255,255,.16)'; c.fill();
  c.strokeStyle = 'rgba(255,255,255,.45)'; c.lineWidth = 2; c.stroke(); c.restore();
  c.fillStyle = '#fff'; c.textAlign = 'center';
  fitOneLine(c, p.name, 860, 88, 800, SANS, 44); c.fillText(p.name, cx, py + 100);
  if (p.ageLine) { c.font = `500 32px ${SANS}`; c.fillStyle = 'rgba(255,255,255,.85)'; c.fillText(p.ageLine, cx, py + 150); }
  c.textAlign = 'left';
  facts(c, p.facts, 120, py + 215, 840, 'rgba(255,255,255,.65)', '#fff', 16, 3);
  c.fillStyle = '#fff'; rr(c, 64, 1215, 952, 68, 34); c.fill();
  c.fillStyle = '#2b1478'; c.font = `800 28px ${SANS}`; c.textAlign = 'center'; c.fillText(p.contact, cx, 1259, 900);
  c.textAlign = 'left';
  footer(c, p, 'rgba(255,255,255,.75)', POSTER_H - 34);
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

  const px = 80, py = 410, pw = 470, ph = 620;
  if (img) { c.save(); c.beginPath(); c.rect(px, py, pw, ph); c.clip(); cover(c, img, px, py, pw, ph); c.restore(); }
  else noPhoto(c, px, py, pw, ph, 0, '#d8d0c0', '#c2b8a4', '#f6f2ea');
  c.strokeStyle = '#141414'; c.lineWidth = 3; c.strokeRect(px, py, pw, ph);
  c.fillStyle = '#d6402a'; c.fillRect(px + 24, py + ph - 24, pw, 24);

  facts(c, p.facts, 600, py + 30, 400, '#d6402a', '#141414', 30, 4);
  c.fillStyle = '#141414'; c.fillRect(80, 1090, 920, 4);
  c.font = `800 26px ${SANS}`; c.fillStyle = '#d6402a'; spaced(c, true); c.fillText('IF YOU HAVE SEEN THEM', 80, 1145); spaced(c, false);
  c.fillStyle = '#141414'; fitOneLine(c, p.contact, 920, 46, 800, SANS, 26); c.fillText(p.contact, 80, 1205);
  footer(c, p, '#5a5245', POSTER_H - 68);
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
  c.fillStyle = '#111'; fitOneLine(c, p.name, 420, 66, 900, SANS, 34);
  const nm = wrap(c, p.name, 420); let y = py + 60; for (const l of nm.slice(0, 2)) { c.fillText(l, 590, y); y += 74; }
  if (p.ageLine) { c.font = `700 32px ${SANS}`; c.fillText(p.ageLine, 590, y - 8); y += 50; }
  facts(c, p.facts, 590, y + 20, 410, '#7a6500', '#111', 24, 3);
  c.fillStyle = '#111'; rr(c, 64, 990, 952, 150, 24); c.fill();
  c.fillStyle = '#ffd400'; c.font = `800 26px ${SANS}`; spaced(c, true); c.fillText('CALL OR MESSAGE', 100, 1046); spaced(c, false);
  c.fillStyle = '#fff'; fitOneLine(c, p.contact, 880, 48, 800, SANS, 26); c.fillText(p.contact, 100, 1104);
  c.fillStyle = '#111'; c.font = `600 22px ${SANS}`; c.fillText(p.foot, 64, 1200);
}

/* ---- 5. Ubuntu: deep green, gold and red geometry ---- */
function ubuntu(c: Ctx, p: PosterContent, img: HTMLImageElement | null): void {
  c.fillStyle = '#0c2f2a'; c.fillRect(0, 0, POSTER_W, POSTER_H);
  c.save(); c.globalAlpha = 0.22;
  for (let r = 0; r < 12; r++) for (let k = 0; k < 10; k++) { c.fillStyle = (r + k) % 2 ? '#f4b400' : '#e0392d'; c.beginPath(); c.arc(k * 120 + (r % 2) * 60, r * 120, 34, 0, Math.PI * 2); c.fill(); }
  c.restore();
  const v = c.createLinearGradient(0, 300, 0, POSTER_H); v.addColorStop(0, 'rgba(12,47,42,0)'); v.addColorStop(0.5, 'rgba(12,47,42,.96)'); c.fillStyle = v; c.fillRect(0, 300, POSTER_W, POSTER_H - 300);
  c.fillStyle = '#f4b400'; c.beginPath(); c.moveTo(0, 0); c.lineTo(540, 0); c.lineTo(0, 300); c.fill();
  c.fillStyle = '#e0392d'; c.beginPath(); c.moveTo(1080, 0); c.lineTo(760, 0); c.lineTo(1080, 220); c.fill();

  c.textAlign = 'left'; c.fillStyle = '#fff';
  fitOneLine(c, p.kicker, 900, 170, 900, SANS, 80); c.fillText(p.kicker, 64, 330);
  const cx = 540, cy = 640, r = 250;
  c.beginPath(); c.arc(cx, cy, r + 22, 0, Math.PI * 2); c.fillStyle = '#f4b400'; c.fill();
  c.beginPath(); c.arc(cx, cy, r + 8, 0, Math.PI * 2); c.fillStyle = '#0c2f2a'; c.fill();
  c.save(); c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.clip();
  if (img) cover(c, img, cx - r, cy - r, r * 2, r * 2); else { c.fillStyle = '#17574d'; c.fillRect(cx - r, cy - r, r * 2, r * 2); c.fillStyle = 'rgba(255,255,255,.6)'; c.beginPath(); c.arc(cx, cy - 40, 80, 0, Math.PI * 2); c.fill(); c.beginPath(); c.ellipse(cx, cy + 200, 150, 130, 0, Math.PI, 0); c.fill(); }
  c.restore();
  c.textAlign = 'center'; c.fillStyle = '#fff';
  fitOneLine(c, p.name, 900, 88, 800, SANS, 44); c.fillText(p.name, cx, 985);
  if (p.ageLine) { c.fillStyle = '#f4b400'; c.font = `700 34px ${SANS}`; c.fillText(p.ageLine, cx, 1035); }
  c.textAlign = 'left';
  facts(c, p.facts.slice(0, 2), 110, 1095, 860, '#f4b400', '#fff', 8, 2);
  c.fillStyle = '#f4b400'; rr(c, 64, 1240, 952, 60, 30); c.fill();
  c.fillStyle = '#0c2f2a'; c.font = `800 26px ${SANS}`; c.textAlign = 'center'; c.fillText(p.contact, cx, 1279, 900); c.textAlign = 'left';
  footer(c, p, 'rgba(255,255,255,.6)', POSTER_H - 20);
}

/* ---- 6. Noir: full-bleed photo, cinematic type ---- */
function noir(c: Ctx, p: PosterContent, img: HTMLImageElement | null): void {
  c.fillStyle = '#000'; c.fillRect(0, 0, POSTER_W, POSTER_H);
  if (img) cover(c, img, 0, 0, POSTER_W, POSTER_H);
  else { const g = c.createLinearGradient(0, 0, POSTER_W, POSTER_H); g.addColorStop(0, '#2b2b2b'); g.addColorStop(1, '#0b0b0b'); c.fillStyle = g; c.fillRect(0, 0, POSTER_W, POSTER_H); c.fillStyle = 'rgba(255,255,255,.12)'; c.beginPath(); c.arc(540, 480, 190, 0, Math.PI * 2); c.fill(); c.beginPath(); c.ellipse(540, 900, 340, 300, 0, Math.PI, 0); c.fill(); }
  const top = c.createLinearGradient(0, 0, 0, 380); top.addColorStop(0, 'rgba(0,0,0,.85)'); top.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = top; c.fillRect(0, 0, POSTER_W, 380);
  const bot = c.createLinearGradient(0, 520, 0, POSTER_H); bot.addColorStop(0, 'rgba(0,0,0,0)'); bot.addColorStop(0.55, 'rgba(0,0,0,.88)'); bot.addColorStop(1, 'rgba(0,0,0,.98)'); c.fillStyle = bot; c.fillRect(0, 520, POSTER_W, POSTER_H - 520);
  c.textAlign = 'left'; c.fillStyle = '#fff'; spaced(c, true); c.font = `700 34px ${SANS}`; c.fillText(p.kicker, 72, 110); spaced(c, false);
  c.fillRect(72, 138, 120, 5);
  fitOneLine(c, p.name, 930, 130, 800, SERIF, 60); c.fillText(p.name, 72, 790);
  if (p.ageLine) { c.fillStyle = 'rgba(255,255,255,.75)'; c.font = `italic 500 38px ${SERIF}`; c.fillText(p.ageLine, 72, 846); }
  c.fillStyle = 'rgba(255,255,255,.4)'; c.fillRect(72, 878, 936, 2);
  facts(c, p.facts.slice(0, 3), 72, 925, 900, 'rgba(255,255,255,.5)', '#fff', 12, 3);
  c.fillStyle = '#fff'; c.font = `800 30px ${SANS}`; c.fillText(p.contact, 72, POSTER_H - 96, 936);
  footer(c, p, 'rgba(255,255,255,.55)', POSTER_H - 46);
}

const DRAW: Record<PosterTemplateId, (c: Ctx, p: PosterContent, i: HTMLImageElement | null) => void> = {
  signal, aurora, editorial, beacon, ubuntu, noir
};

export function drawPoster(canvas: HTMLCanvasElement, id: PosterTemplateId, content: PosterContent, img: HTMLImageElement | null): void {
  canvas.width = POSTER_W; canvas.height = POSTER_H;
  const c = canvas.getContext('2d');
  if (!c) return;
  c.clearRect(0, 0, POSTER_W, POSTER_H);
  c.textBaseline = 'alphabetic';
  DRAW[id](c, content, img);
}
