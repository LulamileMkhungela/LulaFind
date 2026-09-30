import { GeoPoint } from '../models/types';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/** "3m", "4h", "2d", "12 Sep" */
export function timeAgo(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return '';
  const d = now - ts;
  if (d < 0) return 'now';
  if (d < MIN) return 'now';
  if (d < HOUR) return `${Math.floor(d / MIN)}m`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h`;
  if (d < 7 * DAY) return `${Math.floor(d / DAY)}d`;
  return new Date(ts).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' });
}

export function fullDate(ts: number | null | undefined): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

export function dayMonth(ts: number | null | undefined): string {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function clockTime(ts: number | null | undefined): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
}

export function daysBetween(a: number, b = Date.now()): number {
  return Math.max(0, Math.floor(Math.abs(b - a) / DAY));
}

export function countdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m left`;
  if (m > 0) return `${m}m ${s}s left`;
  return `${s}s left`;
}

/** 1200 -> 1.2k */
export function compact(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1)}m`;
}

export const uid = (prefix = 'id'): string =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Roughly how urgent a case looks, used to sort "hot" and to badge cards. */
export function urgency(p: { type: string; subject: { age: number | null } | null; status: string; createdAt: number }): 'critical' | 'high' | 'normal' {
  if (p.status !== 'active') return 'normal';
  const age = p.subject?.age ?? null;
  const hours = (Date.now() - p.createdAt) / HOUR;
  if (p.type === 'missing' && age !== null && age < 18) return 'critical';
  if (p.type === 'missing' && hours < 24) return 'critical';
  if (p.type === 'missing') return 'high';
  return 'normal';
}

export function readTime(body: string): number {
  return Math.max(1, Math.round(body.split(/\s+/).length / 200));
}

export const truncate = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function maskContact(v: string): string {
  if (!v) return '';
  if (v.length <= 4) return '••••';
  return `${v.slice(0, 3)} ••• ${v.slice(-2)}`;
}

export interface ParsedName {
  /** collapsed spaces, original casing */
  full: string;
  first: string;
  /** the second name, original casing — this is the surname */
  surname: string;
  /** letters-only slug of the surname; the username is built from this */
  username: string;
  /** John Doe -> JD */
  initials: string;
}

/** Letters-only slug of a surname. Capped so a uniqueness number still fits. */
export function slugSurname(surname: string): string {
  return surname
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 20);
}

/**
 * Full name -> first name + second name.
 * The second name is the surname, and the username is made from it.
 * "John Doe" -> surname Doe, username doe, initials JD.
 * One name is not enough.
 */
export function parseFullName(raw: string): ParsedName | null {
  const full = raw.trim().replace(/\s+/g, ' ');
  const parts = full.split(' ');
  if (parts.length < 2) return null;
  const first = parts[0];
  const surname = parts[1];
  if (!/^[A-Za-z][A-Za-z'’.-]{0,39}$/.test(first)) return null;
  if (!/^[A-Za-z][A-Za-z'’.-]{1,39}$/.test(surname)) return null;
  const username = slugSurname(surname);
  if (username.length < 2) return null;
  const initials = (first[0] + surname[0]).toUpperCase();
  return { full, first, surname, username, initials };
}

/**
 * First free username from a surname slug.
 * `keep` is the person's current username, so saving an unchanged name
 * does not steal it from themselves.
 */
export function nextHandle(base: string, taken: string[], keep?: string): string {
  const mine = (keep ?? '').toLowerCase();
  const used = new Set(taken.map((h) => h.toLowerCase()).filter((h) => h && h !== mine));
  let handle = base;
  let n = 1;
  while (used.has(handle)) handle = `${base}${n++}`;
  return handle.slice(0, 24);
}

/** "Contributor x4" — the number is how many times they were named as the finder. */
export function contributorLabel(n: number | null | undefined): string {
  const c = n ?? 0;
  if (c <= 0) return '';
  return `Contributor x${c}`;
}

/** True when `needle` already appears in any of the texts (ignores case and extra spaces). Used to stop a post repeating itself. */
export function alreadySaid(needle: string | null | undefined, ...texts: (string | null | undefined)[]): boolean {
  const n = (needle ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!n) return true;
  return texts.some((t) => (t ?? '').toLowerCase().replace(/\s+/g, ' ').includes(n));
}

/** A heading that only repeats the start of the body is not worth showing twice. */
export function headingIsNew(title: string | null | undefined, body: string | null | undefined): boolean {
  const t = (title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!t) return false;
  const b = (body ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return !b.startsWith(t);
}

/**
 * Straight-line distance in km between two points. Used to show how far a case
 * alert is from the member's own device fix, so the alert radius means something.
 */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
