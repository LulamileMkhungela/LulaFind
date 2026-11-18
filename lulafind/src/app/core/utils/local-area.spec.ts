import { describe, expect, it } from 'vitest';
import { areaFromOpenStreetMap, prioritizeLocalPosts } from './local-area';
import { Post } from '../models/types';

describe('OpenStreetMap local area', () => {
  it('reads province and city, including KwaZulu-Natal ISO codes', () => {
    expect(areaFromOpenStreetMap({ address: { country_code: 'za', state: 'Gauteng', city: 'Johannesburg' } }))
      .toEqual({ province: 'GP', town: 'Johannesburg' });
    expect(areaFromOpenStreetMap({ address: { country_code: 'za', 'ISO3166-2-lvl4': 'ZA-NL', town: 'Pietermaritzburg' } }))
      .toEqual({ province: 'KZN', town: 'Pietermaritzburg' });
  });
  it('refuses unknown provinces and locations outside South Africa instead of guessing', () => {
    expect(areaFromOpenStreetMap({ address: { country_code: 'za', state: 'Unknown' } })).toBeNull();
    expect(areaFromOpenStreetMap({ address: { country_code: 'bw', state: 'Gauteng' } })).toBeNull();
    expect(areaFromOpenStreetMap(null)).toBeNull();
  });
  it('shows the same town first, then the province, retaining original order and other provinces', () => {
    const posts = [
      { id: 'a', province: 'WC', town: 'Cape Town' },
      { id: 'b', province: 'GP', town: 'Pretoria' },
      { id: 'c', province: 'GP', town: 'JOHANNESBURG' },
      { id: 'd', province: 'GP', town: 'Johannesburg' },
      { id: 'e', province: 'EC', town: 'Gqeberha' }
    ] as Post[];
    expect(prioritizeLocalPosts(posts, { province: 'GP', town: ' Johannesburg ' }).map(p => p.id)).toEqual(['c', 'd', 'b', 'a', 'e']);
    expect(prioritizeLocalPosts(posts, { province: 'GP', town: '' }).map(p => p.id)).toEqual(['b', 'c', 'd', 'a', 'e']);
    expect(prioritizeLocalPosts(posts, null)).toBe(posts);
    expect(posts.map(p => p.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
