import { DangerKind, PostType, ProvinceCode } from '../models/types';

/**
 * The poster generator's reader.
 *
 * The composer is one textbox prefilled with a labeled example
 * (`POSTER_TEMPLATES`). People fill in the example, and this parser pulls the
 * labels back out: who, how old, where (town + province), what happened, how
 * to reach the family, and the category extras (vehicle, registration, alert
 * kind). Anything without a label is kept as part of the story, so nothing
 * typed is ever thrown away.
 *
 * The post body stays the full raw text - search, the detail page and the
 * shared poster all see exactly what was typed. The parsed fields only add
 * the structure the feed, the filters and the poster need.
 */

export type PosterCategory = Exclude<PostType, 'story'>;

export const POSTER_TEMPLATES: Record<PosterCategory, string> = {
  missing: [
    'Name: Lerato Dlamini',
    'Age: 24',
    'Last seen: Soweto, Gauteng',
    'What happened: She left home on Friday morning and has not come back. She was wearing a red jacket and black jeans.',
    'Contact: 082 123 4567'
  ].join('\n'),
  khumbulekhaya: [
    'Name: Sipho Ndlovu',
    'Age: 19',
    'Left home: Umlazi, KwaZulu-Natal',
    'What happened: He left home two weeks ago after an argument. The family just wants to know that he is safe.',
    'Message for them: We love you and we are not angry. Please let us know you are okay.',
    'Contact: 083 123 4567'
  ].join('\n'),
  vehicle: [
    'Vehicle: White Toyota Hilux',
    'Registration: ABC 123 GP',
    'Taken from: Randburg, Gauteng',
    'What happened: Taken from the driveway during the night. Please do not approach it - call the police.',
    'Case number: 123/01/2026',
    'Contact: 084 123 4567'
  ].join('\n'),
  pet: [
    "Pet's name: Biscuit, Jack Russell",
    'Last seen: Bellville, Western Cape',
    'What happened: He slipped out of the gate this morning. He is friendly and answers to his name.',
    'Contact: 079 123 4567'
  ].join('\n'),
  sighting: [
    'Saw: A man who looks like the person on the missing poster',
    'Where: Park Station, Johannesburg, Gauteng',
    'What happened: He was sitting near the main entrance in a grey hoodie at about 8 this morning. I only write what I saw myself.'
  ].join('\n'),
  danger: [
    'Alert: Robbery',
    'Where: Long Street, Cape Town, Western Cape',
    'What is happening: A group is robbing people walking past the taxi rank. Avoid the area and do not confront anyone.'
  ].join('\n')
};

/** Everything the composer needs from the textbox, pulled out of the labels. */
export interface ParsedPoster {
  subjectName: string;
  subjectAge: number | null;
  town: string;
  province: ProvinceCode | null;
  /** The place detail without the town and province ("" when fully parsed). */
  lastSeenWhere: string;
  /** First location value, for error messages. */
  locationRaw: string;
  contact: string;
  caseNumber: string;
  vehicleMakeModel: string;
  vehicleRegistration: string;
  vehicleColour: string;
  dangerKind: DangerKind;
  alertRaw: string;
  /** KhumbulEkhaya message for the person who left home. */
  message: string;
  /** Label-stripped story lines plus every unlabeled line, in order. */
  narrative: string[];
}

const LABELS: { field: string; match: string[] }[] = [
  { field: 'name', match: ['name', "pet's name", 'pet name', 'pet', 'who', 'person'] },
  { field: 'age', match: ['age'] },
  { field: 'location', match: ['last seen', 'taken from', 'where', 'location', 'left home', 'suburb', 'area', 'place', 'seen at'] },
  { field: 'vehicle', match: ['vehicle', 'car', 'van', 'bakkie', 'truck', 'motorbike', 'bike'] },
  { field: 'registration', match: ['registration', 'reg', 'plate', 'number plate'] },
  { field: 'colour', match: ['colour', 'color'] },
  { field: 'alert', match: ['alert', 'alert type', 'danger', 'kind'] },
  { field: 'contact', match: ['contact', 'phone', 'number', 'cell', 'tel', 'telephone'] },
  { field: 'caseNumber', match: ['case', 'case number', 'saps', 'reference', 'cas number'] },
  { field: 'message', match: ['message', 'message for them'] },
  { field: 'narrative', match: ['what happened', 'what is happening', 'details', 'detail', 'description', 'story', 'saw', 'happened', 'when'] }
];

