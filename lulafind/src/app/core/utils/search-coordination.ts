import { Post, SearchZone } from '../models/types';

export type SearchAction = 'refresh' | 'open' | 'pause' | 'resume' | 'claim' | 'release' | 'complete' | 'reopen';
export interface SearchCommand {
  action: SearchAction;
  zoneId?: string;
  expectedVersion?: number;
  note?: string;
  meetAt?: string;
  meetWhen?: number | null;
  zones?: string[];
}

/** Local-mode rules. Production repeats authorisation inside PostgreSQL. */
export function coordinateSearch(post: Post, command: SearchCommand, actor: string, coordinator: boolean, now = Date.now()): Post {
  if (!actor) throw new Error('Sign in to coordinate a search.');
  if (command.action === 'refresh') return post;
  if (post.status !== 'active' || !['missing', 'khumbulekhaya', 'pet'].includes(post.type)) {
    throw new Error('Only an active search case can have a search board.');
  }
  const party = post.searchParty;
  let next: Post['searchParty'];
  if (command.action === 'open') {
    if (!coordinator) throw new Error('Only the case owner or a moderator can open a search board.');
    if (party) throw new Error('This case already has a search board. Refresh to see it.');
    const names = (command.zones ?? []).map(n => n.trim());
    if (!names.length || names.length > 20 || names.some(n => !n || n.length > 100) || new Set(names.map(n => n.toLowerCase())).size !== names.length) {
      throw new Error('Add 1–20 different areas, each between 1 and 100 characters.');
    }
    const meetAt = (command.meetAt ?? '').trim();
    if (!meetAt || meetAt.length > 160) throw new Error('Add a public meeting point, up to 160 characters.');
    const meetWhen = command.meetWhen ?? null;
    if (meetWhen !== null && (!Number.isFinite(meetWhen) || meetWhen < now || meetWhen > now + 30 * 86400_000)) {
      throw new Error('Choose a meeting time within the next 30 days, or leave it blank.');
    }
    next = { open: true, meetAt, meetWhen, zones: names.map((name, i) => ({
      id: `${post.id}-zone-${i + 1}`, name, priority: 'medium', takenBy: null, done: false, note: '', version: 0
    })) };
  } else {
    if (!party) throw new Error('This case has no search board.');
    if (command.action === 'pause' || command.action === 'resume') {
      if (!coordinator) throw new Error('Only the case owner or a moderator can pause or resume a search.');
      next = { ...party, open: command.action === 'resume' };
    } else {
      if (!party.open) throw new Error('This search is paused.');
      const zone = party.zones.find(z => z.id === command.zoneId);
      if (!zone) throw new Error('That search area is no longer available.');
      if (command.expectedVersion !== (zone.version ?? 0)) throw new Error('This area changed. Refresh the board before trying again.');
      const updated = transitionZone(zone, command, actor, now);
      next = { ...party, zones: party.zones.map(z => z.id === updated.id ? updated : z) };
    }
  }
  return { ...post, searchParty: next, updatedAt: now };
}

function transitionZone(zone: SearchZone, command: SearchCommand, actor: string, now: number): SearchZone {
  const next = { ...zone, version: (zone.version ?? 0) + 1, updatedBy: actor, updatedAt: now };
  switch (command.action) {
    case 'claim':
      if (zone.takenBy || zone.done) throw new Error('Someone has already claimed or completed this area.');
      return { ...next, takenBy: actor };
    case 'release':
      if (zone.takenBy !== actor || zone.done) throw new Error('You can only release your own unfinished area.');
      return { ...next, takenBy: null };
    case 'complete': {
      if (zone.takenBy !== actor || zone.done) throw new Error('You can only complete your own unfinished area.');
      const note = (command.note ?? '').trim();
      if (note.length > 500) throw new Error('Keep the area update under 500 characters.');
      return { ...next, done: true, note };
    }
    case 'reopen':
      if (zone.takenBy !== actor || !zone.done) throw new Error('You can only reopen an area you completed.');
      return { ...next, done: false };
    default: throw new Error('Unknown search action.');
  }
}
