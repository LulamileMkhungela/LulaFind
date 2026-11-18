import { PROVINCES, ProvinceCode, Post } from '../models/types';

export interface LocalArea { province: ProvinceCode; town: string; }

/** Parse a Nominatim reverse result without guessing across province boundaries. */
export function areaFromOpenStreetMap(result: unknown): LocalArea | null {
  const address = (result as { address?: Record<string, unknown> } | null)?.address;
  if (!address || String(address['country_code'] ?? '').toLowerCase() !== 'za') return null;
  const normalize = (value: unknown): string => String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  const state = normalize(address['state']);
  const iso = String(address['ISO3166-2-lvl4'] ?? '').toUpperCase();
  const province = PROVINCES.find((p) => normalize(p.name) === state || `ZA-${p.code === 'KZN' ? 'NL' : p.code}` === iso);
  if (!province) return null;
  const town = ['city', 'town', 'village', 'municipality', 'suburb'].map((key) => address[key])
    .find((value) => typeof value === 'string' && value.trim());
  return { province: province.code, town: typeof town === 'string' ? town.trim() : '' };
}

/** Stable priority, without changing the membership or visibility of the feed. */
export function prioritizeLocalPosts(posts: Post[], area: { province: ProvinceCode | null; town: string } | null): Post[] {
  if (!area?.province) return posts;
  const town = area.town.trim().toLocaleLowerCase();
  const rank = (p: Post): number => p.province !== area.province ? 2 :
    town && p.town?.trim().toLocaleLowerCase() === town ? 0 : 1;
  return posts.map((post, index) => ({ post, index, rank: rank(post) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index).map(({ post }) => post);
}