const fieldOf = (label: string): string => {
  const clean = label.trim().toLowerCase();
  for (const group of LABELS) {
    if (group.match.some((m) => clean === m || clean.startsWith(m + ' '))) return group.field;
  }
  return 'unknown';
};

/* Province names, codes and everyday spellings, longest first so that
 * "Kwazulu Natal" wins over a bare "Natal" inside it. */
const PROVINCE_PHRASES: { phrase: string; code: ProvinceCode }[] = [
  { phrase: 'kwazulu natal', code: 'KZN' }, { phrase: 'kwazulu-natal', code: 'KZN' },
  { phrase: 'western cape', code: 'WC' }, { phrase: 'eastern cape', code: 'EC' },
  { phrase: 'northern cape', code: 'NC' }, { phrase: 'north west', code: 'NW' },
  { phrase: 'northwest', code: 'NW' }, { phrase: 'free state', code: 'FS' },
  { phrase: 'gauteng', code: 'GP' }, { phrase: 'limpopo', code: 'LP' },
  { phrase: 'mpumalanga', code: 'MP' }, { phrase: 'natal', code: 'KZN' },
  { phrase: 'kzn', code: 'KZN' }, { phrase: 'gp', code: 'GP' }, { phrase: 'wc', code: 'WC' },
  { phrase: 'ec', code: 'EC' }, { phrase: 'fs', code: 'FS' }, { phrase: 'lp', code: 'LP' },
  { phrase: 'mp', code: 'MP' }, { phrase: 'nw', code: 'NW' }, { phrase: 'nc', code: 'NC' }
];

