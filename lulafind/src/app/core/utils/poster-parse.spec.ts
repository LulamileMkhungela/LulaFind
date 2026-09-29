import { describe, expect, it } from 'vitest';
import { POSTER_TEMPLATES, PosterCategory, parsePosterText } from './poster-parse';

const CATEGORIES: PosterCategory[] = ['missing', 'khumbulekhaya', 'vehicle', 'pet', 'sighting', 'danger'];

describe('Poster templates', () => {
  it('gives every category a fill-in example', () => {
    for (const category of CATEGORIES) {
      expect(POSTER_TEMPLATES[category].trim().length).toBeGreaterThan(30);
    }
  });

  it('parses its own examples without losing the location', () => {
    const expected = { missing: 'GP', khumbulekhaya: 'KZN', vehicle: 'GP', pet: 'WC', sighting: 'GP', danger: 'WC' };
    for (const category of CATEGORIES) {
      const parsed = parsePosterText(category, POSTER_TEMPLATES[category]);
      expect(parsed.province).toBe(expected[category]);
      expect(parsed.town).toBeTruthy();
    }
  });
});

describe('parsePosterText', () => {
  it('pulls the name and age out of a missing-person report', () => {
    const parsed = parsePosterText('missing', 'Name: Lerato Dlamini\nAge: 24\nLast seen: Soweto, Gauteng');
    expect(parsed.subjectName).toBe('Lerato Dlamini');
    expect(parsed.subjectAge).toBe(24);
  });

  it('splits "Soweto, Gauteng" into town, province and no leftover', () => {
    const parsed = parsePosterText('missing', 'Last seen: Soweto, Gauteng');
    expect(parsed.town).toBe('Soweto');
    expect(parsed.province).toBe('GP');
    expect(parsed.lastSeenWhere).toBe('');
  });

  it('keeps the place detail separate from the town', () => {
    const parsed = parsePosterText('sighting', 'Where: Park Station, Johannesburg, Gauteng');
    expect(parsed.town).toBe('Johannesburg');
    expect(parsed.province).toBe('GP');
    expect(parsed.lastSeenWhere).toBe('Park Station');
  });

  it('resolves a lone city through the city list', () => {
    const parsed = parsePosterText('pet', 'Last seen: Bellville');
    expect(parsed.town).toBe('Bellville');
    expect(parsed.province).toBe('WC');
  });

  it('never guesses a province it cannot find', () => {
    const parsed = parsePosterText('missing', 'Last seen: Nowhereville');
    expect(parsed.province).toBeNull();
    expect(parsed.town).toBe('Nowhereville');
  });

  it('asks for the town when only a province is given', () => {
    const parsed = parsePosterText('missing', 'Last seen: Gauteng');
    expect(parsed.province).toBe('GP');
    expect(parsed.town).toBe('');
  });

  it('reads vehicle, registration and case number', () => {
    const parsed = parsePosterText(
      'vehicle',
      'Vehicle: White Toyota Hilux\nRegistration: ABC 123 GP\nTaken from: Randburg, Gauteng\nCase number: 123/01/2026'
    );
    expect(parsed.vehicleMakeModel).toBe('White Toyota Hilux');
    expect(parsed.vehicleRegistration).toBe('ABC 123 GP');
    expect(parsed.caseNumber).toBe('123/01/2026');
    expect(parsed.province).toBe('GP');
  });

  it('maps the alert line to a danger kind', () => {
    expect(parsePosterText('danger', 'Alert: Robbery\nWhere: Cape Town').dangerKind).toBe('robbery');
    expect(parsePosterText('danger', 'Alert: shack fire\nWhere: Cape Town').dangerKind).toBe('fire');
    expect(parsePosterText('danger', 'Alert: strange lights\nWhere: Cape Town').dangerKind).toBe('other');
  });

  it('keeps unlabeled lines and unknown labels in the story', () => {
    const parsed = parsePosterText('missing', 'Name: Lerato Dlamini\nShe never came home.\nNickname: Lulu');
    expect(parsed.narrative).toContain('She never came home.');
    expect(parsed.narrative).toContain('Nickname: Lulu');
  });

  it('strips labels off the story lines used for titles', () => {
    const parsed = parsePosterText('sighting', 'What happened: He sat by the entrance.');
    expect(parsed.narrative).toEqual(['He sat by the entrance.']);
  });

  it('keeps the KhumbulEkhaya message separate', () => {
    const parsed = parsePosterText('khumbulekhaya', 'Message for them: We are not angry.\nLeft home: Umlazi');
    expect(parsed.message).toBe('We are not angry.');
    expect(parsed.town).toBe('Umlazi');
  });

  it('matches "Kwazulu Natal" without the hyphen', () => {
    const parsed = parsePosterText('missing', 'Last seen: Umlazi, Kwazulu Natal');
    expect(parsed.province).toBe('KZN');
    expect(parsed.town).toBe('Umlazi');
  });
});
