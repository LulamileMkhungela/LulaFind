import { prefetchAllowed } from './services/prefetch.service';

/**
 * The background download of every screen is half a megabyte. These pin the
 * rule: it happens on a normal connection, and it does not happen when someone
 * has asked to save data, when the phone asks for less, or on a slow link.
 */
describe('Prefetching every screen is a choice, not a default', () => {
  it('runs on a normal connection', () => {
    expect(prefetchAllowed({ dataSaving: false, saveData: false, effectiveType: '4g', online: true })).toBe(true);
    expect(prefetchAllowed({ dataSaving: false })).toBe(true);
    expect(prefetchAllowed({ dataSaving: false, effectiveType: '3g', online: true })).toBe(true);
  });

  it('stops when the person switched Data saver on', () => {
    expect(prefetchAllowed({ dataSaving: true, effectiveType: '4g' })).toBe(false);
  });

  it('stops when the phone asks apps to reduce data', () => {
    expect(prefetchAllowed({ dataSaving: false, saveData: true, effectiveType: '4g' })).toBe(false);
  });

  it('stops on 2G', () => {
    expect(prefetchAllowed({ dataSaving: false, effectiveType: '2g' })).toBe(false);
    expect(prefetchAllowed({ dataSaving: false, effectiveType: 'slow-2g' })).toBe(false);
    expect(prefetchAllowed({ dataSaving: false, effectiveType: 'SLOW-2G' })).toBe(false);
  });

  it('stops when the app is offline', () => {
    expect(prefetchAllowed({ dataSaving: false, effectiveType: '4g', online: false })).toBe(false);
  });
});