/** Major towns and cities mapped to their province, so "Soweto" alone is enough. */
const CITY_PROVINCE: { phrase: string; code: ProvinceCode }[] = [
  { phrase: 'johannesburg', code: 'GP' }, { phrase: 'joburg', code: 'GP' }, { phrase: 'soweto', code: 'GP' },
  { phrase: 'sandton', code: 'GP' }, { phrase: 'randburg', code: 'GP' }, { phrase: 'midrand', code: 'GP' },
  { phrase: 'pretoria', code: 'GP' }, { phrase: 'tshwane', code: 'GP' }, { phrase: 'centurion', code: 'GP' },
  { phrase: 'benoni', code: 'GP' }, { phrase: 'germiston', code: 'GP' }, { phrase: 'springs', code: 'GP' },
  { phrase: 'krugersdorp', code: 'GP' }, { phrase: 'vereeniging', code: 'GP' }, { phrase: 'vanderbijlpark', code: 'GP' },
  { phrase: 'alexandra', code: 'GP' }, { phrase: 'tembisa', code: 'GP' }, { phrase: 'boksburg', code: 'GP' },
  { phrase: 'edenvale', code: 'GP' }, { phrase: 'roodepoort', code: 'GP' }, { phrase: 'alberton', code: 'GP' },
  { phrase: 'durban', code: 'KZN' }, { phrase: 'pinetown', code: 'KZN' }, { phrase: 'umlazi', code: 'KZN' },
  { phrase: 'kwamashu', code: 'KZN' }, { phrase: 'phoenix', code: 'KZN' }, { phrase: 'pietermaritzburg', code: 'KZN' },
  { phrase: 'maritzburg', code: 'KZN' }, { phrase: 'newcastle', code: 'KZN' }, { phrase: 'richards bay', code: 'KZN' },
  { phrase: 'empangeni', code: 'KZN' }, { phrase: 'umhlanga', code: 'KZN' }, { phrase: 'ballito', code: 'KZN' },
  { phrase: 'port shepstone', code: 'KZN' },
  { phrase: 'cape town', code: 'WC' }, { phrase: 'capetown', code: 'WC' }, { phrase: 'stellenbosch', code: 'WC' },
  { phrase: 'paarl', code: 'WC' }, { phrase: 'khayelitsha', code: 'WC' }, { phrase: 'mitchells plain', code: 'WC' },
  { phrase: 'mitchellsplein', code: 'WC' }, { phrase: 'bellville', code: 'WC' }, { phrase: 'somerset west', code: 'WC' },
  { phrase: 'george', code: 'WC' }, { phrase: 'worcester', code: 'WC' }, { phrase: 'oudtshoorn', code: 'WC' },
  { phrase: 'gqeberha', code: 'EC' }, { phrase: 'port elizabeth', code: 'EC' }, { phrase: 'east london', code: 'EC' },
  { phrase: 'mthatha', code: 'EC' }, { phrase: 'uthatha', code: 'EC' }, { phrase: 'makhanda', code: 'EC' },
  { phrase: 'grahamstown', code: 'EC' }, { phrase: 'komani', code: 'EC' }, { phrase: 'queenstown', code: 'EC' },
  { phrase: 'bloemfontein', code: 'FS' }, { phrase: 'mangaung', code: 'FS' }, { phrase: 'welkom', code: 'FS' },
  { phrase: 'kroonstad', code: 'FS' }, { phrase: 'bethlehem', code: 'FS' },
  { phrase: 'polokwane', code: 'LP' }, { phrase: 'tzaneen', code: 'LP' }, { phrase: 'thohoyandou', code: 'LP' },
  { phrase: 'musina', code: 'LP' }, { phrase: 'bela bela', code: 'LP' }, { phrase: 'bela-bela', code: 'LP' },
  { phrase: 'mbombela', code: 'MP' }, { phrase: 'nelspruit', code: 'MP' }, { phrase: 'emalahleni', code: 'MP' },
  { phrase: 'witbank', code: 'MP' }, { phrase: 'secunda', code: 'MP' }, { phrase: 'ermelo', code: 'MP' },
  { phrase: 'rustenburg', code: 'NW' }, { phrase: 'klerksdorp', code: 'NW' }, { phrase: 'potchefstroom', code: 'NW' },
  { phrase: 'mahikeng', code: 'NW' }, { phrase: 'mmabatho', code: 'NW' }, { phrase: 'brits', code: 'NW' },
  { phrase: 'kimberley', code: 'NC' }, { phrase: 'upington', code: 'NC' }, { phrase: 'springbok', code: 'NC' },
  { phrase: 'de aar', code: 'NC' }, { phrase: 'colesberg', code: 'NC' }
];

const normalize = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word match, so "Natal" never fires inside "Natalspruit". */
const mentions = (haystack: string, phrase: string): boolean =>
  new RegExp(`\\b${escapeRegExp(phrase)}\\b`).test(haystack);

const matchProvince = (segment: string): ProvinceCode | null => {
  const clean = normalize(segment);
  if (!clean) return null;
  const sorted = [...PROVINCE_PHRASES].sort((a, b) => b.phrase.length - a.phrase.length);
  return sorted.find((p) => mentions(clean, p.phrase))?.code ?? null;
};

const matchCity = (segment: string): { town: string; code: ProvinceCode } | null => {
  const clean = normalize(segment);
  if (!clean) return null;
  const sorted = [...CITY_PROVINCE].sort((a, b) => b.phrase.length - a.phrase.length);
  const hit = sorted.find((c) => mentions(clean, c.phrase));
  return hit ? { town: segment.trim(), code: hit.code } : null;
};

const DANGER_WORDS: { kind: DangerKind; words: string[] }[] = [
  { kind: 'hijacking', words: ['hijack', 'carjack'] },
  { kind: 'robbery', words: ['robbery', 'rob', 'theft', 'steal', 'stolen', 'mugg', 'burglar', 'break in', 'break-in'] },
  { kind: 'violence', words: ['violence', 'violent', 'fight', 'assault', 'attack', 'stab', 'shoot', 'gun', 'abuse', 'gbv'] },
  { kind: 'unrest', words: ['unrest', 'protest', 'riot', 'loot', 'strike'] },
  { kind: 'fire', words: ['fire', 'blaze', 'burn', 'arson'] }
];

