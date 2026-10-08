import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Post } from './models/types';
import { coordinateSearch } from './utils/search-coordination';
import { SearchBoardComponent } from '../shared/components/search-board.component';
import { AuthService } from './services/auth.service';
import { DataService } from './services/data.service';
import { SupabaseApi } from './data/supabase-api';

const NOW = 1791460000000;
const base = (): Post => ({ id: 'case', type: 'missing', status: 'active', authorId: 'owner', searchParty: null, updatedAt: NOW } as Post);
const opened = (): Post => coordinateSearch(base(), { action: 'open', meetAt: 'Public library', zones: ['Park', 'Taxi rank'] }, 'owner', true, NOW);
const claim = (post: Post, actor = 'a', zoneId = 'case-zone-1', expectedVersion = 0) => coordinateSearch(post, { action: 'claim', zoneId, expectedVersion }, actor, false, NOW + 1);

describe('Search command rules', () => {
  it('opens a board with independent versioned areas', () => {
    const board = opened().searchParty!;
    expect(board.zones.map(z => z.id)).toEqual(['case-zone-1', 'case-zone-2']);
    expect(board.zones.every(z => z.version === 0 && !z.takenBy && !z.done)).toBe(true);
  });
  it('never lets opening again erase existing assignments', () => {
    expect(() => coordinateSearch(opened(), { action: 'open', zones: ['New'], meetAt: 'Library' }, 'owner', true, NOW)).toThrow(/already has/);
  });
  it.each([[], ['Park', 'park'], [''], Array(21).fill('park'), ['x'.repeat(101)]].map(names => ({ names })))('rejects invalid area lists ($names)', ({ names }) => {
    expect(() => coordinateSearch(base(), { action: 'open', zones: names, meetAt: 'Library' }, 'owner', true, NOW)).toThrow(/different areas/);
  });
  it('requires coordinator permission, meeting point and a valid optional time', () => {
    expect(() => coordinateSearch(base(), { action: 'open', zones: ['Park'], meetAt: 'Library' }, 'a', false, NOW)).toThrow(/owner/);
    expect(() => coordinateSearch(base(), { action: 'open', zones: ['Park'] }, 'owner', true, NOW)).toThrow(/meeting point/);
    expect(() => coordinateSearch(base(), { action: 'open', zones: ['Park'], meetAt: 'Library', meetWhen: NOW - 1 }, 'owner', true, NOW)).toThrow(/meeting time/);
  });
  it('refuses a stale claim instead of replacing another person', () => {
    const current = claim(opened());
    expect(() => claim(current, 'b')).toThrow(/changed/);
    expect(() => claim(current, 'b', 'case-zone-1', 1)).toThrow(/already claimed/);
    expect(current.searchParty!.zones[0].takenBy).toBe('a');
  });
  it('preserves claims on independent areas', () => {
    const post = claim(claim(opened()), 'b', 'case-zone-2');
    expect(post.searchParty!.zones.map(z => z.takenBy)).toEqual(['a', 'b']);
  });
  it('does not let another volunteer release or complete an assignment', () => {
    for (const action of ['release', 'complete'] as const) {
      expect(() => coordinateSearch(claim(opened()), { action, zoneId: 'case-zone-1', expectedVersion: 1 }, 'b', false, NOW)).toThrow(/own unfinished/);
    }
  });
  it('completes, reopens and releases an assignment without losing the report', () => {
    let post = claim(opened());
    post = coordinateSearch(post, { action: 'complete', zoneId: 'case-zone-1', expectedVersion: 1, note: 'Area checked' }, 'a', false, NOW);
    expect(post.searchParty!.zones[0]).toMatchObject({ done: true, note: 'Area checked', updatedBy: 'a', version: 2 });
    post = coordinateSearch(post, { action: 'reopen', zoneId: 'case-zone-1', expectedVersion: 2 }, 'a', false, NOW);
    post = coordinateSearch(post, { action: 'release', zoneId: 'case-zone-1', expectedVersion: 3 }, 'a', false, NOW);
    expect(post.searchParty!.zones[0]).toMatchObject({ done: false, takenBy: null, note: 'Area checked', version: 4 });
  });
  it('limits public completion notes', () => {
    expect(() => coordinateSearch(claim(opened()), { action: 'complete', zoneId: 'case-zone-1', expectedVersion: 1, note: 'x'.repeat(501) }, 'a', false, NOW)).toThrow(/500/);
  });
  it('pauses, resumes and refuses changes to a closed case', () => {
    const paused = coordinateSearch(opened(), { action: 'pause' }, 'owner', true, NOW);
    expect(() => claim(paused)).toThrow(/paused/);
    const resumed = coordinateSearch(paused, { action: 'resume' }, 'owner', true, NOW);
    expect(claim(resumed).searchParty!.zones[0].takenBy).toBe('a');
    const closed = { ...resumed, status: 'found' as const };
    expect(() => claim(closed)).toThrow(/active search/);
    expect(coordinateSearch(closed, { action: 'refresh' }, 'a', false)).toEqual(closed);
  });
  it('production command ignores client identity and never falls back to a full-row write', async () => {
    const api = new SupabaseApi();
    const rpc = vi.fn().mockResolvedValue({ data: opened(), error: null });
    Object.assign(api, { client: { rpc } });
    await api.coordinateSearch('case', { action: 'pause' }, 'forged-actor');
    expect(rpc).toHaveBeenCalledWith('lula_coordinate_search', { post_id: 'case', command: { action: 'pause' } });
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.lula_coordinate_search' } });
    await expect(api.coordinateSearch('case', { action: 'pause' }, 'owner')).rejects.toThrow(/not enabled/);
  });
});

