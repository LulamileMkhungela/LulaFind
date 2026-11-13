import { describe, expect, it } from 'vitest';
import { aftercareSteps, HELP_LABEL, helpSummary, helpersOf } from './utils/aftercare';
import { Comment, Post } from './models/types';

/**
 * Closing a case is the one moment the app can do real harm: get it wrong and a
 * family either thanks people who did nothing, or misses the volunteer who walked
 * their suburb for two days. These tests pin the boundary - who counts as a
 * helper, and what a family is told they still owe.
 */

const comment = (over: Partial<Comment>): Comment => ({
  id: 'c1', postId: 'p1', parentId: null, authorId: 'u_a', body: '...', createdAt: 1,
  upvotes: 0, isLead: false, ...over
} as Comment);

const baseCase = (over: Partial<Post> = {}): Post => ({
  id: 'p1', authorId: 'u_family', lookingIds: ['u_looker'], status: 'found',
  searchParty: {
    open: false, meetAt: '', meetWhen: 0,
    zones: [
      { id: 'z1', name: 'Taxi rank', priority: 'high', takenBy: 'u_walker', done: true, note: '' },
      { id: 'z2', name: 'Clinic', priority: 'medium', takenBy: 'u_quitter', done: false, note: '' }
    ]
  },
  outcome: { found: true, foundAt: 10, whereaboutsFound: 'Home', closedBy: 'u_family', note: '', finderUserId: 'u_finder', finderName: 'Finder' },
  ...over
} as Post);

describe('Aftercare: who helped, and what is still owed', () => {
  it('names the finder, the walkers and the lead-givers, and nobody else', () => {
    const helpers = helpersOf(baseCase(), [
      comment({ id: 'c_lead', authorId: 'u_lead', isLead: true }),
      comment({ id: 'c_chat', authorId: 'u_chatter', isLead: false })
    ]);
    const ids = helpers.map((h) => h.userId);
    expect(ids).toContain('u_finder');
    expect(ids).toContain('u_walker');
    expect(ids).toContain('u_lead');
    expect(ids).toContain('u_looker');
    // A comment that is not a lead is not help, and a zone nobody finished is not either.
    expect(ids).not.toContain('u_chatter');
    expect(ids).not.toContain('u_quitter');
    // The family who posted the case never thanks themselves.
    expect(ids).not.toContain('u_family');
  });

  it('puts the finder first and the lookers last, so the most useful name tops the list', () => {
    const helpers = helpersOf(baseCase(), [comment({ authorId: 'u_lead', isLead: true })]);
    expect(helpers[0].userId).toBe('u_finder');
    expect(helpers[0].via).toEqual(['found']);
    expect(helpers[helpers.length - 1].userId).toBe('u_looker');
  });

  it('records every way one person helped, without listing them twice', () => {
    const helpers = helpersOf(baseCase({ lookingIds: ['u_walker'] }), []);
    const walker = helpers.filter((h) => h.userId === 'u_walker');
    expect(walker).toHaveLength(1);
    expect(walker[0].via).toEqual(['area', 'looking']);
    expect(helpSummary(walker[0].via)).toBe('walked a search area and was out looking');
  });

  it('says nobody to thank rather than inventing a list', () => {
    const alone = baseCase({
      lookingIds: [], searchParty: null,
      outcome: { found: true, foundAt: 1, whereaboutsFound: 'Home', closedBy: 'u_family', note: '', finderUserId: null }
    });
    expect(helpersOf(alone, [])).toEqual([]);
    const steps = aftercareSteps(alone, 0);
    const thanks = steps.find((s) => s.id === 'thanks')!;
    expect(thanks.needed).toBe(false);
    expect(thanks.title).toBe('Nobody was on this search');
    expect(thanks.detail).toContain('nothing is owed');
    // A missing post is not a crash.
    expect(helpersOf(null, [])).toEqual([]);
  });

  it('asks for the SAPS 92 every time, and only asks for posters when there is one', () => {
    const withPoster = aftercareSteps(baseCase({ poster: { templateId: 't1', media: { id: 'm', kind: 'image', src: 'x' } } } as Partial<Post>), 3);
    const byId = Object.fromEntries(withPoster.map((s) => [s.id, s]));
    expect(byId.officer.needed).toBe(true);
    expect(byId.posters.needed).toBe(true);
    expect(byId.thanks.needed).toBe(true);

    const noPoster = aftercareSteps(baseCase(), 3);
    expect(noPoster.find((s) => s.id === 'posters')!.needed).toBe(false);
  });

  it('quotes the case number back when the family gave one', () => {
    const withNumber = aftercareSteps(baseCase({ caseNumber: 'ORL/441/09/2026' }), 1);
    expect(withNumber.find((s) => s.id === 'officer')!.detail).toContain('ORL/441/09/2026');
    const without = aftercareSteps(baseCase({ caseNumber: null }), 1);
    expect(without.find((s) => s.id === 'officer')!.detail).not.toContain('null');
  });

  it('counts people, not help, in the sentence a family reads', () => {
    expect(aftercareSteps(baseCase(), 1).find((s) => s.id === 'thanks')!.title).toBe('Thank the 1 person who helped');
    expect(aftercareSteps(baseCase(), 4).find((s) => s.id === 'thanks')!.title).toBe('Thank the 4 people who helped');
    // Every way of helping has words a person would say out loud.
    for (const label of Object.values(HELP_LABEL)) {
      expect(label.length).toBeGreaterThan(4);
    }
  });
});
