/**
 * The places a South African can ask to be told about.
 *
 * An alert is only useful if it names somewhere the reader recognises. "Gauteng"
 * is 15 million people; "Soweto" is the street they actually walk. So the picker
 * offers three levels and lets a person choose several, because a family surname
 * is rarely in one place:
 *
 *   province -> metro (metropolitan municipality) -> city/town
 *
 * The names and the split are the official ones (metros and their main towns),
 * kept deliberately short: a list nobody can scan is a list nobody uses. Towns
 * that people are actually searching from are what matter here, not municipal
 * completeness.
 *
 * Every entry carries a stable `key` (a slug) so a saved preference survives a
 * rename or a reordering, and `label` is what is shown back to the person.
 */
import type { AlertArea, ProvinceCode } from '../models/types';

export interface PlaceMetro {
  key: string;
  label: string;
  /** Towns and suburbs inside this metro that a person can pick directly. */
  cities: { key: string; label: string }[];
}

export interface PlaceProvince {
  code: ProvinceCode;
  label: string;
  metros: PlaceMetro[];
  /** Places outside a metro - a district town the person may still search from. */
  cities: { key: string; label: string }[];
}

const city = (label: string) => ({ key: slug(label), label });

/** A slug that is stable across runs and safe to store in a profile. */
export function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export const PLACES: PlaceProvince[] = [
  {
    code: 'GP',
    label: 'Gauteng',
    metros: [
      { key: 'city-of-johannesburg', label: 'City of Johannesburg', cities: ['Soweto', 'Alexandra', 'Sandton', 'Randburg', 'Roodepoort', 'Midrand', 'Lenasia', 'Orange Farm'].map(city) },
      { key: 'city-of-tshwane', label: 'City of Tshwane', cities: ['Pretoria', 'Mamelodi', 'Soshanguve', 'Atteridgeville', 'Centurion', 'Hammanskraal'].map(city) },
      { key: 'ekurhuleni', label: 'Ekurhuleni', cities: ['Germiston', 'Benoni', 'Boksburg', 'Springs', 'Kempton Park', 'Tembisa', 'Katlehong', 'Daveyton'].map(city) }
    ],
    cities: ['Vereeniging', 'Vanderbijlpark', 'Heidelberg', 'Nigel', 'Bronkhorstspruit', 'Meyerton'].map(city)
  },
  {
    code: 'KZN',
    label: 'KwaZulu-Natal',
    metros: [
      { key: 'ethekwini', label: 'eThekwini', cities: ['Durban', 'Umlazi', 'KwaMashu', 'Chatsworth', 'Phoenix', 'Inanda', 'Pinetown'].map(city) }
    ],
    cities: ['Pietermaritzburg', 'Richards Bay', 'Newcastle', 'Ladysmith', 'Port Shepstone', 'Ulundi', 'Vryheid', 'Empangeni'].map(city)
  },
  {
    code: 'WC',
    label: 'Western Cape',
    metros: [
      { key: 'city-of-cape-town', label: 'City of Cape Town', cities: ['Cape Town', 'Khayelitsha', 'Mitchells Plain', 'Gugulethu', 'Khayelitsha Site C', 'Atlantis', 'Delft', 'Philippi'].map(city) }
    ],
    cities: ['George', 'Paarl', 'Worcester', 'Stellenbosch', 'Mossel Bay', 'Knysna', 'Oudtshoorn', 'Vredenburg', 'Beaufort West'].map(city)
  },
  {
    code: 'EC',
    label: 'Eastern Cape',
    metros: [
      { key: 'nelson-mandela-bay', label: 'Nelson Mandela Bay', cities: ['Gqeberha', 'Uitenhage', 'Motherwell', 'Kariega'].map(city) },
      { key: 'buffalo-city', label: 'Buffalo City', cities: ['East London', 'Mdantsane', 'King William\u2019s Town'].map(city) }
    ],
    cities: ['Mthatha', 'Queenstown', 'Butterworth', 'Grahamstown', 'Makhanda', 'Aliwal North', 'Queenstown'].map(city)
  },
  {
    code: 'FS',
    label: 'Free State',
    metros: [
      { key: 'mangaung', label: 'Mangaung', cities: ['Bloemfontein', 'Botshabelo', 'Thaba Nchu'].map(city) }
    ],
    cities: ['Welkom', 'Sasolburg', 'Bethlehem', 'Kroonstad', 'Parys', 'Harrismith'].map(city)
  },
  {
    code: 'LP',
    label: 'Limpopo',
    metros: [],
    cities: ['Polokwane', 'Tzaneen', 'Thohoyandou', 'Mokopane', 'Lephalale', 'Musina', 'Bela-Bela', 'Giyani'].map(city)
  },
  {
    code: 'MP',
    label: 'Mpumalanga',
    metros: [],
    cities: ['Mbombela', 'Nelspruit', 'Witbank', 'eMalahleni', 'Secunda', 'Middelburg', 'Ermelo', 'Standerton', 'Tonga'].map(city)
  },
  {
    code: 'NW',
    label: 'North West',
    metros: [],
    cities: ['Rustenburg', 'Mahikeng', 'Klerksdorp', 'Potchefstroom', 'Brits', 'Lichtenburg', 'Zeerust'].map(city)
  },
  {
    code: 'NC',
    label: 'Northern Cape',
    metros: [],
    cities: ['Kimberley', 'Upington', 'Springbok', 'Kuruman', 'De Aar', 'Colesberg', 'Kathu'].map(city)
  }
];

/** Duplicate town names collapse to one row, so the picker has no twins. */
export function provinceOf(code: ProvinceCode | string): PlaceProvince | undefined {
  return PLACES.find((p) => p.code === code);
}

/** Every city inside a province, at any depth - what a case is matched against. */
export function citiesIn(code: ProvinceCode | string): AlertArea[] {
  const p = provinceOf(code);
  if (!p) return [];
  return [
    ...p.cities.map((c) => ({ kind: 'city' as const, key: c.key, label: c.label })),
    ...p.metros.flatMap((m) => m.cities.map((c) => ({ kind: 'city' as const, key: c.key, label: c.label })))
  ];
}

/**
 * Does a case belong to the area this member chose?
 *
 * The comparison is intentionally generous, in one direction: a case is matched
 * if the area's name appears anywhere in the case's town, last-seen place or
 * title, or if the case is in the area's province and the area *is* that
 * province. Missing an alert because a poster wrote "Soweto, Johannesburg" is
 * worse than sending one about a place two suburbs away.
 */
export function caseInArea(
  area: AlertArea,
  post: { province?: string | null; town?: string | null; lastSeenWhere?: string | null; title?: string | null }
): boolean {
  if (area.kind === 'province') return (post.province ?? '').toUpperCase() === area.key.toUpperCase();
  const haystack = [post.town, post.lastSeenWhere, post.title].filter(Boolean).join(' ').toLowerCase();
  if (!haystack) return false;
  const needle = area.label.toLowerCase();
  return haystack.includes(needle);
}

/** Does this case's name carry the surname the member is watching? */
export function surnameMatches(surname: string, post: { subject?: { name?: string } | null; title?: string | null }): boolean {
  const wanted = surname.trim().toLowerCase();
  if (!wanted) return false;
  const haystack = `${post.subject?.name ?? ''} ${post.title ?? ''}`.toLowerCase();
  // Word-boundary match, so "Mokoena" does not fire for "Mokoenas" in an advert
  // or for a "Mokoena" mentioned as a street name inside a different surname.
  return new RegExp(`(^|[^a-z])${wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i').test(haystack);
}