const dangerKindOf = (raw: string): DangerKind => {
  const clean = normalize(raw);
  const direct = (['violence', 'robbery', 'hijacking', 'unrest', 'fire', 'other'] as DangerKind[])
    .find((kind) => clean === kind || clean === `other ${kind}` || (kind === 'other' && clean.startsWith('other')));
  if (direct) return direct;
  for (const group of DANGER_WORDS) {
    if (group.words.some((w) => clean.includes(w))) return group.kind;
  }
  return 'other';
};

const blank = (): ParsedPoster => ({
  subjectName: '', subjectAge: null, town: '', province: null, lastSeenWhere: '',
  locationRaw: '', contact: '', caseNumber: '', vehicleMakeModel: '', vehicleRegistration: '',
  vehicleColour: '', dangerKind: 'other', alertRaw: '', message: '', narrative: []
});

/**
 * "Park Station, Johannesburg, Gauteng" becomes town Johannesburg, province
 * Gauteng, place detail "Park Station". A lone "Soweto" resolves through the
 * city list. When the province cannot be found it stays null and the composer
 * asks for it - the app never guesses a province.
 */
const parseLocation = (value: string, out: ParsedPoster): void => {
  const segments = value.split(',').map((s) => s.trim()).filter(Boolean);
  if (!segments.length) return;
  let province: ProvinceCode | null = null;
  let town = '';
  let townIndex = -1;
  const provinceIndexes = new Set<number>();
  segments.forEach((segment, index) => {
    const provinceHit = matchProvince(segment);
    if (provinceHit) {
      provinceIndexes.add(index);
      province = province ?? provinceHit;
      return;
    }
    const cityHit = matchCity(segment);
    if (cityHit) {
      province = province ?? cityHit.code;
      if (!town) { town = cityHit.town; townIndex = index; }
    }
  });
  if (!town) {
    const fallbackIndex = segments.findIndex((_, index) => !provinceIndexes.has(index));
    if (fallbackIndex >= 0) { town = segments[fallbackIndex]; townIndex = fallbackIndex; }
  }
  const detail = segments.filter((_, index) => index !== townIndex && !provinceIndexes.has(index));
  out.town = town;
  out.province = province;
  // When the whole value was just "Soweto, Gauteng" there is no extra place
  // detail - leaving it blank keeps the poster line free of repeats.
  out.lastSeenWhere = detail.join(', ');
};

export function parsePosterText(type: PosterCategory, raw: string): ParsedPoster {
  const out = blank();
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  let locationTaken = false;
  for (const line of lines) {
    const split = line.match(/^([^:]{1,40}):\s*(.*)$/);
    if (!split) {
      out.narrative.push(line);
      continue;
    }
    const field = fieldOf(split[1]);
    const value = split[2].trim();
    switch (field) {
      case 'name': if (!out.subjectName) out.subjectName = value.slice(0, 120); break;
      case 'age': {
        if (out.subjectAge === null) {
          const age = Number.parseInt(value.replace(/[^0-9]/g, ''), 10);
          out.subjectAge = Number.isFinite(age) && age >= 0 && age <= 120 ? age : null;
        }
        break;
      }
      case 'location':
        if (!locationTaken && value) {
          locationTaken = true;
          out.locationRaw = value;
          parseLocation(value, out);
        } else if (value) {
          out.narrative.push(line);
        }
        break;
      case 'vehicle': if (!out.vehicleMakeModel) out.vehicleMakeModel = value.slice(0, 120); break;
      case 'registration': if (!out.vehicleRegistration) out.vehicleRegistration = value.slice(0, 24); break;
      case 'colour': if (!out.vehicleColour) out.vehicleColour = value.slice(0, 40); break;
      case 'alert':
        if (!out.alertRaw) { out.alertRaw = value.slice(0, 80); out.dangerKind = dangerKindOf(value); }
        break;
      case 'contact': if (!out.contact) out.contact = value.slice(0, 60); break;
      case 'caseNumber': if (!out.caseNumber) out.caseNumber = value.slice(0, 40); break;
      case 'message':
        if (type === 'khumbulekhaya' && !out.message) out.message = value.slice(0, 500);
        else if (value) out.narrative.push(value);
        break;
      case 'narrative': if (value) out.narrative.push(value); break;
      default: out.narrative.push(line); break;
    }
  }
  return out;
}