describe('Interactive search board', () => {
  const user = signal({ id: 'a', isAdmin: false });
  beforeEach(() => {
    user.set({ id: 'a', isAdmin: false });
    TestBed.configureTestingModule({ providers: [
      { provide: AuthService, useValue: { user } },
      { provide: DataService, useValue: { coordinateSearch: vi.fn(), refreshSearchBoard: vi.fn() } }
    ] });
  });
  function render(post = opened()) {
    const fixture = TestBed.createComponent(SearchBoardComponent);
    fixture.componentRef.setInput('post', post);
    fixture.componentInstance.expanded.set(true);
    fixture.componentInstance.changed.subscribe(p => fixture.componentRef.setInput('post', p));
    fixture.detectChanges();
    return fixture;
  }
  it('shows progress and keyboard-accessible filter controls', () => {
    const fixture = render();
    expect(fixture.nativeElement.textContent).toContain('0 of 2 areas completed');
    expect(fixture.nativeElement.querySelector('progress').max).toBe(2);
    const filter = [...fixture.nativeElement.querySelectorAll('button')].find((b: any) => b.textContent.trim() === 'My areas') as HTMLButtonElement;
    filter.click(); fixture.detectChanges();
    expect(filter.getAttribute('aria-pressed')).toBe('true');
    expect(fixture.nativeElement.textContent).toContain('No areas match');
  });
  it('a claim button dispatches a versioned command and updates the rendered board', async () => {
    const fixture = render();
    const service = TestBed.inject(DataService);
    vi.mocked(service.coordinateSearch).mockResolvedValue(claim(opened()));
    const button = [...fixture.nativeElement.querySelectorAll('button')].find((b: any) => b.textContent.trim() === 'Claim area') as HTMLButtonElement;
    button.click(); await fixture.whenStable(); fixture.detectChanges();
    expect(service.coordinateSearch).toHaveBeenCalledWith('case', expect.objectContaining({ action: 'claim', zoneId: 'case-zone-1', expectedVersion: 0 }));
    expect(fixture.nativeElement.textContent).toContain('Your area');
    expect(fixture.nativeElement.textContent).toContain('Mark completed');
  });
  it('shows a real failure without optimistic success or losing the draft', async () => {
    const fixture = render(claim(opened()));
    fixture.componentInstance.setNote('case-zone-1', 'Area checked');
    vi.mocked(TestBed.inject(DataService).coordinateSearch).mockRejectedValue(new Error('This area changed. Refresh the board before trying again.'));
    await fixture.componentInstance.run({ action: 'complete', zoneId: 'case-zone-1', expectedVersion: 1 }); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain('Refresh');
    expect(fixture.componentInstance.notes()['case-zone-1']).toBe('Area checked');
    expect(fixture.componentInstance.message()).toBe('');
    expect(fixture.componentInstance.busy()).toBe(false);
  });
  it('does not expose volunteer actions on a closed board', () => {
    const fixture = render({ ...claim(opened()), status: 'found' });
    expect(fixture.nativeElement.textContent).toContain('board read-only');
    expect(fixture.nativeElement.textContent).not.toContain('Mark completed');
  });
});
